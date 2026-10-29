import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Download, Pencil, Undo2, Lock, Trash2, TriangleAlert } from 'lucide-react';
import { z } from 'zod';
import {
  formatMoney,
  moneyTextSchema,
  parseEuroCents,
  moneyInputValue,
  accountInputSchema,
  categoryInputSchema,
  cashbookEntryInputSchema,
  reversalInputSchema,
  type FinanceAccount,
  type CashbookCategory,
  type FiscalYear,
  type CashbookEntry,
  type AnnualReport,
  type ReportTemplate,
  type Page,
} from '@bnature/contracts';
import { DataForm } from '../../components/data-form';
import {
  Button,
  Empty,
  ErrorState,
  Field,
  FormActions,
  Loading,
  Modal,
  Notice,
  Pagination,
  SearchInput,
  formatDate,
} from '../../components/ui';
import { api, allPages, downloadPrivateFile, errorMessage, queryClient } from '../../lib/api';
import { encodeCsv, downloadCsv } from '../../lib/csv';
import { useSession } from '../../app/session';
import { useDebounced } from '../../hooks/use-debounced';
import { useFinancialWrite } from './client';

export type LedgerTabName = 'cashbook' | 'setup' | 'reports';
const refresh = () =>
  void queryClient.invalidateQueries({
    predicate: (query) => String(query.queryKey[0]).startsWith('finance-'),
  });
export function useLedgerBasics() {
  const { me } = useSession();
  const accounts = useQuery({
    queryKey: ['finance-accounts', me.activeOrganizationId],
    queryFn: () => api<{ items: FinanceAccount[] }>('/finance/accounts'),
  });
  const categories = useQuery({
    queryKey: ['finance-categories', me.activeOrganizationId],
    queryFn: () => api<{ items: CashbookCategory[] }>('/finance/categories'),
  });
  const years = useQuery({
    queryKey: ['finance-fiscal-years', me.activeOrganizationId],
    queryFn: () => api<{ items: FiscalYear[] }>('/finance/fiscal-years'),
  });
  return { accounts, categories, years };
}
// Opening balances may be negative (overdrawn bank accounts); amounts stay exact decimal text.
function parseSignedCents(value: string) {
  const text = value.trim(),
    negative = text.startsWith('-');
  const cents = parseEuroCents(negative ? text.slice(1) : text);
  return negative ? -cents : cents;
}
function signedInputValue(cents: string) {
  const value = BigInt(cents);
  return value < 0n ? `-${moneyInputValue(Number(-value))}` : moneyInputValue(Number(value));
}
function Amount({
  cents,
  direction,
}: {
  cents: number | string;
  direction?: 'income' | 'expense';
}) {
  const { i18n } = useTranslation();
  const sign = direction === 'expense' ? '−' : direction === 'income' ? '+' : '';
  return (
    <span className={`finance-money ledger-amount ledger-${direction ?? 'neutral'}`}>
      {sign} {formatMoney(cents, i18n.language)}
    </span>
  );
}
export function LedgerTab({ tab }: { tab: LedgerTabName }) {
  if (tab === 'cashbook') return <Cashbook />;
  if (tab === 'setup') return <LedgerSetup />;
  return <Reports />;
}

const entryFormSchema = z
  .object(cashbookEntryInputSchema.shape)
  .omit({ amountCents: true })
  .extend({ amount: moneyTextSchema })
  .transform(({ amount, ...rest }) => ({ ...rest, amountCents: parseEuroCents(amount) }));
type CashbookEditor = { type: 'new' } | { type: 'reverse'; entry: CashbookEntry };
function Cashbook() {
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    write = useFinancialWrite(),
    basics = useLedgerBasics(),
    canWrite = me.permissions.includes('finance:write');
  const [year, setYear] = useState(''),
    [account, setAccount] = useState(''),
    [category, setCategory] = useState(''),
    [direction, setDirection] = useState(''),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [editor, setEditor] = useState<CashbookEditor | null>(null),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const debounced = useDebounced(search),
    years = basics.years.data?.items ?? [],
    selectedYear = year || String(years[0]?.year ?? ''),
    openYears = years.filter((y) => y.status === 'open');
  const q = new URLSearchParams({
    search: debounced,
    page: String(page),
    ...(selectedYear ? { fiscalYear: selectedYear } : {}),
    ...(account ? { accountId: account } : {}),
    ...(category ? { categoryId: category } : {}),
    ...(direction ? { direction } : {}),
  }).toString();
  const entries = useQuery({
    queryKey: ['finance-cashbook', me.activeOrganizationId, q],
    queryFn: () => api<Page<CashbookEntry>>(`/finance/cashbook?${q}`),
    enabled: basics.years.isSuccess,
  });
  const done = (message: string) => {
    setEditor(null);
    setNotice(t(message));
    setError('');
    refresh();
  };
  async function exportCsv() {
    setBusy(true);
    setError('');
    try {
      const parameters = new URLSearchParams(q);
      parameters.delete('page');
      const rows = await allPages<CashbookEntry>(`/finance/cashbook?${parameters}`);
      const columns = [
        t('ledgerEntryNumber'),
        t('ledgerBookingDate'),
        t('ledgerDocumentDate'),
        t('ledgerDocumentNumber'),
        t('ledgerDescription'),
        t('ledgerCounterparty'),
        t('ledgerCategory'),
        t('ledgerAccount'),
        t('ledgerDirection'),
        t('financeCents'),
        t('ledgerReverses'),
      ];
      const data = rows.map((row) =>
        Object.fromEntries(
          columns.map((key, index) => [
            key,
            [
              `${row.fiscalYear}/${row.entryNumber}`,
              row.bookingDate,
              row.documentDate,
              row.documentNumber,
              row.description,
              row.counterparty,
              row.categoryName,
              row.accountName,
              t(row.direction === 'income' ? 'ledgerIncome' : 'ledgerExpense'),
              row.amountCents,
              row.reversesEntryId ?? '',
            ][index],
          ]),
        ),
      );
      downloadCsv(`bnature-cashbook-${selectedYear || 'all'}.csv`, encodeCsv(data, columns));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  if (basics.years.isPending || basics.accounts.isPending || basics.categories.isPending)
    return <Loading />;
  const failed = [basics.years, basics.accounts, basics.categories].find((query) => query.isError);
  if (failed) return <ErrorState error={failed.error} retry={() => void failed.refetch()} />;
  if (!years.length)
    return <Empty title={t('ledgerNoYearTitle')} description={t('ledgerNoYear')} />;
  const accounts = basics.accounts.data?.items ?? [],
    categories = basics.categories.data?.items ?? [];
  return (
    <>
      <div className="toolbar ledger-toolbar">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder={t('ledgerSearch')}
        />
        {[
          {
            label: 'ledgerFiscalYear',
            value: selectedYear,
            set: setYear,
            options: years.map((y) => [String(y.year), String(y.year)]),
          },
          {
            label: 'ledgerAccount',
            value: account,
            set: setAccount,
            options: [['', t('ledgerAllAccounts')], ...accounts.map((a) => [a.id, a.name])],
          },
          {
            label: 'ledgerCategory',
            value: category,
            set: setCategory,
            options: [['', t('ledgerAllCategories')], ...categories.map((c) => [c.id, c.name])],
          },
          {
            label: 'ledgerDirection',
            value: direction,
            set: setDirection,
            options: [
              ['', t('ledgerAllDirections')],
              ['income', t('ledgerIncome')],
              ['expense', t('ledgerExpense')],
            ],
          },
        ].map((filter) => (
          <label key={filter.label}>
            <span className="sr-only">{t(filter.label)}</span>
            <select
              value={filter.value}
              onChange={(event) => {
                filter.set(event.target.value);
                setPage(1);
              }}
            >
              {filter.options.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ))}
        <div className="ledger-toolbar-actions">
          <Button variant="secondary" disabled={busy} onClick={() => void exportCsv()}>
            <Download size={16} />
            {t(busy ? 'financeExporting' : 'financeExport')}
          </Button>
          {canWrite && (
            <Button disabled={!openYears.length} onClick={() => setEditor({ type: 'new' })}>
              <Plus size={17} />
              {t('ledgerAddEntry')}
            </Button>
          )}
        </div>
      </div>
      {notice && <Notice>{notice}</Notice>}
      {error && <Notice error>{error}</Notice>}
      {entries.isPending ? (
        <Loading />
      ) : entries.isError ? (
        <ErrorState error={entries.error} retry={() => void entries.refetch()} />
      ) : entries.data.items.length ? (
        <>
          <div className="table-scroll" tabIndex={0} role="region" aria-label={t('ledgerCashbook')}>
            <table>
              <thead>
                <tr>
                  <th>{t('ledgerEntryNumber')}</th>
                  <th>{t('ledgerBookingDate')}</th>
                  <th>{t('ledgerDescription')}</th>
                  <th>{t('ledgerCategory')}</th>
                  <th>{t('ledgerAccount')}</th>
                  <th className="align-right">{t('financeAmount')}</th>
                  {canWrite && <th>{t('actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {entries.data.items.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <strong>
                        {entry.fiscalYear}/{entry.entryNumber}
                      </strong>
                    </td>
                    <td>{formatDate(entry.bookingDate, i18n.language)}</td>
                    <td>
                      {entry.description}
                      <small className="finance-cell-note">
                        {[entry.counterparty, entry.documentNumber].filter(Boolean).join(' · ')}
                      </small>
                      <span className="ledger-flags">
                        {entry.reversesEntryId && (
                          <span className="badge badge-pending">{t('ledgerReversal')}</span>
                        )}
                        {entry.reversedByEntryId && (
                          <span className="badge badge-inactive">{t('ledgerReversed')}</span>
                        )}
                        {entry.paymentId && (
                          <span className="badge finance-status-paid">{t('ledgerFeePayment')}</span>
                        )}
                      </span>
                    </td>
                    <td>{entry.categoryName}</td>
                    <td>{entry.accountName}</td>
                    <td className="align-right">
                      <Amount cents={entry.amountCents} direction={entry.direction} />
                    </td>
                    {canWrite && (
                      <td>
                        {!entry.reversesEntryId && !entry.reversedByEntryId && !entry.paymentId && (
                          <Button
                            variant="ghost"
                            aria-label={`${t('ledgerReverse')}: ${entry.fiscalYear}/${entry.entryNumber}`}
                            onClick={() => setEditor({ type: 'reverse', entry })}
                          >
                            <Undo2 size={17} />
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            pageSize={entries.data.pageSize}
            total={entries.data.total}
            onChange={setPage}
          />
        </>
      ) : (
        <Empty
          description={t(
            debounced || account || category || direction ? 'noResults' : 'ledgerEmpty',
          )}
        />
      )}
      <p className="finance-footnote">{t('ledgerImmutableHint')}</p>
      {editor && (
        <Modal
          wide
          title={t(editor.type === 'new' ? 'ledgerAddEntry' : 'ledgerReverse')}
          onClose={() => setEditor(null)}
        >
          {editor.type === 'new' ? (
            !accounts.some((a) => a.active) ||
            !categories.some((c) => c.active && c.classification !== 'membership_fee') ? (
              <Empty description={t('ledgerSetupFirst')} />
            ) : (
              <DataForm
                schema={entryFormSchema}
                create
                onCancel={() => setEditor(null)}
                fields={[
                  {
                    name: 'categoryId',
                    label: 'ledgerCategory',
                    type: 'select',
                    required: true,
                    options: [
                      { value: '', label: t('ledgerChooseCategory') },
                      ...categories
                        .filter((c) => c.active && c.classification !== 'membership_fee')
                        .map((c) => ({
                          value: c.id,
                          label: `${t(c.direction === 'income' ? 'ledgerIncome' : 'ledgerExpense')} · ${c.name}`,
                        })),
                    ],
                  },
                  {
                    name: 'accountId',
                    label: 'ledgerAccount',
                    type: 'select',
                    required: true,
                    options: accounts
                      .filter((a) => a.active)
                      .map((a) => ({ value: a.id, label: a.name })),
                  },
                  { name: 'amount', label: 'financeAmount', required: true, inputMode: 'decimal' },
                  { name: 'bookingDate', label: 'ledgerBookingDate', type: 'date', required: true },
                  {
                    name: 'documentDate',
                    label: 'ledgerDocumentDate',
                    type: 'date',
                    required: true,
                  },
                  { name: 'documentNumber', label: 'ledgerDocumentNumber' },
                  { name: 'description', label: 'ledgerDescription', required: true },
                  { name: 'counterparty', label: 'ledgerCounterparty' },
                ]}
                defaults={{
                  categoryId: '',
                  amount: '',
                  bookingDate: `${openYears[0]!.year}-01-01`,
                  documentDate: `${openYears[0]!.year}-01-01`,
                }}
                onSubmit={async (value) => {
                  await write<CashbookEntry>('/finance/cashbook', value);
                  done('ledgerSavedEntry');
                }}
              />
            )
          ) : (
            <>
              <p className="finance-form-help">
                {t('ledgerReverseHelp', {
                  number: `${editor.entry.fiscalYear}/${editor.entry.entryNumber}`,
                  amount: formatMoney(editor.entry.amountCents, i18n.language),
                })}
              </p>
              <DataForm
                schema={reversalInputSchema}
                create
                onCancel={() => setEditor(null)}
                fields={[
                  {
                    name: 'bookingDate',
                    label: 'ledgerReversalDate',
                    type: 'date',
                    required: true,
                  },
                  {
                    name: 'reason',
                    label: 'ledgerReversalReason',
                    type: 'textarea',
                    required: true,
                  },
                ]}
                defaults={{ bookingDate: editor.entry.bookingDate, reason: '' }}
                onSubmit={async (value) => {
                  await write(`/finance/cashbook/${editor.entry.id}/reversal`, value);
                  done('ledgerSavedReversal');
                }}
              />
            </>
          )}
        </Modal>
      )}
    </>
  );
}

const accountFormSchema = accountInputSchema;
const accountPatchFormSchema = accountInputSchema.omit({ kind: true });
type SetupEditor =
  | { type: 'account'; account?: FinanceAccount }
  | { type: 'category'; category?: CashbookCategory }
  | { type: 'year' }
  | { type: 'close'; year: FiscalYear };
function LedgerSetup() {
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    write = useFinancialWrite(),
    basics = useLedgerBasics(),
    canWrite = me.permissions.includes('finance:write'),
    canClose = me.permissions.includes('finance:close');
  const [editor, setEditor] = useState<SetupEditor | null>(null),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  if (basics.years.isPending || basics.accounts.isPending || basics.categories.isPending)
    return <Loading />;
  const failed = [basics.years, basics.accounts, basics.categories].find((query) => query.isError);
  if (failed) return <ErrorState error={failed.error} retry={() => void failed.refetch()} />;
  const years = basics.years.data!.items,
    accounts = basics.accounts.data!.items,
    categories = basics.categories.data!.items;
  const done = (message: string) => {
    setEditor(null);
    setNotice(t(message));
    setError('');
    refresh();
  };
  const classification = (c: CashbookCategory) =>
    t(
      {
        membership_fee: 'ledgerClassFee',
        donation: 'ledgerClassDonation',
        other: 'ledgerClassOther',
      }[c.classification],
    );
  return (
    <div className="ledger-setup">
      {notice && <Notice>{notice}</Notice>}
      {error && <Notice error>{error}</Notice>}
      <section aria-labelledby="ledger-years-heading">
        <div className="ledger-section-heading">
          <div>
            <h2 id="ledger-years-heading">{t('ledgerFiscalYears')}</h2>
            <p>{t('ledgerFiscalYearsHelp')}</p>
          </div>
          {canWrite && (
            <Button onClick={() => setEditor({ type: 'year' })}>
              <Plus size={17} />
              {t('ledgerOpenYear')}
            </Button>
          )}
        </div>
        {years.length ? (
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label={t('ledgerFiscalYears')}
          >
            <table>
              <thead>
                <tr>
                  <th>{t('ledgerFiscalYear')}</th>
                  <th>{t('status')}</th>
                  <th>{t('ledgerBalances')}</th>
                  {canClose && <th>{t('actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {years.map((year) => (
                  <tr key={year.id}>
                    <td>
                      <strong>{year.year}</strong>
                    </td>
                    <td>
                      <span
                        className={`badge badge-${year.status === 'open' ? 'active' : 'inactive'}`}
                      >
                        <span />
                        {t(year.status === 'open' ? 'ledgerYearOpen' : 'ledgerYearClosed')}
                      </span>
                      {year.openingMismatch && (
                        <small className="ledger-warning">
                          <TriangleAlert size={13} /> {t('ledgerOpeningMismatch')}
                        </small>
                      )}
                    </td>
                    <td>
                      <ul className="ledger-balance-list">
                        {year.balances.map((b) => (
                          <li key={b.accountId}>
                            <span>{b.name}</span>
                            <span className="finance-money">
                              {formatMoney(b.openingCents, i18n.language)} →{' '}
                              <strong>{formatMoney(b.closingCents, i18n.language)}</strong>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    {canClose && (
                      <td>
                        {year.status === 'open' && (
                          <Button
                            variant="secondary"
                            onClick={() => setEditor({ type: 'close', year })}
                            aria-label={`${t('ledgerCloseYear')} ${year.year}`}
                          >
                            <Lock size={15} />
                            {t('ledgerCloseYear')}
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty description={t('ledgerNoYear')} />
        )}
      </section>
      <section aria-labelledby="ledger-accounts-heading">
        <div className="ledger-section-heading">
          <div>
            <h2 id="ledger-accounts-heading">{t('ledgerAccounts')}</h2>
            <p>{t('ledgerAccountsHelp')}</p>
          </div>
          {canWrite && (
            <Button variant="secondary" onClick={() => setEditor({ type: 'account' })}>
              <Plus size={17} />
              {t('ledgerAddAccount')}
            </Button>
          )}
        </div>
        {accounts.length ? (
          <div className="table-scroll" tabIndex={0} role="region" aria-label={t('ledgerAccounts')}>
            <table>
              <thead>
                <tr>
                  <th>{t('name')}</th>
                  <th>{t('ledgerAccountKind')}</th>
                  <th>{t('ledgerIban')}</th>
                  <th>{t('status')}</th>
                  {canWrite && <th>{t('actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <strong>{account.name}</strong>
                    </td>
                    <td>{t(account.kind === 'cash' ? 'ledgerCash' : 'ledgerBank')}</td>
                    <td className="ledger-iban">{account.iban || '—'}</td>
                    <td>
                      <span className={`badge badge-${account.active ? 'active' : 'inactive'}`}>
                        <span />
                        {t(account.active ? 'active' : 'inactive')}
                      </span>
                    </td>
                    {canWrite && (
                      <td>
                        <Button
                          variant="ghost"
                          aria-label={`${t('ledgerEditAccount')}: ${account.name}`}
                          onClick={() => setEditor({ type: 'account', account })}
                        >
                          <Pencil size={17} />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty description={t('ledgerNoAccounts')} />
        )}
      </section>
      <section aria-labelledby="ledger-categories-heading">
        <div className="ledger-section-heading">
          <div>
            <h2 id="ledger-categories-heading">{t('ledgerCategories')}</h2>
            <p>{t('ledgerCategoriesHelp')}</p>
          </div>
          {canWrite && (
            <Button variant="secondary" onClick={() => setEditor({ type: 'category' })}>
              <Plus size={17} />
              {t('ledgerAddCategory')}
            </Button>
          )}
        </div>
        {categories.length ? (
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label={t('ledgerCategories')}
          >
            <table>
              <thead>
                <tr>
                  <th>{t('name')}</th>
                  <th>{t('ledgerDirection')}</th>
                  <th>{t('ledgerClassification')}</th>
                  <th>{t('status')}</th>
                  {canWrite && <th>{t('actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <tr key={category.id}>
                    <td>
                      <strong>{category.name}</strong>
                    </td>
                    <td>{t(category.direction === 'income' ? 'ledgerIncome' : 'ledgerExpense')}</td>
                    <td>{classification(category)}</td>
                    <td>
                      <span className={`badge badge-${category.active ? 'active' : 'inactive'}`}>
                        <span />
                        {t(category.active ? 'active' : 'inactive')}
                      </span>
                    </td>
                    {canWrite && (
                      <td>
                        <Button
                          variant="ghost"
                          aria-label={`${t('ledgerEditCategory')}: ${category.name}`}
                          onClick={() => setEditor({ type: 'category', category })}
                        >
                          <Pencil size={17} />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty description={t('ledgerNoCategories')} />
        )}
      </section>
      {editor && (
        <Modal
          wide={editor.type === 'year'}
          title={t(
            editor.type === 'account'
              ? editor.account
                ? 'ledgerEditAccount'
                : 'ledgerAddAccount'
              : editor.type === 'category'
                ? editor.category
                  ? 'ledgerEditCategory'
                  : 'ledgerAddCategory'
                : editor.type === 'year'
                  ? 'ledgerOpenYear'
                  : 'ledgerCloseYear',
          )}
          onClose={() => setEditor(null)}
        >
          {editor.type === 'account' ? (
            <DataForm
              schema={editor.account ? accountPatchFormSchema : accountFormSchema}
              create={!editor.account}
              onCancel={() => setEditor(null)}
              fields={[
                { name: 'name', label: 'name', required: true },
                ...(editor.account
                  ? []
                  : [
                      {
                        name: 'kind',
                        label: 'ledgerAccountKind',
                        type: 'select' as const,
                        options: [
                          { value: 'cash', label: t('ledgerCash') },
                          { value: 'bank', label: t('ledgerBank') },
                        ],
                      },
                    ]),
                { name: 'iban', label: 'ledgerIban' },
                { name: 'active', label: 'active', type: 'checkbox' },
              ]}
              defaults={editor.account ?? { kind: 'cash', active: true }}
              onSubmit={async (value) => {
                await write(
                  editor.account ? `/finance/accounts/${editor.account.id}` : '/finance/accounts',
                  editor.account ? { ...value, version: editor.account.version } : value,
                  editor.account ? 'PATCH' : 'POST',
                );
                done('ledgerSavedAccount');
              }}
            />
          ) : editor.type === 'category' ? (
            <DataForm
              schema={
                editor.category
                  ? z.object({ name: z.string().trim().min(1).max(120), active: z.boolean() })
                  : categoryInputSchema
              }
              create={!editor.category}
              onCancel={() => setEditor(null)}
              fields={[
                { name: 'name', label: 'name', required: true },
                ...(editor.category
                  ? []
                  : [
                      {
                        name: 'direction',
                        label: 'ledgerDirection',
                        type: 'select' as const,
                        options: [
                          { value: 'income', label: t('ledgerIncome') },
                          { value: 'expense', label: t('ledgerExpense') },
                        ],
                      },
                      {
                        name: 'classification',
                        label: 'ledgerClassification',
                        type: 'select' as const,
                        options: [
                          { value: 'other', label: t('ledgerClassOther') },
                          { value: 'membership_fee', label: t('ledgerClassFee') },
                          { value: 'donation', label: t('ledgerClassDonation') },
                        ],
                      },
                    ]),
                { name: 'active', label: 'active', type: 'checkbox' },
              ]}
              defaults={
                editor.category ?? { direction: 'income', classification: 'other', active: true }
              }
              onSubmit={async (value) => {
                await write(
                  editor.category
                    ? `/finance/categories/${editor.category.id}`
                    : '/finance/categories',
                  editor.category ? { ...value, version: editor.category.version } : value,
                  editor.category ? 'PATCH' : 'POST',
                );
                done('ledgerSavedCategory');
              }}
            />
          ) : editor.type === 'year' ? (
            <OpenYearForm
              years={years}
              accounts={accounts}
              onCancel={() => setEditor(null)}
              onDone={() => done('ledgerSavedYear')}
            />
          ) : (
            <div className="finance-detail">
              <p>{t('ledgerCloseHelp', { year: editor.year.year })}</p>
              {error && <Notice error>{error}</Notice>}
              <footer className="form-actions">
                <Button type="button" variant="secondary" onClick={() => setEditor(null)}>
                  {t('cancel')}
                </Button>
                <Button
                  disabled={pending}
                  onClick={async () => {
                    setPending(true);
                    setError('');
                    try {
                      await write(`/finance/fiscal-years/${editor.year.year}/close`, {});
                      done('ledgerSavedClose');
                    } catch (error) {
                      setError(errorMessage(error));
                    } finally {
                      setPending(false);
                    }
                  }}
                >
                  <Lock size={15} />
                  {t('ledgerCloseConfirm', { year: editor.year.year })}
                </Button>
              </footer>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
function OpenYearForm({
  years,
  accounts,
  onCancel,
  onDone,
}: {
  years: FiscalYear[];
  accounts: FinanceAccount[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation(),
    write = useFinancialWrite();
  const latest = years[0],
    previousClosed = latest?.status === 'closed';
  const [year, setYear] = useState(String(latest ? latest.year + 1 : new Date().getFullYear())),
    [manual, setManual] = useState(!previousClosed),
    [amounts, setAmounts] = useState<Record<string, string>>(() =>
      Object.fromEntries(
        accounts.map((a) => [
          a.id,
          signedInputValue(latest?.balances.find((b) => b.accountId === a.id)?.closingCents ?? '0'),
        ]),
      ),
    ),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const parsedYear = Number(year);
      if (!Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > 2200) {
        setError(t('validation'));
        return;
      }
      const openingBalances = manual
        ? accounts.map((a) => ({
            accountId: a.id,
            amountCents: parseSignedCents(amounts[a.id] ?? '0'),
          }))
        : undefined;
      setPending(true);
      await write('/finance/fiscal-years', {
        year: parsedYear,
        ...(manual ? { openingBalances } : {}),
      });
      onDone();
    } catch (error) {
      setError(
        error instanceof Error && error.message === 'financeInvalidAmount'
          ? t('financeInvalidAmount')
          : errorMessage(error),
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <p className="finance-form-help">{t('ledgerOpenYearHelp')}</p>
      <div className="form-grid">
        <Field label={`${t('ledgerFiscalYear')} *`}>
          <input
            inputMode="numeric"
            required
            value={year}
            onChange={(event) => setYear(event.target.value)}
          />
        </Field>
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={manual}
          onChange={(event) => setManual(event.target.checked)}
        />
        <span>{t('ledgerManualOpening')}</span>
      </label>
      {manual ? (
        accounts.length ? (
          <fieldset>
            <legend>{t('ledgerOpeningBalances')}</legend>
            <div className="form-grid">
              {accounts.map((account) => (
                <Field
                  key={account.id}
                  label={`${account.name} (EUR)`}
                  hint={account.kind === 'bank' ? t('ledgerNegativeAllowed') : undefined}
                >
                  <input
                    inputMode="decimal"
                    value={amounts[account.id] ?? ''}
                    onChange={(event) =>
                      setAmounts((current) => ({ ...current, [account.id]: event.target.value }))
                    }
                  />
                </Field>
              ))}
            </div>
          </fieldset>
        ) : (
          <p className="finance-footnote">{t('ledgerNoAccounts')}</p>
        )
      ) : (
        <p className="finance-footnote">{t('ledgerCarryForward')}</p>
      )}
      {error && <Notice error>{error}</Notice>}
      <FormActions pending={pending} create onCancel={onCancel} />
    </form>
  );
}

function Reports() {
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    basics = useLedgerBasics(),
    canWrite = me.permissions.includes('finance:write');
  const [year, setYear] = useState(''),
    [templateId, setTemplateId] = useState(''),
    [editor, setEditor] = useState<{ template?: ReportTemplate } | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const templates = useQuery({
    queryKey: ['finance-report-templates', me.activeOrganizationId],
    queryFn: () => api<{ items: ReportTemplate[] }>('/finance/report-templates'),
  });
  const years = basics.years.data?.items ?? [],
    selectedYear = year || String(years[0]?.year ?? ''),
    valid = (templates.data?.items ?? []).filter(
      (tpl) =>
        Number(selectedYear) >= tpl.validFromYear &&
        (tpl.validToYear === null || Number(selectedYear) <= tpl.validToYear),
    ),
    selectedTemplate = valid.some((tpl) => tpl.id === templateId) ? templateId : '';
  const query = `fiscalYear=${selectedYear}${selectedTemplate ? `&templateId=${selectedTemplate}` : ''}`;
  const report = useQuery({
    queryKey: ['finance-report', me.activeOrganizationId, query],
    queryFn: () => api<AnnualReport>(`/finance/reports/annual?${query}`),
    enabled: Boolean(selectedYear),
  });
  async function pdf() {
    setError('');
    try {
      await downloadPrivateFile(
        `/finance/reports/annual/pdf?${query}&language=${i18n.language === 'it' ? 'it' : 'de'}`,
        `bnature-report-${selectedYear}.pdf`,
      );
    } catch (error) {
      setError(errorMessage(error));
    }
  }
  function csv(data: AnnualReport) {
    const columns = [t('ledgerSection'), t('name'), t('ledgerDirection'), t('financeCents')];
    const rows = [
      ...data.categories.map((c) => [
        t('ledgerCategory'),
        c.name,
        t(c.direction === 'income' ? 'ledgerIncome' : 'ledgerExpense'),
        c.totalCents,
      ]),
      ...data.accounts.flatMap((a) => [
        [t('ledgerAccount'), `${a.name} · ${t('ledgerOpening')}`, '', a.openingCents],
        [t('ledgerAccount'), `${a.name} · ${t('ledgerClosing')}`, '', a.closingCents],
      ]),
      ...(data.template?.lines.map((l) => [
        data.template!.name,
        `${l.code} ${l.label}`,
        t(l.direction === 'income' ? 'ledgerIncome' : 'ledgerExpense'),
        l.totalCents,
      ]) ?? []),
      [t('ledgerResult'), t('ledgerResult'), '', data.resultCents],
    ];
    downloadCsv(
      `bnature-report-${data.fiscalYear}.csv`,
      encodeCsv(
        rows.map((row) => Object.fromEntries(columns.map((key, index) => [key, row[index]]))),
        columns,
      ),
    );
  }
  if (basics.years.isPending || basics.categories.isPending || templates.isPending)
    return <Loading />;
  const failed = [basics.years, basics.categories, templates].find((q) => q.isError);
  if (failed) return <ErrorState error={failed.error} retry={() => void failed.refetch()} />;
  if (!years.length)
    return <Empty title={t('ledgerNoYearTitle')} description={t('ledgerNoYear')} />;
  const categories = basics.categories.data?.items ?? [],
    names = new Map(categories.map((c) => [c.id, c.name]));
  return (
    <div className="ledger-reports">
      <div className="toolbar ledger-toolbar">
        <label>
          <span className="sr-only">{t('ledgerFiscalYear')}</span>
          <select value={selectedYear} onChange={(event) => setYear(event.target.value)}>
            {years.map((y) => (
              <option key={y.year} value={y.year}>
                {y.year}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">{t('ledgerTemplate')}</span>
          <select value={selectedTemplate} onChange={(event) => setTemplateId(event.target.value)}>
            <option value="">{t('ledgerNoTemplate')}</option>
            {valid.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name} · v{tpl.version}
              </option>
            ))}
          </select>
        </label>
        <div className="ledger-toolbar-actions">
          <Button
            variant="secondary"
            disabled={!report.data}
            onClick={() => report.data && csv(report.data)}
          >
            <Download size={16} />
            {t('financeExport')}
          </Button>
          <Button variant="secondary" disabled={!report.data} onClick={() => void pdf()}>
            <Download size={16} />
            {t('ledgerReportPdf')}
          </Button>
        </div>
      </div>
      {notice && <Notice>{notice}</Notice>}
      {error && <Notice error>{error}</Notice>}
      {report.isPending ? (
        <Loading />
      ) : report.isError ? (
        <ErrorState error={report.error} retry={() => void report.refetch()} />
      ) : (
        <>
          {report.data.status === 'open' && <Notice>{t('ledgerReportProvisional')}</Notice>}
          {report.data.unbookedPaymentCount > 0 && (
            <Notice>
              {t('ledgerUnbookedPayments', { count: report.data.unbookedPaymentCount })}
            </Notice>
          )}
          <section
            className="stats-grid finance-stats ledger-report-stats"
            aria-label={t('ledgerReportSummary')}
          >
            {[
              ['ledgerIncome', report.data.incomeCents],
              ['ledgerExpense', report.data.expenseCents],
              ['ledgerResult', report.data.resultCents],
              ['ledgerClassFee', report.data.membershipFeeIncomeCents],
              ['ledgerClassDonation', report.data.donationIncomeCents],
            ].map(([label, value], index) => (
              <article key={label} className={`stat-card stat-${Math.min(index, 3)}`}>
                <div>
                  <span>{t(label!)}</span>
                </div>
                <strong>{formatMoney(value!, i18n.language)}</strong>
                <small>{report.data.fiscalYear}</small>
              </article>
            ))}
          </section>
          <div className="ledger-report-grid">
            <section aria-labelledby="ledger-report-categories">
              <h2 id="ledger-report-categories">{t('ledgerCategories')}</h2>
              <ul className="finance-allocation-history">
                {report.data.categories
                  .filter((c) => c.totalCents !== '0')
                  .map((c) => (
                    <li key={c.categoryId}>
                      <span>{c.name}</span>
                      <Amount cents={c.totalCents} direction={c.direction} />
                    </li>
                  ))}
              </ul>
            </section>
            <section aria-labelledby="ledger-report-accounts">
              <h2 id="ledger-report-accounts">{t('ledgerAccounts')}</h2>
              <ul className="finance-allocation-history">
                {report.data.accounts.map((a) => (
                  <li key={a.accountId}>
                    <span>
                      {a.name}
                      <small className="finance-cell-note">
                        {t('ledgerOpening')} {formatMoney(a.openingCents, i18n.language)}
                      </small>
                    </span>
                    <strong className="finance-money">
                      {formatMoney(a.closingCents, i18n.language)}
                    </strong>
                  </li>
                ))}
              </ul>
            </section>
          </div>
          {report.data.template && (
            <section className="ledger-template-result" aria-labelledby="ledger-report-template">
              <h2 id="ledger-report-template">
                {report.data.template.name} · v{report.data.template.version}
              </h2>
              {report.data.template.revenueThresholdCents !== null && (
                <Notice error={report.data.template.thresholdExceeded}>
                  {t(
                    report.data.template.thresholdExceeded
                      ? 'ledgerThresholdExceeded'
                      : 'ledgerThresholdOk',
                    {
                      amount: formatMoney(
                        report.data.template.revenueThresholdCents,
                        i18n.language,
                      ),
                    },
                  )}
                </Notice>
              )}
              <ul className="finance-allocation-history">
                {report.data.template.lines.map((line) => (
                  <li key={line.code}>
                    <span>
                      <strong>{line.code}</strong> {line.label}
                    </span>
                    <Amount cents={line.totalCents} direction={line.direction} />
                  </li>
                ))}
              </ul>
              {report.data.template.unmappedCategoryIds.length > 0 && (
                <p className="ledger-warning">
                  <TriangleAlert size={13} />{' '}
                  {t('ledgerUnmapped', {
                    names: report.data.template.unmappedCategoryIds
                      .map((id) => names.get(id))
                      .join(', '),
                  })}
                </p>
              )}
            </section>
          )}
        </>
      )}
      <section aria-labelledby="ledger-templates-heading" className="ledger-templates">
        <div className="ledger-section-heading">
          <div>
            <h2 id="ledger-templates-heading">{t('ledgerTemplates')}</h2>
            <p>{t('ledgerTemplatesHelp')}</p>
          </div>
          {canWrite && (
            <Button variant="secondary" disabled={!categories.length} onClick={() => setEditor({})}>
              <Plus size={17} />
              {t('ledgerAddTemplate')}
            </Button>
          )}
        </div>
        {templates.data!.items.length ? (
          <ul className="finance-allocation-history">
            {templates.data!.items.map((tpl) => (
              <li key={tpl.id}>
                <span>
                  <strong>{tpl.name}</strong> · v{tpl.version}
                  <small className="finance-cell-note">
                    {tpl.validFromYear}–{tpl.validToYear ?? '…'} · {tpl.lines.length}{' '}
                    {t('ledgerLines')}
                  </small>
                </span>
                {canWrite && (
                  <Button
                    variant="ghost"
                    aria-label={`${t('ledgerNewVersion')}: ${tpl.name}`}
                    onClick={() => setEditor({ template: tpl })}
                  >
                    <Pencil size={17} />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="finance-footnote">{t('ledgerNoTemplates')}</p>
        )}
      </section>
      {editor && (
        <Modal
          wide
          title={t(editor.template ? 'ledgerNewVersion' : 'ledgerAddTemplate')}
          onClose={() => setEditor(null)}
        >
          <TemplateForm
            template={editor.template}
            categories={categories}
            year={Number(selectedYear)}
            onCancel={() => setEditor(null)}
            onDone={() => {
              setEditor(null);
              setNotice(t('ledgerSavedTemplate'));
              refresh();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
type DraftLine = {
  key: string;
  code: string;
  label: string;
  direction: 'income' | 'expense';
  categoryIds: string[];
};
function TemplateForm({
  template,
  categories,
  year,
  onCancel,
  onDone,
}: {
  template?: ReportTemplate;
  categories: CashbookCategory[];
  year: number;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation(),
    write = useFinancialWrite();
  const [lines, setLines] = useState<DraftLine[]>(
      template?.lines.map((l) => ({ ...l, key: crypto.randomUUID() })) ?? [
        { key: crypto.randomUUID(), code: '', label: '', direction: 'income', categoryIds: [] },
      ],
    ),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  const update = (key: string, patch: Partial<DraftLine>) =>
    setLines((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget),
      threshold = String(form.get('threshold') ?? '').trim(),
      validTo = String(form.get('validToYear') ?? '').trim();
    try {
      const body = {
        name: form.get('name'),
        validFromYear: Number(form.get('validFromYear')),
        validToYear: validTo ? Number(validTo) : null,
        revenueThresholdCents: threshold ? parseEuroCents(threshold) : null,
        lines: lines.map(({ code, label, direction, categoryIds }) => ({
          code,
          label,
          direction,
          categoryIds,
        })),
      };
      setPending(true);
      await write(
        template
          ? `/finance/report-templates/${template.templateKey}/versions`
          : '/finance/report-templates',
        template ? { template: body, version: template.version } : body,
      );
      onDone();
    } catch (error) {
      setError(
        error instanceof Error && error.message === 'financeInvalidAmount'
          ? t('financeInvalidAmount')
          : errorMessage(error),
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <p className="finance-form-help">{t('ledgerTemplateFormHelp')}</p>
      <div className="form-grid">
        <Field label={`${t('name')} *`}>
          <input name="name" required maxLength={160} defaultValue={template?.name ?? ''} />
        </Field>
        <Field label={`${t('ledgerValidFrom')} *`}>
          <input
            name="validFromYear"
            required
            inputMode="numeric"
            defaultValue={template?.validFromYear ?? year}
          />
        </Field>
        <Field label={t('ledgerValidTo')}>
          <input
            name="validToYear"
            inputMode="numeric"
            defaultValue={template?.validToYear ?? ''}
          />
        </Field>
        <Field label={t('ledgerThreshold')} hint={t('ledgerThresholdHelp')}>
          <input
            name="threshold"
            inputMode="decimal"
            defaultValue={
              template?.revenueThresholdCents != null
                ? moneyInputValue(template.revenueThresholdCents)
                : ''
            }
          />
        </Field>
      </div>
      <fieldset>
        <legend>{t('ledgerLines')}</legend>
        <div className="ledger-line-list">
          {lines.map((line, index) => (
            <div className="ledger-line" key={line.key}>
              <div className="ledger-line-fields">
                <Field label={`${t('ledgerLineCode')} ${index + 1}`}>
                  <input
                    required
                    maxLength={20}
                    value={line.code}
                    onChange={(event) => update(line.key, { code: event.target.value })}
                  />
                </Field>
                <Field label={`${t('ledgerLineLabel')} ${index + 1}`}>
                  <input
                    required
                    maxLength={200}
                    value={line.label}
                    onChange={(event) => update(line.key, { label: event.target.value })}
                  />
                </Field>
                <Field label={`${t('ledgerDirection')} ${index + 1}`}>
                  <select
                    value={line.direction}
                    onChange={(event) =>
                      update(line.key, {
                        direction: event.target.value as DraftLine['direction'],
                        categoryIds: [],
                      })
                    }
                  >
                    <option value="income">{t('ledgerIncome')}</option>
                    <option value="expense">{t('ledgerExpense')}</option>
                  </select>
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={lines.length === 1 || pending}
                  aria-label={`${t('ledgerRemoveLine')} ${index + 1}`}
                  onClick={() => setLines((rows) => rows.filter((r) => r.key !== line.key))}
                >
                  <Trash2 size={17} />
                </Button>
              </div>
              <div
                className="ledger-line-categories"
                role="group"
                aria-label={`${t('ledgerCategories')} ${index + 1}`}
              >
                {categories
                  .filter((c) => c.direction === line.direction)
                  .map((c) => (
                    <label key={c.id} className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={line.categoryIds.includes(c.id)}
                        onChange={(event) =>
                          update(line.key, {
                            categoryIds: event.target.checked
                              ? [...line.categoryIds, c.id]
                              : line.categoryIds.filter((id) => id !== c.id),
                          })
                        }
                      />
                      <span>{c.name}</span>
                    </label>
                  ))}
              </div>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={lines.length >= 200 || pending}
          onClick={() =>
            setLines((rows) => [
              ...rows,
              {
                key: crypto.randomUUID(),
                code: '',
                label: '',
                direction: 'income',
                categoryIds: [],
              },
            ])
          }
        >
          <Plus size={16} />
          {t('ledgerAddLine')}
        </Button>
      </fieldset>
      {error && <Notice error>{error}</Notice>}
      <FormActions pending={pending} create={!template} onCancel={onCancel} />
    </form>
  );
}
