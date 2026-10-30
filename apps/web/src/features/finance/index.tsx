import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Download,
  ArrowUpRight,
  Pencil,
  Bell,
  Receipt,
  Coins,
  Wallet,
  Clock3,
  BookCheck,
  Undo2,
} from 'lucide-react';
import {
  formatMoney,
  type FeePlan,
  type FeeAssessment,
  type Payment,
  type FeeReminder,
  type FinanceSummary,
  type AssessmentDetail,
  type Page,
} from '@bnature/contracts';
import {
  Button,
  Empty,
  ErrorState,
  Loading,
  Modal,
  Notice,
  PageHeading,
  Pagination,
  SearchInput,
  formatDate,
} from '../../components/ui';
import { api, allPages, downloadPrivateFile, errorMessage, queryClient } from '../../lib/api';
import { encodeCsv, downloadCsv } from '../../lib/csv';
import { useSession } from '../../app/session';
import { useDebounced } from '../../hooks/use-debounced';
import { PlanForm, AssessmentForm, PaymentForm } from './forms';
import { useFinancialWrite } from './client';
import { LedgerTab, type LedgerTabName } from './ledger';
import { BookingForm, PaymentReversalForm } from './forms';

type Tab = 'assessments' | 'plans' | 'payments' | LedgerTabName;
const tabLabels: Record<Tab, string> = {
  overview: 's22Overview',
  assessments: 'financeAssessments',
  plans: 'financePlans',
  payments: 'financePayments',
  cashbook: 'ledgerCashbook',
  setup: 'ledgerSetup',
  categories: 'ledgerCategories',
  transfers: 's22Transfers',
  reports: 'ledgerReports',
};
type Editor =
  | { type: 'plan'; plan?: FeePlan }
  | { type: 'assessment' }
  | { type: 'payment'; assessment?: FeeAssessment }
  | { type: 'assessment-detail'; id: string }
  | { type: 'payment-detail'; id: string };
export function FeeStatus({ item }: { item: FeeAssessment }) {
  const { t } = useTranslation();
  const key = {
    open: 'financeOpen',
    partial: 'financePartial',
    paid: 'financeSettled',
    exempt: 'financeExemption',
  }[item.status];
  return (
    <span className="finance-status-pair">
      <span className={`badge finance-status-${item.status}`}>
        <span />
        {t(key)}
      </span>
      {item.overdue && <span className="finance-overdue-label">{t('financeOverdue')}</span>}
    </span>
  );
}
export function Finance() {
  const { t, i18n } = useTranslation(),
    { me } = useSession();
  const [tab, setTab] = useState<Tab>('overview'),
    [year, setYear] = useState(String(new Date().getFullYear())),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [sort, setSort] = useState('createdAt'),
    [page, setPage] = useState(1),
    [active, setActive] = useState(''),
    [editor, setEditor] = useState<Editor | null>(null),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [reminder, setReminder] = useState<FeeReminder | null>(null);
  const write = useFinancialWrite(),
    debounced = useDebounced(search),
    canWrite = me.permissions.includes('finance:write'),
    canPlans = me.permissions.includes('finance:plans');
  const q = new URLSearchParams({
    search: debounced,
    page: String(page),
    sort,
    direction: sort === 'name' ? 'asc' : 'desc',
    ...(year && tab !== 'plans' ? { fiscalYear: year } : {}),
    ...(tab === 'assessments' && status ? { status } : {}),
    ...(tab === 'plans' && active ? { active } : {}),
  }).toString();
  const summary = useQuery({
    queryKey: ['finance-summary', me.activeOrganizationId, year],
    queryFn: () => api<FinanceSummary>(`/finance/summary${year ? `?fiscalYear=${year}` : ''}`),
  });
  const assessments = useQuery({
    queryKey: ['finance-assessments', me.activeOrganizationId, q],
    queryFn: () => api<Page<FeeAssessment>>(`/fee-assessments?${q}`),
    enabled: tab === 'assessments',
  });
  const plans = useQuery({
    queryKey: ['finance-plans', me.activeOrganizationId, q],
    queryFn: () => api<Page<FeePlan>>(`/fee-plans?${q}`),
    enabled: tab === 'plans',
  });
  const payments = useQuery({
    queryKey: ['finance-payments', me.activeOrganizationId, q],
    queryFn: () => api<Page<Payment>>(`/payments?${q}`),
    enabled: tab === 'payments',
  });
  const refresh = () =>
    void queryClient.invalidateQueries({
      predicate: (query) => String(query.queryKey[0]).startsWith('finance-'),
    });
  const completed = (message: string) => {
    setEditor(null);
    setReminder(null);
    setNotice(t(message));
    setError('');
    setPage(1);
    refresh();
  };
  async function receipt(id: string) {
    setError('');
    try {
      await downloadPrivateFile(
        `/payments/${id}/receipt?language=${i18n.language === 'it' ? 'it' : 'de'}`,
        `bnature-payment-${id}.pdf`,
      );
    } catch (error) {
      setError(errorMessage(error));
    }
  }
  async function reminderPdf(item: FeeReminder) {
    setError('');
    try {
      await downloadPrivateFile(
        `/fee-reminders/${item.id}/pdf?language=${i18n.language === 'it' ? 'it' : 'de'}`,
        `bnature-reminder-${item.id}.pdf`,
      );
    } catch (error) {
      setError(`${t('financeDownloadFailed')} ${errorMessage(error)}`);
    }
  }
  async function prepareReminder(item: FeeAssessment) {
    setBusy(true);
    setError('');
    try {
      const result = await write<FeeReminder>(`/fee-assessments/${item.id}/reminders`, {});
      setReminder(result);
      setNotice(t('financeReminderPrepared'));
      await reminderPdf(result);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function exportCsv() {
    setBusy(true);
    setError('');
    try {
      const parameters = new URLSearchParams(q);
      parameters.delete('page');
      const path = tab === 'assessments' ? '/fee-assessments' : '/payments';
      if (tab === 'assessments') {
        const rows = await allPages<FeeAssessment>(`${path}?${parameters}`);
        const columns = [
          t('financeMember'),
          t('memberNumber'),
          t('financeYear'),
          t('financePlan'),
          t('financeDueDate'),
          t('financeCents'),
          t('financePaidCents'),
          t('financeOpenCents'),
          t('status'),
        ];
        const data = rows.map((row) =>
          Object.fromEntries(
            columns.map((key, index) => [
              key,
              [
                row.memberName,
                row.membershipNumber,
                row.fiscalYear,
                row.planName,
                row.dueDate,
                row.amountCents,
                row.paidCents,
                row.openCents,
                t(
                  {
                    open: 'financeOpen',
                    partial: 'financePartial',
                    paid: 'financeSettled',
                    exempt: 'financeExemption',
                  }[row.status],
                ),
              ][index],
            ]),
          ),
        );
        downloadCsv('bnature-fee-assessments.csv', encodeCsv(data, columns));
      } else {
        const rows = await allPages<Payment>(`${path}?${parameters}`),
          columns = [
            t('financeReceiptNumber'),
            t('financePayerName'),
            t('financePaidOn'),
            t('financeMethod'),
            t('financeReference'),
            t('financeCents'),
          ];
        downloadCsv(
          'bnature-payments.csv',
          encodeCsv(
            rows.map((row) =>
              Object.fromEntries(
                columns.map((key, index) => [
                  key,
                  [
                    receiptNumber(row.receiptNumber),
                    row.payerName,
                    row.paidOn,
                    t(methodKey(row.method)),
                    row.reference,
                    row.amountCents,
                  ][index],
                ]),
              ),
            ),
            columns,
          ),
        );
      }
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  const current = tab === 'assessments' ? assessments : tab === 'plans' ? plans : payments,
    ledger =
      tab === 'cashbook' ||
      tab === 'setup' ||
      tab === 'reports' ||
      tab === 'overview' ||
      tab === 'transfers' ||
      tab === 'categories';
  return (
    <>
      <PageHeading
        title={t('finance')}
        description={t('financeIntro')}
        actions={
          !ledger && (
            <>
              {tab !== 'plans' && (
                <Button variant="secondary" disabled={busy} onClick={() => void exportCsv()}>
                  <Download size={16} />
                  {t(busy ? 'financeExporting' : 'financeExport')}
                </Button>
              )}
              {tab === 'plans'
                ? canPlans && (
                    <Button onClick={() => setEditor({ type: 'plan' })}>
                      <Plus size={17} />
                      {t('financeAddPlan')}
                    </Button>
                  )
                : canWrite && (
                    <Button
                      onClick={() =>
                        setEditor({ type: tab === 'assessments' ? 'assessment' : 'payment' })
                      }
                    >
                      <Plus size={17} />
                      {t(tab === 'assessments' ? 'financeAddAssessment' : 'financeAddPayment')}
                    </Button>
                  )}
            </>
          )
        }
      />
      {notice && (
        <Notice>
          <span>{notice}</span>
          {reminder && (
            <Button variant="ghost" onClick={() => void reminderPdf(reminder)}>
              {t('financeDownloadReminder')}
            </Button>
          )}
        </Notice>
      )}
      {error && <Notice error>{error}</Notice>}
      {!ledger && (
        <>
          <div className="finance-year-row">
            <label className="finance-year-filter">
              <span>{t(tab === 'payments' ? 'financePaymentYear' : 'financeYear')}</span>
              <select
                value={year}
                onChange={(event) => {
                  setYear(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">{t('financeAllYears')}</option>
                {Array.from({ length: 301 }, (_, i) => 2200 - i).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <p>{t('financeYearHelp')}</p>
          </div>
          {summary.isPending ? (
            <Loading />
          ) : summary.isError ? (
            <ErrorState error={summary.error} retry={() => void summary.refetch()} />
          ) : (
            <section className="stats-grid finance-stats" aria-label={t('financeSummaryHint')}>
              {[
                { label: 'financeAssessed', value: summary.data.assessedCents, icon: Coins },
                { label: 'financePaid', value: summary.data.paidCents, icon: Receipt },
                { label: 'financeOutstanding', value: summary.data.openCents, icon: Wallet },
                { label: 'financeOverdue', value: summary.data.overdueCents, icon: Clock3 },
              ].map((item, index) => (
                <article key={item.label} className={`stat-card stat-${index}`}>
                  <div>
                    <span>{t(item.label)}</span>
                    <item.icon size={19} />
                  </div>
                  <strong>{formatMoney(item.value, i18n.language)}</strong>
                  <small>{year || t('financeAllYears')}</small>
                </article>
              ))}
            </section>
          )}
        </>
      )}
      <section className="panel finance-panel">
        <div className="finance-tabs" role="tablist" aria-label={t('finance')}>
          {(Object.keys(tabLabels) as Tab[]).map((value) => (
            <button
              role="tab"
              type="button"
              id={`finance-tab-${value}`}
              aria-controls="finance-tabpanel"
              aria-selected={tab === value}
              key={value}
              onClick={() => {
                setTab(value);
                setSearch('');
                setSort('createdAt');
                setPage(1);
                setError('');
                setNotice('');
              }}
            >
              {t(tabLabels[value])}
            </button>
          ))}
        </div>
        <div role="tabpanel" id="finance-tabpanel" aria-labelledby={`finance-tab-${tab}`}>
          {ledger ? (
            <LedgerTab tab={tab} />
          ) : (
            <>
              <div className="toolbar">
                <SearchInput
                  value={search}
                  onChange={(value) => {
                    setSearch(value);
                    setPage(1);
                  }}
                  placeholder={t(
                    tab === 'assessments'
                      ? 'financeSearch'
                      : tab === 'payments'
                        ? 'financePaymentSearch'
                        : 'search',
                  )}
                />
                {tab === 'assessments' && (
                  <label>
                    <span className="sr-only">{t('status')}</span>
                    <select
                      value={status}
                      onChange={(event) => {
                        setStatus(event.target.value);
                        setPage(1);
                      }}
                    >
                      {[
                        ['', 'financeAllStatuses'],
                        ['outstanding', 'financeOnlyOutstanding'],
                        ['overdue', 'financeOnlyOverdue'],
                        ['open', 'financeOpen'],
                        ['partial', 'financePartial'],
                        ['paid', 'financeSettled'],
                        ['exempt', 'financeExemption'],
                      ].map(([value, label]) => (
                        <option key={value} value={value}>
                          {t(label!)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {tab === 'plans' && (
                  <label>
                    <span className="sr-only">{t('status')}</span>
                    <select
                      value={active}
                      onChange={(event) => {
                        setActive(event.target.value);
                        setPage(1);
                      }}
                    >
                      <option value="">{t('allStatuses')}</option>
                      <option value="true">{t('active')}</option>
                      <option value="false">{t('inactive')}</option>
                    </select>
                  </label>
                )}
                <label>
                  <span className="sr-only">{t('sort')}</span>
                  <select
                    value={sort}
                    onChange={(event) => {
                      setSort(event.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="createdAt">{t('newest')}</option>
                    <option value="name">{t('name')}</option>
                    <option value="amountCents">{t('financeAmount')}</option>
                    {tab === 'assessments' && (
                      <option value="dueDate">{t('financeDueDate')}</option>
                    )}
                    {tab === 'payments' && <option value="paidOn">{t('financePaidOn')}</option>}
                  </select>
                </label>
              </div>
              {current.isPending ? (
                <Loading />
              ) : current.isError ? (
                <ErrorState error={current.error} retry={() => void current.refetch()} />
              ) : (
                <>
                  {tab === 'assessments' &&
                    assessments.data &&
                    (assessments.data.items.length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>{t('financeMember')}</th>
                              <th>{t('financePlan')}</th>
                              <th>{t('financeDueDate')}</th>
                              <th className="align-right">{t('financeAmount')}</th>
                              <th className="align-right">{t('financeOutstanding')}</th>
                              <th>{t('status')}</th>
                              <th>{t('actions')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {assessments.data.items.map((item) => (
                              <tr key={item.id}>
                                <td>
                                  <button
                                    className="finance-name-link"
                                    onClick={() =>
                                      setEditor({ type: 'assessment-detail', id: item.id })
                                    }
                                  >
                                    <strong>{item.memberName}</strong>
                                    <small>
                                      {item.membershipNumber} · {item.fiscalYear}
                                    </small>
                                  </button>
                                </td>
                                <td>{item.planName}</td>
                                <td>{formatDate(item.dueDate, i18n.language)}</td>
                                <td className="align-right finance-money">
                                  {formatMoney(item.amountCents, i18n.language)}
                                </td>
                                <td className="align-right finance-money">
                                  {formatMoney(item.openCents, i18n.language)}
                                </td>
                                <td>
                                  <FeeStatus item={item} />
                                </td>
                                <td>
                                  <div className="finance-row-actions">
                                    {canWrite && item.openCents > 0 && (
                                      <Button
                                        variant="secondary"
                                        onClick={() =>
                                          setEditor({ type: 'payment', assessment: item })
                                        }
                                      >
                                        {t('financeAddPayment')}
                                      </Button>
                                    )}
                                    {canWrite && item.overdue && (
                                      <Button
                                        variant="ghost"
                                        disabled={busy}
                                        aria-label={`${t('financePrepareReminder')}: ${item.memberName} ${item.planName}`}
                                        onClick={() => void prepareReminder(item)}
                                      >
                                        <Bell size={17} />
                                      </Button>
                                    )}
                                    <Button
                                      variant="ghost"
                                      aria-label={`${t('financeAssessmentDetails')}: ${item.memberName} ${item.planName}`}
                                      onClick={() =>
                                        setEditor({ type: 'assessment-detail', id: item.id })
                                      }
                                    >
                                      <ArrowUpRight size={17} />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        description={t(
                          debounced || status ? 'noResults' : 'financeAssessmentEmpty',
                        )}
                      />
                    ))}
                  {tab === 'plans' &&
                    plans.data &&
                    (plans.data.items.length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>{t('financePlanName')}</th>
                              <th>{t('financeInterval')}</th>
                              <th>{t('financeCategory')}</th>
                              <th className="align-right">{t('financeAmount')}</th>
                              <th>{t('status')}</th>
                              {canPlans && <th>{t('actions')}</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {plans.data.items.map((item) => (
                              <tr key={item.id}>
                                <td>
                                  <strong>{item.name}</strong>
                                  {item.description && (
                                    <small className="finance-cell-note">{item.description}</small>
                                  )}
                                </td>
                                <td>
                                  {t(item.interval === 'annual' ? 'financeAnnual' : 'financeOnce')}
                                </td>
                                <td>
                                  {item.membershipType
                                    ? t(item.membershipType)
                                    : t('financeAllCategories')}
                                </td>
                                <td className="align-right finance-money">
                                  {formatMoney(item.amountCents, i18n.language)}
                                </td>
                                <td>
                                  <span
                                    className={`badge badge-${item.active ? 'active' : 'inactive'}`}
                                  >
                                    <span />
                                    {t(item.active ? 'active' : 'inactive')}
                                  </span>
                                </td>
                                {canPlans && (
                                  <td>
                                    <Button
                                      variant="ghost"
                                      aria-label={`${t('financeEditPlan')}: ${item.name}`}
                                      onClick={() => setEditor({ type: 'plan', plan: item })}
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
                      <Empty description={t('financePlanEmpty')} />
                    ))}
                  {tab === 'payments' &&
                    payments.data &&
                    (payments.data.items.length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>{t('financeReceiptNumber')}</th>
                              <th>{t('financePayerName')}</th>
                              <th>{t('financePaidOn')}</th>
                              <th>{t('financeMethod')}</th>
                              <th className="align-right">{t('financeAmount')}</th>
                              <th>{t('actions')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {payments.data.items.map((item) => (
                              <tr key={item.id}>
                                <td>
                                  <button
                                    className="finance-name-link"
                                    onClick={() =>
                                      setEditor({ type: 'payment-detail', id: item.id })
                                    }
                                  >
                                    <strong>{receiptNumber(item.receiptNumber)}</strong>
                                  </button>
                                </td>
                                <td>
                                  {item.payerName}
                                  {item.reference && (
                                    <small className="finance-cell-note">{item.reference}</small>
                                  )}
                                  {item.status === 'reversed' && (
                                    <span className="badge badge-inactive">
                                      {t('ledgerPaymentReversed')}
                                    </span>
                                  )}
                                </td>
                                <td>{formatDate(item.paidOn, i18n.language)}</td>
                                <td>{t(methodKey(item.method))}</td>
                                <td className="align-right finance-money">
                                  {formatMoney(item.amountCents, i18n.language)}
                                </td>
                                <td>
                                  <div className="finance-row-actions">
                                    <Button
                                      variant="secondary"
                                      onClick={() => void receipt(item.id)}
                                    >
                                      <Download size={16} />
                                      {t('financeReceipt')}
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      aria-label={`${t('financePaymentDetails')}: ${receiptNumber(item.receiptNumber)}`}
                                      onClick={() =>
                                        setEditor({ type: 'payment-detail', id: item.id })
                                      }
                                    >
                                      <ArrowUpRight size={17} />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty description={t('financePaymentEmpty')} />
                    ))}
                  {current.data && (
                    <Pagination
                      page={page}
                      pageSize={current.data.pageSize}
                      total={current.data.total}
                      onChange={setPage}
                    />
                  )}
                </>
              )}
            </>
          )}
        </div>
      </section>
      {tab === 'plans' && !canPlans && (
        <p className="finance-footnote">{t('financePlanReadOnly')}</p>
      )}
      {tab === 'payments' && <p className="finance-footnote">{t('financePostedHint')}</p>}
      {editor && (
        <Modal
          wide
          title={t(
            editor.type === 'plan'
              ? editor.plan
                ? 'financeEditPlan'
                : 'financeAddPlan'
              : editor.type === 'assessment'
                ? 'financeAddAssessment'
                : editor.type === 'payment'
                  ? 'financeAddPayment'
                  : editor.type === 'assessment-detail'
                    ? 'financeAssessmentDetails'
                    : 'financePaymentDetails',
          )}
          onClose={() => setEditor(null)}
        >
          {error && <Notice error>{error}</Notice>}
          {editor.type === 'plan' ? (
            <PlanForm
              plan={editor.plan}
              onCancel={() => setEditor(null)}
              onDone={() => completed('financeSavedPlan')}
            />
          ) : editor.type === 'assessment' ? (
            <AssessmentForm
              year={Number(year) || new Date().getFullYear()}
              onCancel={() => setEditor(null)}
              onDone={() => completed('financeSavedAssessment')}
            />
          ) : editor.type === 'payment' ? (
            <PaymentForm
              initial={editor.assessment}
              onCancel={() => setEditor(null)}
              onDone={() => {
                setTab('payments');
                setSearch('');
                completed('financeSavedPayment');
              }}
            />
          ) : editor.type === 'assessment-detail' ? (
            <AssessmentDetails id={editor.id} onReceipt={(id) => void receipt(id)} />
          ) : (
            <PaymentDetails
              id={editor.id}
              canWrite={canWrite}
              onReceipt={(id) => void receipt(id)}
              onChanged={(message) => completed(message)}
            />
          )}
        </Modal>
      )}
    </>
  );
}
function methodKey(method: Payment['method']) {
  return { cash: 'financeCash', bank_transfer: 'financeTransfer', other: 'financeOther' }[method];
}
function receiptNumber(value: number) {
  return `BN-${String(value).padStart(6, '0')}`;
}
function AssessmentDetails({ id, onReceipt }: { id: string; onReceipt: (id: string) => void }) {
  const { t, i18n } = useTranslation(),
    { me } = useSession();
  const query = useQuery({
    queryKey: ['finance-assessment-detail', me.activeOrganizationId, id],
    queryFn: () => api<AssessmentDetail>(`/fee-assessments/${id}`),
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} />;
  const item = query.data;
  return (
    <div className="finance-detail">
      <h3>
        {item.memberName} · {item.membershipNumber}
      </h3>
      <p>
        {item.planName} · {item.fiscalYear}
      </p>
      <FeeStatus item={item} />
      <dl>
        {[
          ['financeDueDate', formatDate(item.dueDate, i18n.language)],
          ['financePlanAmount', formatMoney(item.planAmountCents, i18n.language)],
          ['financeBaseAmount', formatMoney(item.baseAmountCents, i18n.language)],
          ['financeReduction', formatMoney(item.reductionCents, i18n.language)],
          ['financeAmount', formatMoney(item.amountCents, i18n.language)],
          ['financePaid', formatMoney(item.paidCents, i18n.language)],
          ['financeOutstanding', formatMoney(item.openCents, i18n.language)],
          ['financeAdjustmentReason', item.adjustmentReason || '—'],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{t(label!)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <h3>{t('financePayments')}</h3>
      {item.payments.length ? (
        <ul className="finance-allocation-history">
          {item.payments.map((p) => (
            <li key={p.paymentId}>
              <span>
                {receiptNumber(p.receiptNumber)} · {formatDate(p.paidOn, i18n.language)} ·{' '}
                {formatMoney(p.amountCents, i18n.language)}
                {p.reversed && (
                  <span className="badge badge-inactive">{t('ledgerPaymentReversed')}</span>
                )}
              </span>
              <Button
                variant="ghost"
                onClick={() => onReceipt(p.paymentId)}
                aria-label={`${t('financeReceipt')}: ${receiptNumber(p.receiptNumber)}`}
              >
                <Download size={17} />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="finance-footnote">{t('financePaymentEmpty')}</p>
      )}
    </div>
  );
}
function PaymentDetails({
  id,
  canWrite,
  onReceipt,
  onChanged,
}: {
  id: string;
  canWrite: boolean;
  onReceipt: (id: string) => void;
  onChanged: (message: string) => void;
}) {
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    [action, setAction] = useState<'book' | 'reverse' | null>(null);
  const query = useQuery({
    queryKey: ['finance-payment-detail', me.activeOrganizationId, id],
    queryFn: () => api<Payment>(`/payments/${id}`),
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} />;
  const item = query.data;
  return (
    <div className="finance-detail">
      <h3>{receiptNumber(item.receiptNumber)}</h3>
      {item.reversal && (
        <Notice error>
          {t('ledgerPaymentReversedOn', {
            date: formatDate(item.reversal.reversedOn, i18n.language),
            reason: item.reversal.reason,
          })}
        </Notice>
      )}
      <dl>
        {[
          ['financePayerName', item.payerName],
          ['financePaidOn', formatDate(item.paidOn, i18n.language)],
          ['financeMethod', t(methodKey(item.method))],
          ['financeReference', item.reference || '—'],
          ['financeAmount', formatMoney(item.amountCents, i18n.language)],
          ['financeNotes', item.notes || '—'],
          ['ledgerBookingStatus', t(item.cashbookEntryId ? 'ledgerBooked' : 'ledgerNotBooked')],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{t(label!)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <h3>{t('financeAllocations')}</h3>
      <ul className="finance-allocation-history">
        {item.allocations.map((allocation) => (
          <li key={allocation.assessmentId}>
            <span>
              {allocation.memberName} · {allocation.planName} · {allocation.fiscalYear}
            </span>
            <strong>{formatMoney(allocation.amountCents, i18n.language)}</strong>
          </li>
        ))}
      </ul>
      <div className="finance-row-actions">
        <Button variant="secondary" onClick={() => onReceipt(item.id)}>
          <Download size={16} />
          {t('financeReceipt')}
        </Button>
        {canWrite && item.status === 'posted' && !item.cashbookEntryId && (
          <Button variant="secondary" onClick={() => setAction('book')}>
            <BookCheck size={16} />
            {t('ledgerBookPayment')}
          </Button>
        )}
        {canWrite && item.status === 'posted' && (
          <Button variant="secondary" onClick={() => setAction('reverse')}>
            <Undo2 size={16} />
            {t('ledgerReversePayment')}
          </Button>
        )}
      </div>
      {action === 'book' && (
        <BookingForm
          payment={item}
          onCancel={() => setAction(null)}
          onDone={() => onChanged('ledgerSavedBooking')}
        />
      )}
      {action === 'reverse' && (
        <PaymentReversalForm
          payment={item}
          onCancel={() => setAction(null)}
          onDone={() => onChanged('ledgerSavedPaymentReversal')}
        />
      )}
    </div>
  );
}
