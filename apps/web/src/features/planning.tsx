import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Copy, Download, Plus, Settings2, Trash2 } from 'lucide-react';
import {
  costPlanInputSchema,
  costTotals,
  plannedCost,
  formatMoney,
  type CostPlan,
  type CostPlanInput,
  type CostRow,
} from '@bnature/contracts';
import { useSession } from '../app/session';
import { api, downloadPrivateFile, errorMessage, queryClient } from '../lib/api';
import {
  Button,
  Empty,
  Field,
  FormActions,
  Modal,
  Notice,
  PageHeading,
  QueryView,
} from '../components/ui';

const emptyPlan = (): CostPlanInput => ({ name: '', description: '', columns: [], rows: [] });
const emptyRow = (): CostRow => ({
  id: crypto.randomUUID(),
  description: '',
  category: '',
  quantity: 1,
  unit: '',
  unitCostCents: 0,
  actualCents: 0,
  notes: '',
  custom: {},
});
function move<T>(items: T[], index: number, offset: number): T[] {
  const copy = [...items];
  [copy[index], copy[index + offset]] = [copy[index + offset]!, copy[index]!];
  return copy;
}
function Totals({ rows }: { rows: CostRow[] }) {
  const { t, i18n } = useTranslation(),
    totals = costTotals(rows);
  return (
    <div className="stats-grid cost-stats" aria-live="polite">
      {(['plannedCents', 'actualCents', 'varianceCents'] as const).map((key) => (
        <article className="stat-card" key={key}>
          <div>{t(`cost_${key}`)}</div>
          <strong>{formatMoney(totals[key], i18n.language)}</strong>
          {key === 'varianceCents' && <small>{t('costVarianceHint')}</small>}
        </article>
      ))}
    </div>
  );
}
const headers = [
  'costItem',
  'costCategory',
  'costQuantity',
  'costUnit',
  'costUnitPrice',
  'costPlanned',
  'costActual',
  'costVariance',
  'costNotes',
];
function CostTable({ plan }: { plan: CostPlanInput }) {
  const { t, i18n } = useTranslation();
  const money = (cents: number) => formatMoney(cents, i18n.language);
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={t('costItems')}>
      <table className="cost-table">
        <caption className="sr-only">{plan.name}</caption>
        <thead>
          <tr>
            {headers.map((key) => (
              <th scope="col" key={key}>
                {t(key)}
              </th>
            ))}
            {plan.columns.map((c) => (
              <th scope="col" key={c.id}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {plan.rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.description}</th>
              <td>{row.category}</td>
              <td>{row.quantity}</td>
              <td>{row.unit}</td>
              <td>{money(row.unitCostCents)}</td>
              <td>{money(plannedCost(row))}</td>
              <td>{money(row.actualCents)}</td>
              <td>{money(row.actualCents - plannedCost(row))}</td>
              <td>{row.notes}</td>
              {plan.columns.map((c) => (
                <td key={c.id}>{row.custom[c.id]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function CostEditor({
  plan,
  onClose,
  onSaved,
}: {
  plan: CostPlan | null;
  onClose: () => void;
  onSaved: (plan: CostPlan) => void;
}) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState<CostPlanInput>(() =>
    plan
      ? {
          name: plan.name,
          description: plan.description,
          columns: structuredClone(plan.columns),
          rows: structuredClone(plan.rows),
        }
      : emptyPlan(),
  );
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [dirty, setDirty] = useState(false);
  const key = useRef<{ body: string; value: string } | null>(null);
  const update = (value: Partial<CostPlanInput>) => {
    setDirty(true);
    setDraft((current) => ({ ...current, ...value }));
  };
  const close = () => {
    if (!dirty || window.confirm(t('costDiscard'))) onClose();
  };
  const rowUpdate = (id: string, value: Partial<CostRow>) =>
    update({ rows: draft.rows.map((row) => (row.id === id ? { ...row, ...value } : row)) });
  return (
    <Modal
      wide
      className="cost-modal"
      title={t(plan ? 'costEdit' : 'costNew')}
      onClose={() => {
        if (!pending) close();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending) return;
          const parsed = costPlanInputSchema.safeParse(draft);
          if (!parsed.success) {
            setError(t('costInvalid'));
            return;
          }
          setPending(true);
          setError('');
          const body = JSON.stringify({
            ...parsed.data,
            ...(plan ? { version: plan.version } : {}),
          });
          if (key.current?.body !== body) key.current = { body, value: crypto.randomUUID() };
          try {
            const saved = await api<CostPlan>(`/planning/costs${plan ? `/${plan.id}` : ''}`, {
              method: plan ? 'PUT' : 'POST',
              headers: { 'Idempotency-Key': key.current!.value },
              body,
            });
            onSaved(saved);
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setPending(false);
          }
        }}
      >
        <fieldset disabled={pending} className="cost-editor-fields">
          <div className="form-grid">
            <Field label={t('costName')}>
              <input
                required
                maxLength={200}
                value={draft.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </Field>
            <Field label={t('costDescription')}>
              <textarea
                maxLength={2000}
                value={draft.description}
                onChange={(e) => update({ description: e.target.value })}
              />
            </Field>
          </div>
          <details className="cost-columns">
            <summary>
              <Settings2 size={16} /> {t('costColumns')}
            </summary>
            <p>{t('costColumnsHint')}</p>
            {draft.columns.map((column, index) => (
              <div className="cost-column" key={column.id}>
                <Field label={`${t('costColumn')} ${index + 1}`}>
                  <input
                    required
                    maxLength={80}
                    value={column.label}
                    onChange={(e) =>
                      update({
                        columns: draft.columns.map((c) =>
                          c.id === column.id ? { ...c, label: e.target.value } : c,
                        ),
                      })
                    }
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`${t('costMoveUp')}: ${column.label}`}
                  disabled={index === 0}
                  onClick={() => update({ columns: move(draft.columns, index, -1) })}
                >
                  <ArrowUp size={16} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`${t('costMoveDown')}: ${column.label}`}
                  disabled={index === draft.columns.length - 1}
                  onClick={() => update({ columns: move(draft.columns, index, 1) })}
                >
                  <ArrowDown size={16} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`${t('costRemoveColumn')}: ${column.label}`}
                  onClick={() => {
                    if (!window.confirm(t('costRemoveColumnConfirm'))) return;
                    update({
                      columns: draft.columns.filter((c) => c.id !== column.id),
                      rows: draft.rows.map((row) => ({
                        ...row,
                        custom: Object.fromEntries(
                          Object.entries(row.custom).filter(([id]) => id !== column.id),
                        ),
                      })),
                    });
                  }}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              disabled={draft.columns.length >= 10}
              onClick={() =>
                update({
                  columns: [
                    ...draft.columns,
                    {
                      id: crypto.randomUUID(),
                      label: `${t('costColumn')} ${draft.columns.length + 1}`,
                    },
                  ],
                })
              }
            >
              <Plus size={16} />
              {t('costAddColumn')}
            </Button>
          </details>
          <p className="form-hint">{t('costEditorHint')}</p>
          <div className="table-scroll">
            <table className="cost-table cost-edit-table">
              <caption className="sr-only">{t('costItems')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('actions')}</th>
                  {headers.map((h) => (
                    <th key={h} scope="col">
                      {t(h)}
                    </th>
                  ))}
                  {draft.columns.map((c) => (
                    <th scope="col" key={c.id}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draft.rows.map((row, index) => {
                  const label = (key: string) => `${t(key)} · ${index + 1}`;
                  return (
                    <tr key={row.id}>
                      <td>
                        <div className="cost-row-actions">
                          <Button
                            type="button"
                            variant="ghost"
                            aria-label={label('costMoveUp')}
                            disabled={index === 0}
                            onClick={() => update({ rows: move(draft.rows, index, -1) })}
                          >
                            <ArrowUp size={16} />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            aria-label={label('costMoveDown')}
                            disabled={index === draft.rows.length - 1}
                            onClick={() => update({ rows: move(draft.rows, index, 1) })}
                          >
                            <ArrowDown size={16} />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            aria-label={label('costDuplicate')}
                            disabled={draft.rows.length >= 200}
                            onClick={() =>
                              update({
                                rows: [
                                  ...draft.rows.slice(0, index + 1),
                                  { ...structuredClone(row), id: crypto.randomUUID() },
                                  ...draft.rows.slice(index + 1),
                                ],
                              })
                            }
                          >
                            <Copy size={16} />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            aria-label={label('costRemoveRow')}
                            onClick={() => {
                              if (window.confirm(t('costRemoveRowConfirm')))
                                update({ rows: draft.rows.filter((r) => r.id !== row.id) });
                            }}
                          >
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      </td>
                      <td>
                        <input
                          aria-label={label('costItem')}
                          required
                          maxLength={200}
                          value={row.description}
                          onChange={(e) => rowUpdate(row.id, { description: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={label('costCategory')}
                          maxLength={100}
                          value={row.category}
                          onChange={(e) => rowUpdate(row.id, { category: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={label('costQuantity')}
                          type="number"
                          required
                          min="0"
                          max="10000"
                          step="0.001"
                          value={row.quantity}
                          onChange={(e) => rowUpdate(row.id, { quantity: e.target.valueAsNumber })}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={label('costUnit')}
                          maxLength={40}
                          value={row.unit}
                          onChange={(e) => rowUpdate(row.id, { unit: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={label('costUnitPrice')}
                          type="number"
                          required
                          min="0"
                          max="1000000"
                          step="0.01"
                          value={Number.isNaN(row.unitCostCents) ? '' : row.unitCostCents / 100}
                          onChange={(e) =>
                            rowUpdate(row.id, {
                              unitCostCents: Math.round(e.target.valueAsNumber * 100),
                            })
                          }
                        />
                      </td>
                      <td className="cost-computed">
                        {formatMoney(plannedCost(row), i18n.language)}
                      </td>
                      <td>
                        <input
                          aria-label={label('costActual')}
                          type="number"
                          required
                          min="0"
                          max="1000000"
                          step="0.01"
                          value={Number.isNaN(row.actualCents) ? '' : row.actualCents / 100}
                          onChange={(e) =>
                            rowUpdate(row.id, {
                              actualCents: Math.round(e.target.valueAsNumber * 100),
                            })
                          }
                        />
                      </td>
                      <td className="cost-computed">
                        {formatMoney(row.actualCents - plannedCost(row), i18n.language)}
                      </td>
                      <td>
                        <input
                          aria-label={label('costNotes')}
                          maxLength={1000}
                          value={row.notes}
                          onChange={(e) => rowUpdate(row.id, { notes: e.target.value })}
                        />
                      </td>
                      {draft.columns.map((column) => (
                        <td key={column.id}>
                          <input
                            aria-label={`${column.label} · ${index + 1}`}
                            maxLength={200}
                            value={row.custom[column.id] ?? ''}
                            onChange={(e) =>
                              rowUpdate(row.id, {
                                custom: { ...row.custom, [column.id]: e.target.value },
                              })
                            }
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={draft.rows.length >= 200}
            onClick={() => update({ rows: [...draft.rows, emptyRow()] })}
          >
            <Plus size={16} />
            {t('costAddRow')}
          </Button>
          <Totals rows={draft.rows} />
        </fieldset>
        {error && <Notice error>{error}</Notice>}
        <FormActions pending={pending} onCancel={pending ? undefined : close} />
      </form>
    </Modal>
  );
}
export function Planning() {
  const { t, i18n } = useTranslation(),
    { me } = useSession();
  const [selected, setSelected] = useState(''),
    [editing, setEditing] = useState<CostPlan | null | undefined>();
  const [exporting, setExporting] = useState(false),
    [error, setError] = useState('');
  const canWrite = me.permissions.includes('planning:write');
  const query = useQuery({
    queryKey: ['planning', me.activeOrganizationId],
    queryFn: () => api<{ items: CostPlan[] }>('/planning/costs'),
  });
  return (
    <>
      <PageHeading
        title={t('costTitle')}
        description={t('costIntro')}
        actions={
          canWrite && (
            <Button onClick={() => setEditing(null)}>
              <Plus size={17} />
              {t('costNew')}
            </Button>
          )
        }
      />
      {error && <Notice error>{error}</Notice>}
      <QueryView query={query}>
        {({ items }) => {
          const plan = items.find((item) => item.id === selected) ?? items[0];
          if (!plan)
            return (
              <section className="panel">
                <Empty
                  title={t('costEmpty')}
                  description={t('costEmptyHint')}
                  action={
                    canWrite && <Button onClick={() => setEditing(null)}>{t('costNew')}</Button>
                  }
                />
              </section>
            );
          const exportPlan = async (format: 'csv' | 'xlsx') => {
            setExporting(true);
            setError('');
            try {
              await downloadPrivateFile(
                `/planning/costs/${plan.id}/export?format=${format}&language=${i18n.language === 'it' ? 'it' : 'de'}`,
                `${plan.name.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 100) || 'cost-plan'}.${format}`,
              );
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setExporting(false);
            }
          };
          return (
            <>
              <section className="panel">
                <div className="toolbar cost-toolbar">
                  <Field label={t('costSelect')}>
                    <select value={plan.id} onChange={(e) => setSelected(e.target.value)}>
                      {items.map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="heading-actions">
                    <Button
                      variant="secondary"
                      disabled={exporting}
                      onClick={() => void exportPlan('csv')}
                    >
                      <Download size={16} />
                      CSV
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={exporting}
                      onClick={() => void exportPlan('xlsx')}
                    >
                      <Download size={16} />
                      Excel (.xlsx)
                    </Button>
                    {canWrite && <Button onClick={() => setEditing(plan)}>{t('costEdit')}</Button>}
                  </div>
                </div>
                <div className="panel-header">
                  <div>
                    <h2>{plan.name}</h2>
                    <p className="cost-description">{plan.description}</p>
                  </div>
                </div>
                {plan.rows.length ? <CostTable plan={plan} /> : <Empty title={t('costNoRows')} />}
              </section>
              <Totals rows={plan.rows} />
            </>
          );
        }}
      </QueryView>
      {editing !== undefined && (
        <CostEditor
          plan={editing}
          onClose={() => setEditing(undefined)}
          onSaved={(saved) => {
            queryClient.setQueryData<{ items: CostPlan[] }>(
              ['planning', me.activeOrganizationId],
              (current) => ({
                items: [...(current?.items ?? []).filter((p) => p.id !== saved.id), saved].sort(
                  (a, b) => a.name.localeCompare(b.name),
                ),
              }),
            );
            setSelected(saved.id);
            setEditing(undefined);
            void queryClient.invalidateQueries({ queryKey: ['planning'] });
          }}
        />
      )}
    </>
  );
}
