import { EntryDocuments } from '../documents';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  ETS_POSITIONS,
  ETS_DEFINITION_VERSION,
  formatMoney,
  moneyTextSchema,
  parseEuroCents,
  transferInputSchema,
  type FinanceDashboard,
  type LedgerTransfer,
  type EtsReport,
  type CashbookEntry,
  type CashbookCategory,
  type FiscalYear,
  type FinanceAccount,
  localDate,
} from '@bnature/contracts';
import {
  Button,
  Field,
  Loading,
  ErrorState,
  Empty,
  Modal,
  Notice,
  formatDate,
} from '../../components/ui';
import { DataForm } from '../../components/data-form';
import { api, downloadPrivateFile, errorMessage, queryClient } from '../../lib/api';
import { useSession } from '../../app/session';
import { useFinancialWrite } from './client';
const refresh = () =>
  void queryClient.invalidateQueries({
    predicate: (q) => String(q.queryKey[0]).startsWith('finance-'),
  });
function useBasics() {
  const { me } = useSession();
  const accounts = useQuery({
    queryKey: ['finance-accounts', me.activeOrganizationId],
    queryFn: () => api<{ items: FinanceAccount[] }>('/finance/accounts'),
  });
  const years = useQuery({
    queryKey: ['finance-fiscal-years', me.activeOrganizationId],
    queryFn: () => api<{ items: FiscalYear[] }>('/finance/fiscal-years'),
  });
  const categories = useQuery({
    queryKey: ['finance-categories', me.activeOrganizationId],
    queryFn: () => api<{ items: CashbookCategory[] }>('/finance/categories'),
  });
  return { accounts, years, categories };
}
export function FinanceOverview() {
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    basics = useBasics(),
    [selected, setSelected] = useState('');
  const dashboard = useQuery({
    queryKey: ['finance-dashboard', me.activeOrganizationId, selected],
    queryFn: () =>
      api<FinanceDashboard>(`/finance/dashboard${selected ? `?fiscalYear=${selected}` : ''}`),
    enabled: basics.years.isSuccess && Boolean(basics.years.data.items.length),
  });
  if (basics.years.isPending) return <Loading />;
  if (basics.years.isError) return <ErrorState error={basics.years.error} />;
  if (!basics.years.data.items.length)
    return (
      <>
        <Empty description={t('ledgerNoYear')} />
        <FinanceInitialize />
      </>
    );
  return (
    <div className="ledger-reports">
      <Field label={t('ledgerFiscalYear')}>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">{t('s22CurrentYear')}</option>
          {basics.years.data.items.map((y) => (
            <option key={y.year} value={y.year}>
              {y.year} · {y.startsOn} – {y.endsOn}
            </option>
          ))}
        </select>
      </Field>
      {dashboard.isPending ? (
        <Loading />
      ) : dashboard.isError ? (
        <ErrorState error={dashboard.error} />
      ) : (
        <>
          <section className="stats-grid finance-stats" aria-label={t('s22Overview')}>
            {(
              [
                ['s22Total', 'totalCents'],
                ['ledgerBank', 'bankCents'],
                ['ledgerCash', 'cashCents'],
                ['ledgerIncome', 'incomeCents'],
                ['ledgerExpense', 'expenseCents'],
                ['financeOutstanding', 'openFeesCents'],
              ] as const
            ).map(([label, key], i) => (
              <article className={`stat-card stat-${i % 4}`} key={key}>
                <span>{t(label)}</span>
                <strong>{formatMoney(dashboard.data[key], i18n.language)}</strong>
                <small>{dashboard.data.fiscalYear}</small>
              </article>
            ))}
          </section>
          <h2>{t('s22Trend')}</h2>
          <div className="table-scroll" tabIndex={0} role="region" aria-label={t('s22Trend')}>
            <table>
              <thead>
                <tr>
                  <th>{t('s22Month')}</th>
                  <th>{t('ledgerIncome')}</th>
                  <th>{t('ledgerExpense')}</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.data.trend.map((m) => (
                  <tr key={m.month}>
                    <th>{m.month}</th>
                    <td>{formatMoney(m.incomeCents, i18n.language)}</td>
                    <td>{formatMoney(m.expenseCents, i18n.language)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>{t('s22Recent')}</h2>
          <ul className="finance-allocation-history">
            {dashboard.data.recent.map((e) => (
              <li key={e.id}>
                <span>
                  {e.fiscalYear}/{e.entryNumber} · {e.description}
                  <small className="finance-cell-note">
                    {formatDate(e.bookingDate, i18n.language)} · {e.accountName}
                  </small>
                </span>
                <strong>
                  {e.direction === 'expense' ? '−' : '+'}
                  {formatMoney(e.amountCents, i18n.language)}
                </strong>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
export function FinanceInitialize() {
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    write = useFinancialWrite(),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  if (!me.permissions.includes('finance:write')) return null;
  return (
    <section>
      <p>{t('s22InitializeHelp')}</p>
      {error && <Notice error>{error}</Notice>}
      <Button
        variant="secondary"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError('');
          try {
            await write('/finance/initialize', { language: i18n.language === 'it' ? 'it' : 'de' });
            refresh();
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setPending(false);
          }
        }}
      >
        {t('s22Initialize')}
      </Button>
    </section>
  );
}
const transferForm = z
  .object({ ...transferInputSchema.shape, amount: moneyTextSchema })
  .omit({ amountCents: true })
  .transform(({ amount, ...rest }) => ({ ...rest, amountCents: parseEuroCents(amount) }));
export function Transfers() {
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    write = useFinancialWrite(),
    basics = useBasics();
  const [year, setYear] = useState(''),
    [editor, setEditor] = useState<{ transfer?: LedgerTransfer } | null>(null),
    [documentTransfer, setDocumentTransfer] = useState<LedgerTransfer | null>(null);
  const selected = year || String(basics.years.data?.items[0]?.year ?? '');
  const query = useQuery({
    queryKey: ['finance-transfers', me.activeOrganizationId, selected],
    queryFn: () => api<{ items: LedgerTransfer[] }>(`/finance/transfers?fiscalYear=${selected}`),
    enabled: Boolean(selected),
  });
  if (basics.years.isPending || basics.accounts.isPending) return <Loading />;
  const failed = [basics.years, basics.accounts].find((q) => q.isError);
  if (failed) return <ErrorState error={failed.error} />;
  const years = basics.years.data?.items ?? [],
    accounts = basics.accounts.data?.items ?? [],
    names = new Map(accounts.map((a) => [a.id, a.name])),
    items = query.data?.items ?? [],
    reversed = new Set(items.map((x) => x.reversesTransferId));
  return (
    <div>
      <p>{t('s22TransferHelp')}</p>
      <div className="toolbar">
        <Field label={t('ledgerFiscalYear')}>
          <select value={selected} onChange={(e) => setYear(e.target.value)}>
            {years.map((y) => (
              <option value={y.year} key={y.year}>
                {y.year}
              </option>
            ))}
          </select>
        </Field>
        {me.permissions.includes('finance:write') && (
          <Button
            disabled={
              !years.some((y) => y.status === 'open') || accounts.filter((a) => a.active).length < 2
            }
            onClick={() => setEditor({})}
          >
            {t('s22AddTransfer')}
          </Button>
        )}
      </div>
      {!selected ? (
        <Empty description={t('ledgerNoYear')} />
      ) : query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} />
      ) : (
        <ul className="finance-allocation-history">
          {items.map((tr) => (
            <li key={tr.id}>
              <span>
                {formatDate(tr.bookingDate, i18n.language)} · {names.get(tr.fromAccountId)} →{' '}
                {names.get(tr.toAccountId)}
                <small className="finance-cell-note">
                  {tr.description} ·{' '}
                  {tr.reversesTransferId ? t('ledgerReverses') : tr.id.slice(0, 8)}
                </small>
              </span>
              <strong>{formatMoney(tr.amountCents, i18n.language)}</strong>
              {me.permissions.includes('documents:read') && (
                <Button variant="secondary" onClick={() => setDocumentTransfer(tr)}>
                  {t('documents')}
                </Button>
              )}
              {me.permissions.includes('finance:write') &&
                !tr.reversesTransferId &&
                !reversed.has(tr.id) && (
                  <Button variant="ghost" onClick={() => setEditor({ transfer: tr })}>
                    {t('s22ReverseTransfer')}
                  </Button>
                )}
            </li>
          ))}
        </ul>
      )}
      {documentTransfer && (
        <Modal title={t('documents')} onClose={() => setDocumentTransfer(null)}>
          <EntryDocuments
            transferId={documentTransfer.id}
            title={documentTransfer.description}
            canWrite={
              me.permissions.includes('documents:write') && me.permissions.includes('finance:write')
            }
          />
        </Modal>
      )}
      {editor && (
        <Modal
          title={t(editor.transfer ? 's22ReverseTransfer' : 's22AddTransfer')}
          onClose={() => setEditor(null)}
        >
          <DataForm
            create
            schema={
              editor.transfer
                ? z.object({ bookingDate: z.iso.date(), reason: z.string().trim().min(1).max(300) })
                : transferForm
            }
            fields={
              editor.transfer
                ? [
                    {
                      name: 'bookingDate',
                      label: 'ledgerBookingDate',
                      type: 'date',
                      required: true,
                    },
                    { name: 'reason', label: 'reason', required: true },
                  ]
                : [
                    {
                      name: 'fromAccountId',
                      label: 's22FromAccount',
                      type: 'select',
                      required: true,
                      options: accounts
                        .filter((a) => a.active)
                        .map((a) => ({ value: a.id, label: a.name })),
                    },
                    {
                      name: 'toAccountId',
                      label: 's22ToAccount',
                      type: 'select',
                      required: true,
                      options: accounts
                        .filter((a) => a.active)
                        .map((a) => ({ value: a.id, label: a.name })),
                    },
                    {
                      name: 'amount',
                      label: 'financeAmount',
                      required: true,
                      inputMode: 'decimal',
                    },
                    {
                      name: 'bookingDate',
                      label: 'ledgerBookingDate',
                      type: 'date',
                      required: true,
                    },
                    { name: 'description', label: 'ledgerDescription', required: true },
                  ]
            }
            defaults={{
              bookingDate:
                editor.transfer?.bookingDate ?? years.find((y) => y.status === 'open')?.startsOn,
              fromAccountId: accounts[0]?.id,
              toAccountId: accounts[1]?.id,
            }}
            onCancel={() => setEditor(null)}
            onSubmit={async (value) => {
              await write(
                editor.transfer
                  ? `/finance/transfers/${editor.transfer.id}/reversal`
                  : '/finance/transfers',
                value,
              );
              setEditor(null);
              refresh();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
export function EtsMappings() {
  const { t, i18n } = useTranslation(),
    basics = useBasics(),
    { me } = useSession(),
    write = useFinancialWrite(),
    [category, setCategory] = useState(''),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  const selected = category || basics.categories.data?.items[0]?.id || '';
  const current = basics.categories.data?.items.find((c) => c.id === selected);
  const mappings = useQuery({
    queryKey: ['finance-mappings', me.activeOrganizationId, selected],
    queryFn: () =>
      api<{
        items: Array<{
          id: string;
          position: string;
          effectiveFrom: string;
          definitionVersion: string;
        }>;
      }>(`/finance/categories/${selected}/ets-mappings`),
    enabled: Boolean(selected),
  });
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError('');
    setPending(true);
    try {
      await write(`/finance/categories/${selected}/ets-mappings`, {
        effectiveFrom: form.get('effectiveFrom'),
        position: form.get('position'),
      });
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <section>
      <h2>{t('s22Mappings')}</h2>
      <p>{t('s22MappingHelp')}</p>
      {error && <Notice error>{error}</Notice>}
      {basics.categories.isPending ? (
        <Loading />
      ) : basics.categories.isError ? (
        <ErrorState error={basics.categories.error} />
      ) : (
        <>
          <Field label={t('ledgerCategory')}>
            <select value={selected} onChange={(e) => setCategory(e.target.value)}>
              {basics.categories.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          {mappings.isError ? (
            <ErrorState error={mappings.error} />
          ) : (
            <ul className="finance-allocation-history">
              {mappings.data?.items.map((m) => (
                <li key={m.id}>
                  {m.effectiveFrom} · {m.position} · {m.definitionVersion}
                </li>
              ))}
            </ul>
          )}
          {me.permissions.includes('finance:write') && current && (
            <form onSubmit={(e) => void submit(e)} className="form-grid">
              <Field label={t('s22EffectiveFrom')}>
                <input name="effectiveFrom" type="date" required defaultValue={localDate()} />
              </Field>
              <Field label={t('s22Position')}>
                <select name="position" required>
                  {ETS_POSITIONS.filter((p) => p.direction === current.direction).map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.code} · {p[i18n.language === 'it' ? 'it' : 'de']}
                    </option>
                  ))}
                </select>
              </Field>
              <Button type="submit" disabled={pending}>
                {t('save')}
              </Button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
export function PaymentBackfill() {
  const { t } = useTranslation(),
    { me } = useSession(),
    basics = useBasics(),
    write = useFinancialWrite(),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [pending, setPending] = useState(false);
  if (!me.permissions.includes('finance:write')) return null;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    setError('');
    try {
      const r = await write<{ booked: number; remaining: number }>('/finance/payments/backfill', {
        fiscalYear: Number(f.get('year')),
        method: f.get('method'),
        accountId: f.get('accountId'),
        categoryId: f.get('categoryId'),
      });
      setNotice(t('s22BackfillResult', r));
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <section>
      <h2>{t('s22Backfill')}</h2>
      <p>{t('s22BackfillHelp')}</p>
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      <form onSubmit={(e) => void submit(e)} className="form-grid">
        <Field label={t('ledgerFiscalYear')}>
          <select name="year" required>
            {basics.years.data?.items
              .filter((y) => y.status === 'open')
              .map((y) => (
                <option key={y.year}>{y.year}</option>
              ))}
          </select>
        </Field>
        <Field label={t('financeMethod')}>
          <select name="method">
            <option value="bank_transfer">{t('ledgerBank')}</option>
            <option value="cash">{t('ledgerCash')}</option>
            <option value="other">{t('ledgerClassOther')}</option>
          </select>
        </Field>
        <Field label={t('ledgerAccount')}>
          <select name="accountId" required>
            {basics.accounts.data?.items
              .filter((a) => a.active)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label={t('ledgerCategory')}>
          <select name="categoryId" required>
            {basics.categories.data?.items
              .filter((c) => c.active && c.classification === 'membership_fee')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
        <Button type="submit" disabled={pending}>
          {t('s22Backfill')}
        </Button>
      </form>
    </section>
  );
}
export function EtsReports({ year }: { year: string }) {
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    [model, setModel] = useState('D'),
    [legal, setLegal] = useState('unknown'),
    [revenue, setRevenue] = useState(''),
    [error, setError] = useState('');
  const validRevenue = !revenue || moneyTextSchema.safeParse(revenue).success;
  const query = new URLSearchParams({
    fiscalYear: year,
    model,
    language: i18n.language === 'it' ? 'it' : 'de',
    legalPersonality: legal,
    ...(revenue && validRevenue ? { priorRevenueCents: String(parseEuroCents(revenue)) } : {}),
  }).toString();
  const report = useQuery({
    queryKey: ['finance-ets-report', me.activeOrganizationId, query],
    queryFn: () => api<EtsReport>(`/finance/reports/ets?${query}`),
    enabled: Boolean(year),
  });
  async function download(format: 'pdf' | 'csv') {
    setError('');
    try {
      await downloadPrivateFile(
        `/finance/reports/ets/${format}?${query}`,
        `bnature-ETS-${model}-${year}.${format}`,
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <section className="ledger-templates">
      <h2>{t('s22Ets')}</h2>
      <p>{ETS_DEFINITION_VERSION}</p>
      <div className="form-grid">
        <Field label={t('s22Model')}>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option>D</option>
            <option>E</option>
          </select>
        </Field>
        <Field label={t('s22LegalPersonality')}>
          <select value={legal} onChange={(e) => setLegal(e.target.value)}>
            <option value="unknown">{t('s22Unknown')}</option>
            <option value="yes">{t('s22Yes')}</option>
            <option value="no">{t('s22No')}</option>
          </select>
        </Field>
        <Field label={t('s22PriorRevenue')} hint={t('s22PriorRevenueHelp')}>
          <input
            inputMode="decimal"
            value={revenue}
            onChange={(e) => {
              const v = e.target.value;
              setRevenue(v);
            }}
          />
        </Field>
      </div>
      {error && <Notice error>{error}</Notice>}
      {!validRevenue && <Notice error>{t('financeInvalidAmount')}</Notice>}
      {report.isPending ? (
        <Loading />
      ) : report.isError ? (
        <ErrorState error={report.error} />
      ) : (
        <>
          <Notice>{report.data.notice}</Notice>
          <Notice error={report.data.eligibility !== 'within_limit'}>
            {t(`s22Eligibility_${report.data.eligibility}`)}
          </Notice>
          <ul>
            {report.data.checks.map((c) => (
              <li key={c.code}>
                {c.ok ? '✓' : '!'} {t(`s22Check_${c.code}`)}
              </li>
            ))}
          </ul>
          {report.data.unmappedEntryIds.length > 0 && (
            <p className="ledger-warning">
              {t('s22MissingMappings', { count: report.data.unmappedEntryIds.length })}
            </p>
          )}
          <div className="toolbar">
            <Button variant="secondary" onClick={() => void download('pdf')}>
              {t('s22EtsPdf')}
            </Button>
            <Button variant="secondary" onClick={() => void download('csv')}>
              {t('s22EtsCsv')}
            </Button>
          </div>
          <div className="table-scroll" tabIndex={0} role="region" aria-label={t('s22Ets')}>
            <table>
              <thead>
                <tr>
                  <th>{t('ledgerSection')}</th>
                  <th>{t('ledgerIncome')}</th>
                  <th>{t('ledgerExpense')}</th>
                  <th>{t('ledgerResult')}</th>
                  <th>{t('s22PriorYear')}</th>
                </tr>
              </thead>
              <tbody>
                {report.data.rows.map((r) => (
                  <tr key={r.code}>
                    <th>
                      {r.code} · {r.label}
                    </th>
                    <td>{formatMoney(r.incomeCents, i18n.language)}</td>
                    <td>{formatMoney(r.expenseCents, i18n.language)}</td>
                    <td>{formatMoney(r.resultCents, i18n.language)}</td>
                    <td>
                      {r.priorResultCents === null
                        ? '—'
                        : formatMoney(r.priorResultCents, i18n.language)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="finance-allocation-history">
            {report.data.accounts.map((a) => (
              <li key={a.accountId}>
                <span>
                  {a.name} · {t(a.kind === 'cash' ? 'ledgerCash' : 'ledgerBank')}
                </span>
                <strong>
                  {formatMoney(a.openingCents, i18n.language)} →{' '}
                  {formatMoney(a.closingCents, i18n.language)}
                </strong>
              </li>
            ))}
          </ul>
          <p>
            {t('ledgerOpening')}: {formatMoney(report.data.openingCents, i18n.language)} ·{' '}
            {t('ledgerClosing')}: {formatMoney(report.data.closingCents, i18n.language)}
          </p>
        </>
      )}
    </section>
  );
}

export function EntryHistory({ id }: { id: string }) {
  const { t, i18n } = useTranslation(),
    { me } = useSession();
  const query = useQuery({
    queryKey: ['finance-entry-history', me.activeOrganizationId, id],
    queryFn: () => api<{ items: CashbookEntry[] }>(`/finance/cashbook/${id}/history`),
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} />;
  return (
    <ul className="finance-allocation-history">
      {query.data.items.map((e) => (
        <li key={e.id}>
          <span>
            {e.fiscalYear}/{e.entryNumber} · {e.description}
            <small className="finance-cell-note">
              {formatDate(e.bookingDate, i18n.language)} · {e.categoryName} · {e.project} ·{' '}
              {e.reversalReason} · {t('s22RecordedAt')}{' '}
              {new Date(e.createdAt).toLocaleString(i18n.language)}
            </small>
          </span>
          <strong>{formatMoney(e.amountCents, i18n.language)}</strong>
        </li>
      ))}
    </ul>
  );
}
