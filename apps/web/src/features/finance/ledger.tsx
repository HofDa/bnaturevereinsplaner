import { LedgerSetup } from './ledger-setup';
import { Reports } from './ledger-reports';
import { Amount } from './amount';
import { useLedgerBasics, refreshFinanceQueries as refresh } from './queries';
import { FinanceOverview, Transfers, EtsMappings, EntryHistory } from './extensions';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Download, Undo2, Paperclip } from 'lucide-react';
import { EntryDocuments } from '../documents';
import { z } from 'zod';
import {
  formatMoney,
  moneyTextSchema,
  parseEuroCents,
  cashbookEntryInputSchema,
  reversalInputSchema,
  type CashbookEntry,
  type Page,
} from '@bnature/contracts';
import { DataForm } from '../../components/data-form';
import {
  Button,
  Empty,
  ErrorState,
  Field,
  Loading,
  Modal,
  Notice,
  Pagination,
  SearchInput,
  formatDate,
} from '../../components/ui';
import { api, allPages, downloadPrivateFile, errorMessage } from '../../lib/api';
import { encodeCsv, downloadCsv } from '../../lib/csv';
import { useSession } from '../../app/session';
import { useDebounced } from '../../hooks/use-debounced';
import { useFinancialWrite } from './client';

export type LedgerTabName =
  'cashbook' | 'setup' | 'reports' | 'overview' | 'transfers' | 'categories';

export function LedgerTab({ tab }: { tab: LedgerTabName }) {
  if (tab === 'overview') return <FinanceOverview />;
  if (tab === 'transfers') return <Transfers />;
  if (tab === 'categories')
    return (
      <>
        <LedgerSetup categoriesOnly />
        <EtsMappings />
      </>
    );
  if (tab === 'cashbook') return <Cashbook />;
  if (tab === 'setup') return <LedgerSetup />;
  return <Reports />;
}

const entryFormSchema = z
  .object(cashbookEntryInputSchema.shape)
  .omit({ amountCents: true })
  .extend({ amount: moneyTextSchema })
  .transform(({ amount, ...rest }) => ({ ...rest, amountCents: parseEuroCents(amount) }));
type CashbookEditor =
  | { type: 'new' }
  | { type: 'reverse'; entry: CashbookEntry }
  | { type: 'documents'; entry: CashbookEntry }
  | { type: 'history'; entry: CashbookEntry };
function Cashbook() {
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    write = useFinancialWrite(),
    basics = useLedgerBasics(),
    canWrite = me.permissions.includes('finance:write'),
    canDocuments = me.permissions.includes('documents:read');
  const [year, setYear] = useState(''),
    [account, setAccount] = useState(''),
    [category, setCategory] = useState(''),
    [direction, setDirection] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
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
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
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
        <Field label={t('s22FromDate')}>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label={t('s22ToDate')}>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <div className="ledger-toolbar-actions">
          <Button
            variant="secondary"
            onClick={async () => {
              setError('');
              try {
                await downloadPrivateFile(
                  `/finance/cashbook-export/pdf?${q}&language=${i18n.language === 'it' ? 'it' : 'de'}`,
                  'bnature-cashbook.pdf',
                );
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            {t('s22CashbookPdf')}
          </Button>
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
                  {canDocuments && <th>{t('actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {entries.data.items.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <strong>
                        <button
                          type="button"
                          className="link-button"
                          aria-label={`${t('s22History')}: ${entry.fiscalYear}/${entry.entryNumber}`}
                          onClick={() => setEditor({ type: 'history', entry })}
                        >
                          {entry.fiscalYear}/{entry.entryNumber}
                        </button>
                      </strong>
                    </td>
                    <td>{formatDate(entry.bookingDate, i18n.language)}</td>
                    <td>
                      {entry.description}
                      <small className="finance-cell-note">
                        {[entry.counterparty, entry.documentNumber, entry.project]
                          .filter(Boolean)
                          .join(' · ')}
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
                    {canDocuments && (
                      <td>
                        <div className="finance-row-actions">
                          <Button
                            variant="ghost"
                            aria-label={`${t('documentReceipts')}: ${entry.fiscalYear}/${entry.entryNumber}`}
                            onClick={() => setEditor({ type: 'documents', entry })}
                          >
                            <Paperclip size={17} />
                          </Button>
                          {canWrite &&
                            !entry.reversesEntryId &&
                            !entry.reversedByEntryId &&
                            !entry.paymentId && (
                              <Button
                                variant="ghost"
                                aria-label={`${t('ledgerReverse')}: ${entry.fiscalYear}/${entry.entryNumber}`}
                                onClick={() => setEditor({ type: 'reverse', entry })}
                              >
                                <Undo2 size={17} />
                              </Button>
                            )}
                        </div>
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
          title={
            editor.type === 'history'
              ? t('s22History')
              : editor.type === 'documents'
                ? `${t('documentReceipts')} ${editor.entry.fiscalYear}/${editor.entry.entryNumber}`
                : t(editor.type === 'new' ? 'ledgerAddEntry' : 'ledgerReverse')
          }
          onClose={() => setEditor(null)}
        >
          {editor.type === 'history' ? (
            <EntryHistory id={editor.entry.id} />
          ) : editor.type === 'documents' ? (
            <EntryDocuments
              entryId={editor.entry.id}
              title={editor.entry.description}
              canWrite={canWrite && me.permissions.includes('documents:write')}
            />
          ) : editor.type === 'new' ? (
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
                  { name: 'project', label: 's22Project' },
                ]}
                defaults={{
                  categoryId: '',
                  amount: '',
                  bookingDate: openYears[0]!.startsOn,
                  documentDate: openYears[0]!.startsOn,
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
