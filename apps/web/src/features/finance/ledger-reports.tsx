import { QueryView } from '../../components/ui';
import { Amount } from './amount';
import { useLedgerBasics, refreshFinanceQueries as refresh } from './queries';
import { PaymentBackfill, EtsReports } from './extensions';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Download, Pencil, Trash2, TriangleAlert } from 'lucide-react';
import {
  formatMoney,
  parseEuroCents,
  moneyInputValue,
  type CashbookCategory,
  type AnnualReport,
  type ReportTemplate,
} from '@bnature/contracts';
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
import { api, downloadPrivateFile, errorMessage } from '../../lib/api';
import { encodeCsv, downloadCsv } from '../../lib/csv';
import { useSession } from '../../app/session';
import { useFinancialWrite } from './client';
export function Reports() {
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
      {<QueryView query={report}>{(queryData) => ((
        <>
          {queryData.status === 'open' && <Notice>{t('ledgerReportProvisional')}</Notice>}
          {queryData.unbookedPaymentCount > 0 && (
            <Notice>
              {t('ledgerUnbookedPayments', { count: queryData.unbookedPaymentCount })}
            </Notice>
          )}
          <section
            className="stats-grid finance-stats ledger-report-stats"
            aria-label={t('ledgerReportSummary')}
          >
            {[
              ['ledgerIncome', queryData.incomeCents],
              ['ledgerExpense', queryData.expenseCents],
              ['ledgerResult', queryData.resultCents],
              ['ledgerClassFee', queryData.membershipFeeIncomeCents],
              ['ledgerClassDonation', queryData.donationIncomeCents],
            ].map(([label, value], index) => (
              <article key={label} className={`stat-card stat-${Math.min(index, 3)}`}>
                <div>
                  <span>{t(label!)}</span>
                </div>
                <strong>{formatMoney(value!, i18n.language)}</strong>
                <small>{queryData.fiscalYear}</small>
              </article>
            ))}
          </section>
          <div className="ledger-report-grid">
            <section aria-labelledby="ledger-report-categories">
              <h2 id="ledger-report-categories">{t('ledgerCategories')}</h2>
              <ul className="finance-allocation-history">
                {queryData.categories
                  .filter((c) => c.totalCents !== '0')
                  .map((c) => (
                    <li key={`${c.categoryId}:${c.name}`}>
                      <span>{c.name}</span>
                      <Amount cents={c.totalCents} direction={c.direction} />
                    </li>
                  ))}
              </ul>
            </section>
            <section aria-labelledby="ledger-report-accounts">
              <h2 id="ledger-report-accounts">{t('ledgerAccounts')}</h2>
              <ul className="finance-allocation-history">
                {queryData.accounts.map((a) => (
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
          {queryData.template && (
            <section className="ledger-template-result" aria-labelledby="ledger-report-template">
              <h2 id="ledger-report-template">
                {queryData.template.name} · v{queryData.template.version}
              </h2>
              {queryData.template.revenueThresholdCents !== null && (
                <Notice error={queryData.template.thresholdExceeded}>
                  {t(
                    queryData.template.thresholdExceeded
                      ? 'ledgerThresholdExceeded'
                      : 'ledgerThresholdOk',
                    {
                      amount: formatMoney(
                        queryData.template.revenueThresholdCents,
                        i18n.language,
                      ),
                    },
                  )}
                </Notice>
              )}
              <ul className="finance-allocation-history">
                {queryData.template.lines.map((line) => (
                  <li key={line.code}>
                    <span>
                      <strong>{line.code}</strong> {line.label}
                    </span>
                    <Amount cents={line.totalCents} direction={line.direction} />
                  </li>
                ))}
              </ul>
              {queryData.template.unmappedCategoryIds.length > 0 && (
                <p className="ledger-warning">
                  <TriangleAlert size={13} />{' '}
                  {t('ledgerUnmapped', {
                    names: queryData.template.unmappedCategoryIds
                      .map((id) => names.get(id))
                      .join(', '),
                  })}
                </p>
              )}
            </section>
          )}
        </>
      ))}</QueryView>}
      <EtsReports year={selectedYear} />
      <PaymentBackfill />
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
