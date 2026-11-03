import { useLedgerBasics, refreshFinanceQueries as refresh } from './queries';
import { FinanceInitialize } from './extensions';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Lock, TriangleAlert } from 'lucide-react';
import { z } from 'zod';
import {
  formatMoney,
  parseEuroCents,
  moneyInputValue,
  accountInputSchema,
  categoryInputSchema,
  type FinanceAccount,
  type CashbookCategory,
  type FiscalYear,
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
} from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { useSession } from '../../app/session';
import { useFinancialWrite } from './client';
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
const accountFormSchema = accountInputSchema;
const accountPatchFormSchema = accountInputSchema.omit({ kind: true });
type SetupEditor =
  | { type: 'account'; account?: FinanceAccount }
  | { type: 'category'; category?: CashbookCategory }
  | { type: 'year' }
  | { type: 'close'; year: FiscalYear };
export function LedgerSetup({ categoriesOnly = false }: { categoriesOnly?: boolean }) {
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
      <FinanceInitialize />
      {!categoriesOnly && (
        <>
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
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label={t('ledgerAccounts')}
              >
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
        </>
      )}
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
                      await write(`/finance/fiscal-years/${editor.year.year}/close`, {
                        confirm: true,
                      });
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
    [startsOn, setStartsOn] = useState(''),
    [endsOn, setEndsOn] = useState(''),
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
        startsOn: startsOn || `${parsedYear}-01-01`,
        endsOn: endsOn || `${parsedYear}-12-31`,
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
      <div className="form-grid">
        <Field label={t('s22StartsOn')}>
          <input
            type="date"
            value={startsOn || `${year}-01-01`}
            onChange={(e) => setStartsOn(e.target.value)}
          />
        </Field>
        <Field label={t('s22EndsOn')}>
          <input
            type="date"
            value={endsOn || `${year}-12-31`}
            onChange={(e) => setEndsOn(e.target.value)}
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
