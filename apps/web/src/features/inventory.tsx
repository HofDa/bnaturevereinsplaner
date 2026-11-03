import { useState } from 'react';
import { NavLink } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Download,
  PackageOpen,
  Undo2,
  CalendarPlus,
  Archive,
  Pencil,
  Eye,
} from 'lucide-react';
import {
  inventoryConditionSchema,
  type InventoryItem,
  type InventoryLoan,
  type Page,
  localDate,
} from '@bnature/contracts';
import { api, downloadPrivateFile, errorMessage, queryClient } from '../lib/api';
import { useSession } from '../app/session';
import {
  Button,
  Empty,
  ErrorState,
  Field,
  Loading,
  Modal,
  Notice,
  PageHeading,
  Pagination,
  SearchInput,
  formatDate,
} from '../components/ui';
import { useDebounced } from '../hooks/use-debounced';
import {
  FormModal,
  StatusTag,
  nullable,
  usePermission,
  useVolunteerWrite as useInventoryWrite,
  type FormFieldSpec,
  type FormValues,
} from './volunteers/shared';

type Summary = {
  items: number;
  pieces: number;
  lentPieces: number;
  openLoans: number;
  overdueLoans: number;
  needsAttention: number;
  valueCents: number;
  categories: string[];
};
type Borrower = { id: string; name: string; isMember: boolean };
const conditions = inventoryConditionSchema.options;
const refresh = () => void queryClient.invalidateQueries({ queryKey: ['inventory'] });
// Business dates are kept in the organization time zone (Europe/Rome by default).
const localToday = () => localDate();
const inDays = (days: number) => localDate(Date.now() + days * 86_400_000);
const euros = (value: string | boolean) =>
  value === '' ? null : Math.round(Number(String(value).replace(',', '.')) * 100);
const money = (cents: number, language: string) =>
  new Intl.NumberFormat(language === 'it' ? 'it-IT' : 'de-IT', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100);

function InventoryNavigation() {
  const { t } = useTranslation();
  return (
    <nav className="finance-tabs" aria-label={t('inventory')}>
      {[
        { to: '/inventory', key: 'invItems', end: true },
        { to: '/inventory/loans', key: 'invLoans' },
      ].map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.end}
          className={({ isActive }) => (isActive ? 'active' : '')}
        >
          {t(l.key)}
        </NavLink>
      ))}
    </nav>
  );
}
function SummaryTiles() {
  const { t, i18n } = useTranslation(),
    { me } = useSession();
  const summary = useQuery({
    queryKey: ['inventory', 'summary', me.activeOrganizationId],
    queryFn: () => api<Summary>('/inventory/summary'),
  });
  if (!summary.data) return null;
  const s = summary.data;
  return (
    <dl className="inventory-stats">
      <div>
        <dt>{t('invStatItems')}</dt>
        <dd>{s.items}</dd>
        <dd className="inventory-stat-note">{t('invStatPieces', { count: s.pieces })}</dd>
      </div>
      <div>
        <dt>{t('invStatLent')}</dt>
        <dd>{s.lentPieces}</dd>
        <dd className="inventory-stat-note">{t('invStatOpenLoans', { count: s.openLoans })}</dd>
      </div>
      <div className={s.overdueLoans ? 'inventory-stat-warning' : undefined}>
        <dt>{t('invStatOverdue')}</dt>
        <dd>{s.overdueLoans}</dd>
      </div>
      <div className={s.needsAttention ? 'inventory-stat-warning' : undefined}>
        <dt>{t('invStatAttention')}</dt>
        <dd>{s.needsAttention}</dd>
        <dd className="inventory-stat-note">{t('invStatAttentionHint')}</dd>
      </div>
      <div>
        <dt>{t('invStatValue')}</dt>
        <dd>{money(s.valueCents, i18n.language)}</dd>
      </div>
    </dl>
  );
}
function itemFields(t: (key: string) => string, item?: InventoryItem): FormFieldSpec[] {
  return [
    { name: 'name', label: t('invName'), required: true, defaultValue: item?.name },
    { name: 'inventoryNumber', label: t('invNumber'), defaultValue: item?.inventoryNumber },
    {
      name: 'category',
      label: t('invCategory'),
      defaultValue: item?.category,
      hint: t('invCategoryHint'),
    },
    { name: 'location', label: t('invLocation'), defaultValue: item?.location },
    {
      name: 'condition',
      label: t('invCondition'),
      type: 'select',
      defaultValue: item?.condition ?? 'good',
      options: conditions.map((c) => ({ value: c, label: t(`invCondition_${c}`) })),
    },
    {
      name: 'quantity',
      label: t('invQuantity'),
      type: 'number',
      required: true,
      min: Math.max(1, item?.lentQuantity ?? 1),
      defaultValue: item?.quantity ?? 1,
      hint: t('invQuantityHint'),
    },
    {
      name: 'purchasedOn',
      label: t('invPurchasedOn'),
      type: 'date',
      defaultValue: item?.purchasedOn,
    },
    {
      name: 'value',
      label: t('invValue'),
      defaultValue: item?.valueCents == null ? '' : (item.valueCents / 100).toFixed(2),
      hint: t('invValueHint'),
    },
    {
      name: 'description',
      label: t('description'),
      type: 'textarea',
      defaultValue: item?.description,
    },
    { name: 'notes', label: t('notes'), type: 'textarea', defaultValue: item?.notes },
  ];
}
const itemPayload = (v: FormValues) => ({
  name: v.name,
  inventoryNumber: v.inventoryNumber,
  category: v.category,
  location: v.location,
  condition: v.condition,
  quantity: Number(v.quantity),
  purchasedOn: nullable(v.purchasedOn ?? ''),
  valueCents: euros(v.value ?? ''),
  description: v.description,
  notes: v.notes,
});

function LendDialog({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const { t } = useTranslation(),
    { me } = useSession(),
    write = useInventoryWrite();
  const people = useQuery({
    queryKey: ['inventory', 'people', me.activeOrganizationId],
    queryFn: () => api<{ items: Borrower[] }>('/inventory/people'),
  });
  return (
    <FormModal
      title={`${t('invLend')}: ${item.name}`}
      submitLabel={t('invLend')}
      onClose={onClose}
      fields={[
        {
          name: 'personId',
          label: t('invBorrower'),
          type: 'select',
          required: true,
          options: [
            { value: '', label: t('choosePerson') },
            ...(people.data?.items ?? []).map((p) => ({
              value: p.id,
              label: `${p.name}${p.isMember ? ` · ${t('volIsMember')}` : ''}`,
            })),
          ],
        },
        {
          name: 'quantity',
          label: t('invQuantity'),
          type: 'number',
          required: true,
          min: 1,
          max: item.availableQuantity,
          defaultValue: 1,
          hint: t('invAvailableHint', { count: item.availableQuantity }),
        },
        {
          name: 'issuedOn',
          label: t('invIssuedOn'),
          type: 'date',
          required: true,
          defaultValue: localToday(),
        },
        {
          name: 'dueOn',
          label: t('invDueOn'),
          type: 'date',
          required: true,
          defaultValue: inDays(14),
        },
        {
          name: 'issueCondition',
          label: t('invCondition'),
          type: 'select',
          defaultValue: item.condition,
          options: conditions.map((c) => ({ value: c, label: t(`invCondition_${c}`) })),
        },
        { name: 'notes', label: t('notes'), type: 'textarea' },
      ]}
      onSubmit={async (v) => {
        await write('/inventory/loans', {
          itemId: item.id,
          personId: v.personId,
          quantity: Number(v.quantity),
          issuedOn: v.issuedOn,
          dueOn: v.dueOn,
          issueCondition: v.issueCondition,
          notes: v.notes,
        });
        refresh();
        onClose();
      }}
    >
      {people.isError && <ErrorState error={people.error} />}
    </FormModal>
  );
}
function ItemDetail({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const { t, i18n } = useTranslation(),
    { me } = useSession();
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const history = useQuery({
    queryKey: ['inventory', 'item-loans', me.activeOrganizationId, item.id, page],
    queryFn: () =>
      api<Page<InventoryLoan>>(
        `/inventory/loans?state=all&itemId=${item.id}&pageSize=${pageSize}&page=${page}`,
      ),
  });
  return (
    <Modal wide title={item.name} onClose={onClose}>
      <dl className="detail-list">
        <dt>{t('invNumber')}</dt>
        <dd>{item.inventoryNumber || '—'}</dd>
        <dt>{t('invCategory')}</dt>
        <dd>{item.category || '—'}</dd>
        <dt>{t('invLocation')}</dt>
        <dd>{item.location || '—'}</dd>
        <dt>{t('invCondition')}</dt>
        <dd>{t(`invCondition_${item.condition}`)}</dd>
        <dt>{t('invQuantity')}</dt>
        <dd>{t('invAvailableOf', { available: item.availableQuantity, total: item.quantity })}</dd>
        <dt>{t('invPurchasedOn')}</dt>
        <dd>{formatDate(item.purchasedOn, i18n.language)}</dd>
        {item.valueCents !== null && (
          <>
            <dt>{t('invValue')}</dt>
            <dd>{money(item.valueCents, i18n.language)}</dd>
          </>
        )}
        {item.status === 'retired' && (
          <>
            <dt>{t('invRetired')}</dt>
            <dd>
              {formatDate(item.retiredOn, i18n.language)} · {item.retiredReason}
            </dd>
          </>
        )}
      </dl>
      {item.description && <p>{item.description}</p>}
      <h3>{t('invHistory')}</h3>
      {history.isPending ? (
        <Loading />
      ) : history.isError ? (
        <ErrorState error={history.error} />
      ) : history.data.items.length ? (
        <div className="table-scroll" role="region" aria-label={t('invHistory')} tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>{t('invBorrower')}</th>
                <th>{t('invQuantityShort')}</th>
                <th>{t('invIssuedOn')}</th>
                <th>{t('invReturnedOn')}</th>
                <th>{t('invCondition')}</th>
              </tr>
            </thead>
            <tbody>
              {history.data.items.map((l) => (
                <tr key={l.id}>
                  <td>{l.borrowerName}</td>
                  <td>{l.quantity}</td>
                  <td>{formatDate(l.issuedOn, i18n.language)}</td>
                  <td>
                    {l.returnedOn
                      ? formatDate(l.returnedOn, i18n.language)
                      : `${t('invDueShort')} ${formatDate(l.dueOn, i18n.language)}`}
                  </td>
                  <td>
                    {t(`invCondition_${l.issueCondition}`)}
                    {l.returnCondition ? ` → ${t(`invCondition_${l.returnCondition}`)}` : ''}
                    {l.returnNotes && <small className="block-note">{l.returnNotes}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title={t('invNoHistory')} />
      )}
      {history.data && (
        <Pagination page={page} pageSize={pageSize} total={history.data.total} onChange={setPage} />
      )}
    </Modal>
  );
}

export function InventoryItems() {
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    can = usePermission(),
    write = useInventoryWrite();
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [condition, setCondition] = useState(''),
    [availability, setAvailability] = useState('all'),
    [status, setStatus] = useState('active'),
    [page, setPage] = useState(1),
    [creating, setCreating] = useState(false),
    [editing, setEditing] = useState<InventoryItem | null>(null),
    [lending, setLending] = useState<InventoryItem | null>(null),
    [retiring, setRetiring] = useState<InventoryItem | null>(null),
    [viewing, setViewing] = useState<InventoryItem | null>(null),
    [error, setError] = useState('');
  const debounced = useDebounced(search);
  const summary = useQuery({
    queryKey: ['inventory', 'summary', me.activeOrganizationId],
    queryFn: () => api<Summary>('/inventory/summary'),
  });
  const query = useQuery({
    queryKey: [
      'inventory',
      'items',
      me.activeOrganizationId,
      debounced,
      category,
      condition,
      availability,
      status,
      page,
    ],
    queryFn: () =>
      api<Page<InventoryItem>>(
        `/inventory/items?page=${page}&search=${encodeURIComponent(debounced)}&category=${encodeURIComponent(category)}&availability=${availability}&status=${status}${condition ? `&condition=${condition}` : ''}`,
      ),
  });
  const filter = (
    label: string,
    value: string,
    set: (v: string) => void,
    options: [string, string][],
  ) => (
    <Field label={label}>
      <select
        value={value}
        onChange={(e) => {
          set(e.target.value);
          setPage(1);
        }}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </Field>
  );
  const exportCsv = () => {
    setError('');
    void downloadPrivateFile(
      `/inventory/items/export?status=${status === 'retired' ? 'retired' : status === 'all' ? 'all' : 'active'}&language=${i18n.language === 'it' ? 'it' : 'de'}`,
      'inventar.csv',
    ).catch((e) => setError(errorMessage(e)));
  };
  return (
    <>
      <PageHeading
        title={t('inventory')}
        description={t('invIntro')}
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv}>
              <Download size={17} />
              {t('invExport')}
            </Button>
            {can('inventory:write') && (
              <Button onClick={() => setCreating(true)}>
                <Plus size={17} />
                {t('invCreate')}
              </Button>
            )}
          </>
        }
      />
      <InventoryNavigation />
      <SummaryTiles />
      {error && <Notice error>{error}</Notice>}
      <section className="panel">
        <div className="toolbar event-filters">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
          />
          {filter(t('invCategory'), category, setCategory, [
            ['', t('all')],
            ...(summary.data?.categories ?? []).map((c) => [c, c] as [string, string]),
          ])}
          {filter(t('invCondition'), condition, setCondition, [
            ['', t('all')],
            ...conditions.map((c) => [c, t(`invCondition_${c}`)] as [string, string]),
          ])}
          {filter(t('invAvailability'), availability, setAvailability, [
            ['all', t('all')],
            ['available', t('invAvailable')],
            ['lent', t('invLentOut')],
            ['overdue', t('invOverdue')],
          ])}
          {filter(t('status'), status, setStatus, [
            ['active', t('invStatus_active')],
            ['retired', t('invStatus_retired')],
            ['all', t('all')],
          ])}
        </div>
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : query.data.items.length ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('invName')}</th>
                    <th>{t('invCategory')}</th>
                    <th>{t('invLocation')}</th>
                    <th>{t('invCondition')}</th>
                    <th>{t('invAvailableColumn')}</th>
                    <th>{t('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.name}</strong>
                        <small className="block-note">
                          {item.inventoryNumber || t('invNoNumber')}
                          {item.status === 'retired' ? ` · ${t('invStatus_retired')}` : ''}
                        </small>
                      </td>
                      <td>{item.category || '—'}</td>
                      <td>{item.location || '—'}</td>
                      <td>
                        <StatusTag prefix="invCondition" value={item.condition} />
                      </td>
                      <td>
                        {t('invAvailableOf', {
                          available: item.availableQuantity,
                          total: item.quantity,
                        })}
                        {item.overdueLoans > 0 && (
                          <small className="block-note warning-text">
                            {t('invOverdueCount', { count: item.overdueLoans })}
                          </small>
                        )}
                      </td>
                      <td className="row-actions">
                        <Button
                          variant="ghost"
                          aria-label={`${t('details')}: ${item.name}`}
                          onClick={() => setViewing(item)}
                        >
                          <Eye size={17} />
                        </Button>
                        {item.status === 'active' &&
                          can('inventory:lend') &&
                          item.availableQuantity > 0 && (
                            <Button
                              variant="ghost"
                              aria-label={`${t('invLend')}: ${item.name}`}
                              onClick={() => setLending(item)}
                            >
                              <PackageOpen size={17} />
                            </Button>
                          )}
                        {item.status === 'active' && can('inventory:write') && (
                          <>
                            <Button
                              variant="ghost"
                              aria-label={`${t('edit')}: ${item.name}`}
                              onClick={() => setEditing(item)}
                            >
                              <Pencil size={17} />
                            </Button>
                            <Button
                              variant="ghost"
                              aria-label={`${t('invRetire')}: ${item.name}`}
                              disabled={item.lentQuantity > 0}
                              title={item.lentQuantity > 0 ? t('invRetireBlocked') : undefined}
                              onClick={() => setRetiring(item)}
                            >
                              <Archive size={17} />
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              pageSize={query.data.pageSize}
              total={query.data.total}
              onChange={setPage}
            />
          </>
        ) : (
          <Empty title={t('invEmpty')} />
        )}
      </section>
      {creating && (
        <FormModal
          wide
          title={t('invCreate')}
          fields={itemFields(t)}
          onClose={() => setCreating(false)}
          onSubmit={async (v) => {
            await write('/inventory/items', itemPayload(v));
            refresh();
            setCreating(false);
          }}
        />
      )}
      {editing && (
        <FormModal
          wide
          title={`${t('edit')}: ${editing.name}`}
          fields={itemFields(t, editing)}
          onClose={() => setEditing(null)}
          onSubmit={async (v) => {
            await write(
              `/inventory/items/${editing.id}`,
              { version: editing.version, ...itemPayload(v) },
              'PATCH',
            );
            refresh();
            setEditing(null);
          }}
        />
      )}
      {retiring && (
        <FormModal
          title={`${t('invRetire')}: ${retiring.name}`}
          submitLabel={t('invRetire')}
          fields={[
            {
              name: 'retiredOn',
              label: t('invRetiredOn'),
              type: 'date',
              required: true,
              defaultValue: localToday(),
            },
            { name: 'reason', label: t('invRetireReason'), type: 'textarea', required: true },
          ]}
          onClose={() => setRetiring(null)}
          onSubmit={async (v) => {
            await write(`/inventory/items/${retiring.id}/retire`, {
              version: retiring.version,
              retiredOn: v.retiredOn,
              reason: v.reason,
            });
            refresh();
            setRetiring(null);
          }}
        >
          <p className="form-hint">{t('invRetireHint')}</p>
        </FormModal>
      )}
      {lending && <LendDialog item={lending} onClose={() => setLending(null)} />}
      {viewing && <ItemDetail item={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function LoanTable({
  loans,
  actions,
}: {
  loans: InventoryLoan[];
  actions?: (loan: InventoryLoan) => React.ReactNode;
}) {
  const { t, i18n } = useTranslation();
  // Without row buttons a horizontally scrollable table needs its own keyboard focus.
  const region = actions ? {} : { role: 'region', 'aria-label': t('invLoans'), tabIndex: 0 };
  return (
    <div className="table-scroll" {...region}>
      <table>
        <thead>
          <tr>
            <th>{t('invItem')}</th>
            <th>{t('invBorrower')}</th>
            <th>{t('invQuantityShort')}</th>
            <th>{t('invIssuedOn')}</th>
            <th>{t('invDueOn')}</th>
            <th>{t('status')}</th>
            {actions && <th>{t('actions')}</th>}
          </tr>
        </thead>
        <tbody>
          {loans.map((l) => (
            <tr key={l.id}>
              <td>
                <strong>{l.itemName}</strong>
                {l.inventoryNumber && <small className="block-note">{l.inventoryNumber}</small>}
              </td>
              <td>
                {l.borrowerName}
                {!l.borrowerIsMember && <small className="block-note">{t('invGuest')}</small>}
              </td>
              <td>{l.quantity}</td>
              <td>{formatDate(l.issuedOn, i18n.language)}</td>
              <td>{formatDate(l.dueOn, i18n.language)}</td>
              <td>
                {l.returnedOn ? (
                  <span className="subtle-tag">
                    {t('invReturnedAt', { date: formatDate(l.returnedOn, i18n.language) })}
                  </span>
                ) : l.overdue ? (
                  <span className="subtle-tag tag-overdue">
                    {t('invOverdueDays', { count: l.daysOverdue })}
                  </span>
                ) : (
                  <span className="subtle-tag tag-active">{t('invLentOut')}</span>
                )}
              </td>
              {actions && <td className="row-actions">{actions(l)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function InventoryLoans() {
  const { t } = useTranslation(),
    { me } = useSession(),
    can = usePermission(),
    write = useInventoryWrite();
  const [state, setState] = useState('open'),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [returning, setReturning] = useState<InventoryLoan | null>(null),
    [extending, setExtending] = useState<InventoryLoan | null>(null);
  const debounced = useDebounced(search);
  const query = useQuery({
    queryKey: ['inventory', 'loans', me.activeOrganizationId, state, debounced, page],
    queryFn: () =>
      api<Page<InventoryLoan>>(
        `/inventory/loans?state=${state}&page=${page}&search=${encodeURIComponent(debounced)}`,
      ),
  });
  return (
    <>
      <PageHeading title={t('inventory')} description={t('invLoansIntro')} />
      <InventoryNavigation />
      <section className="panel">
        <div className="toolbar event-filters">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
          />
          <Field label={t('status')}>
            <select
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                setPage(1);
              }}
            >
              {(['open', 'overdue', 'returned', 'all'] as const).map((v) => (
                <option key={v} value={v}>
                  {t(`invLoanState_${v}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : query.data.items.length ? (
          <>
            <LoanTable
              loans={query.data.items}
              actions={
                can('inventory:lend')
                  ? (l) =>
                      !l.returnedOn && (
                        <>
                          <Button
                            variant="ghost"
                            aria-label={`${t('invReturn')}: ${l.itemName}, ${l.borrowerName}`}
                            onClick={() => setReturning(l)}
                          >
                            <Undo2 size={17} />
                          </Button>
                          <Button
                            variant="ghost"
                            aria-label={`${t('invExtend')}: ${l.itemName}, ${l.borrowerName}`}
                            onClick={() => setExtending(l)}
                          >
                            <CalendarPlus size={17} />
                          </Button>
                        </>
                      )
                  : undefined
              }
            />
            <Pagination
              page={page}
              pageSize={query.data.pageSize}
              total={query.data.total}
              onChange={setPage}
            />
          </>
        ) : (
          <Empty title={t('invNoLoans')} />
        )}
      </section>
      {returning && (
        <FormModal
          title={`${t('invReturn')}: ${returning.itemName}`}
          submitLabel={t('invReturn')}
          fields={[
            {
              name: 'returnedOn',
              label: t('invReturnedOn'),
              type: 'date',
              required: true,
              defaultValue: localToday(),
            },
            {
              name: 'returnCondition',
              label: t('invReturnCondition'),
              type: 'select',
              defaultValue: returning.issueCondition,
              options: conditions.map((c) => ({ value: c, label: t(`invCondition_${c}`) })),
            },
            { name: 'returnNotes', label: t('invReturnNotes'), type: 'textarea' },
          ]}
          onClose={() => setReturning(null)}
          onSubmit={async (v) => {
            await write(`/inventory/loans/${returning.id}/return`, {
              version: returning.version,
              returnedOn: v.returnedOn,
              returnCondition: v.returnCondition,
              returnNotes: v.returnNotes,
            });
            refresh();
            setReturning(null);
          }}
        >
          <p className="form-hint">
            {t('invReturnHint', { name: returning.borrowerName, count: returning.quantity })}
          </p>
        </FormModal>
      )}
      {extending && (
        <FormModal
          title={`${t('invExtend')}: ${extending.itemName}`}
          fields={[
            {
              name: 'dueOn',
              label: t('invDueOn'),
              type: 'date',
              required: true,
              defaultValue: extending.dueOn > localToday() ? extending.dueOn : inDays(14),
            },
          ]}
          onClose={() => setExtending(null)}
          onSubmit={async (v) => {
            await write(`/inventory/loans/${extending.id}/extend`, {
              version: extending.version,
              dueOn: v.dueOn,
            });
            refresh();
            setExtending(null);
          }}
        />
      )}
    </>
  );
}
// Read-only list on the profile page; empty for accounts without a linked person.
export function MyLoans() {
  const { t } = useTranslation(),
    { me } = useSession();
  const query = useQuery({
    queryKey: ['inventory', 'my-loans', me.activeOrganizationId],
    queryFn: () => api<Page<InventoryLoan>>('/inventory/my-loans?state=open'),
  });
  if (!query.data?.items.length) return null;
  return (
    <section className="panel" aria-labelledby="my-loans-title">
      <h2 id="my-loans-title">{t('invMyLoans')}</h2>
      <LoanTable loans={query.data.items} />
    </section>
  );
}
