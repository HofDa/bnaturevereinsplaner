import { useMemo, useState } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import luxonPlugin from '@fullcalendar/luxon3';
import deLocale from '@fullcalendar/core/locales/de';
import itLocale from '@fullcalendar/core/locales/it';
import {
  eventLocal,
  type EventOccurrence,
  type EventCategory,
  type EventSeries,
  type EventRegistration,
  type AttendanceRecord,
  type AttendanceResult,
  type AttendanceSnapshot,
  type Page,
} from '@bnature/contracts';
import {
  Button,
  Field,
  FormActions,
  Loading,
  Empty,
  ErrorState,
  Modal,
  Notice,
  PageHeading,
  Pagination,
  SearchInput,
  formatDate,
  QueryView,
} from '../../components/ui';
import { api, allPages, downloadPrivateFile, errorMessage, queryClient } from '../../lib/api';
import { useSession } from '../../app/session';
import { useDebounced } from '../../hooks/use-debounced';
import { useFinancialWrite as useEventWrite } from '../finance/client';
import { EntryDocuments } from '../documents';
import { EventForm } from './forms';
import {
  savePreparedAttendance,
  attendanceGeneration,
  queuedAttendance,
  synchronizeAttendance,
} from '../../lib/attendance-offline';
export const refreshEvents = () =>
  void queryClient.invalidateQueries({
    predicate: (q) => String(q.queryKey[0]).startsWith('event-'),
  });
function useCategories() {
  const { me } = useSession();
  return useQuery({
    queryKey: ['event-categories', me.activeOrganizationId],
    queryFn: () => api<{ items: EventCategory[] }>('/event-categories'),
  });
}
/** Links between the event areas. The overview passes `views={false}`: its tabs already switch views. */
function EventNavigation({ views = true }: { views?: boolean }) {
  const { t } = useTranslation(),
    { me } = useSession();
  const links = [
    ...(views
      ? [
          { to: '/events', label: 'eventCalendar' },
          { to: '/events?view=list', label: 'eventAll' },
          { to: '/events?view=mine', label: 'eventMine' },
        ]
      : []),
    ...(me.permissions.includes('events:write')
      ? [{ to: '/events/attendance', label: 'eventAttendanceNav' }]
      : []),
    { to: '/offline-attendance', label: 'eventOfflineAttendance' },
    { to: '/events/categories', label: 'eventCategories' },
  ];
  return (
    <nav className="event-navigation" aria-label={t('events')}>
      {links.map((link) => (
        <NavLink key={link.to} to={link.to} end>
          {t(link.label)}
        </NavLink>
      ))}
    </nav>
  );
}
export function Events() {
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    navigate = useNavigate(),
    categories = useCategories(),
    write = useEventWrite();
  const initial = new URLSearchParams(location.search).get('view') ?? 'calendar';
  const [view, setView] = useState(initial),
    [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [status, setStatus] = useState(''),
    [project, setProject] = useState(''),
    [page, setPage] = useState(1),
    [range, setRange] = useState({
      from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
      to: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 8).toISOString(),
    }),
    [editor, setEditor] = useState<{ date?: string } | null>(null),
    [error, setError] = useState('');
  const debounced = useDebounced(search),
    debouncedProject = useDebounced(project),
    language = i18n.language === 'it' ? 'it' : 'de';
  const parameters = new URLSearchParams({
    search: debounced,
    ...(category ? { categoryId: category } : {}),
    ...(status ? { status } : {}),
    ...(debouncedProject ? { project: debouncedProject } : {}),
    ...(view === 'calendar' ? range : {}),
    ...(view === 'mine' ? { mine: 'true' } : {}),
  }).toString();
  const query = useQuery({
    queryKey: ['event-list', me.activeOrganizationId, parameters, page, view],
    // Keep the current rows on screen while the next page, filter or month loads — but never
    // carry events over into a different view (e.g. “all” rows shown under “mine”).
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[4] === view ? previous : undefined,
    queryFn: () =>
      view === 'calendar'
        ? allPages<EventOccurrence>(`/events?${parameters}`).then((items) => ({
            items,
            total: items.length,
            page: 1,
            pageSize: items.length || 30,
          }))
        : api<Page<EventOccurrence>>(`/events?${parameters}&page=${page}`),
  });
  const calendarEvents = useMemo(
    () =>
      query.data?.items.map((e) => ({
        id: e.id,
        title: e.titleI18n[language],
        start: e.startAt,
        end: e.endAt,
        classNames: [`event-calendar-${e.status}`],
      })) ?? [],
    [query.data, language],
  );
  return (
    <>
      <PageHeading
        title={t('events')}
        description={t('eventIntro')}
        actions={
          <>
            {me.permissions.includes('events:write') && (
              <Button
                disabled={!categories.data?.items.some((c) => c.active)}
                onClick={() => setEditor({})}
              >
                {t('eventCreate')}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await downloadPrivateFile(
                    `/events/calendar.ics?${parameters}&language=${language}`,
                    'bnature-events.ics',
                  );
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              {t('eventIcs')}
            </Button>
          </>
        }
      />
      <EventNavigation views={false} />
      <section className="panel event-panel">
        <div className="finance-tabs" role="tablist" aria-label={t('events')}>
          {['calendar', 'list', 'mine'].map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              type="button"
              onClick={() => {
                setView(v);
                setPage(1);
                navigate(`/events${v === 'calendar' ? '' : `?view=${v}`}`, { replace: true });
              }}
            >
              {t(v === 'calendar' ? 'eventCalendar' : v === 'mine' ? 'eventMine' : 'eventAll')}
            </button>
          ))}
        </div>
        <div className="toolbar event-filters">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder={t('eventSearch')}
          />
          <Field label={t('eventCategory')}>
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t('eventAllCategories')}</option>
              {categories.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameI18n[language]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('status')}>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t('eventAllStatuses')}</option>
              {['draft', 'published', 'cancelled', 'completed'].map((s) => (
                <option key={s} value={s}>
                  {t(`eventStatus_${s}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('eventProject')}>
            <input
              value={project}
              onChange={(e) => {
                setProject(e.target.value);
                setPage(1);
              }}
            />
          </Field>
        </div>
        {error && <Notice error>{error}</Notice>}
        {categories.isError && <ErrorState error={categories.error} />}{' '}
        {!categories.isPending && !categories.data?.items.length && (
          <div className="event-empty">
            <Empty description={t('eventNoCategories')} />
            {me.permissions.includes('events:categories') && (
              <Button
                onClick={async () => {
                  try {
                    await write('/event-categories/initialize', {});
                    refreshEvents();
                  } catch (e) {
                    setError(errorMessage(e));
                  }
                }}
              >
                {t('eventInitializeCategories')}
              </Button>
            )}
          </div>
        )}
        {query.isError ? (
          <ErrorState error={query.error} />
        ) : view === 'calendar' ? (
          <div className="event-calendar">
            <FullCalendar
              plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, luxonPlugin]}
              initialView={matchMedia('(max-width: 640px)').matches ? 'listMonth' : 'dayGridMonth'}
              locale={language === 'it' ? itLocale : deLocale}
              timeZone="Europe/Rome"
              buttonIcons={false}
              buttonText={{ prev: t('eventPrevious'), next: t('eventNext') }}
              headerToolbar={{
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,listMonth',
              }}
              height="auto"
              events={calendarEvents}
              datesSet={(info) =>
                setRange((previous) =>
                  previous.from === info.startStr && previous.to === info.endStr
                    ? previous
                    : { from: info.startStr, to: info.endStr },
                )
              }
              eventClick={(info) => navigate(`/events/${info.event.id}`)}
              dateClick={(info) => {
                if (me.permissions.includes('events:write'))
                  setEditor({ date: info.dateStr.slice(0, 10) });
              }}
            />
          </div>
        ) : query.isPending ? (
          <Loading />
        ) : query.data.items.length ? (
          <>
            <div className="table-scroll" tabIndex={0} role="region" aria-label={t('events')}>
              <table>
                <thead>
                  <tr>
                    <th>{t('title')}</th>
                    <th>{t('eventStart')}</th>
                    <th>{t('eventLocation')}</th>
                    <th>{t('status')}</th>
                    <th>{t('eventParticipants')}</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <Link to={`/events/${e.id}`}>{e.titleI18n[language]}</Link>
                      </td>
                      <td>
                        {eventLocal(e.startAt, e.timezone).replace('T', ' ')}
                        <small className="finance-cell-note">{e.timezone}</small>
                      </td>
                      <td>{e.location}</td>
                      <td>{t(`eventStatus_${e.status}`)}</td>
                      <td>
                        {e.registeredCount}
                        {e.capacity !== null ? ` / ${e.capacity}` : ''}
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
          <Empty description={t('noResults')} />
        )}
      </section>
      {editor && (
        <Modal wide title={t('eventCreate')} onClose={() => setEditor(null)}>
          <EventForm
            categories={categories.data?.items ?? []}
            defaultDate={editor.date}
            onCancel={() => setEditor(null)}
            onDone={() => {
              setEditor(null);
              refreshEvents();
            }}
          />
        </Modal>
      )}
    </>
  );
}
export function EventDetails() {
  const { id = '' } = useParams(),
    { t, i18n } = useTranslation(),
    { me } = useSession(),
    write = useEventWrite(),
    categories = useCategories();
  const [tab, setTab] = useState(new URLSearchParams(location.search).get('tab') ?? 'info'),
    [editor, setEditor] = useState<'edit' | 'cancel' | null>(null),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  const query = useQuery({
    queryKey: ['event-detail', me.activeOrganizationId, id],
    queryFn: () => api<EventOccurrence>(`/events/${id}`),
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} />;
  const event = query.data,
    language = i18n.language === 'it' ? 'it' : 'de';
  return (
    <>
      <PageHeading
        title={event.titleI18n[language]}
        description={`${eventLocal(event.startAt, event.timezone).replace('T', ' ')} – ${eventLocal(event.endAt, event.timezone).replace('T', ' ')} · ${event.timezone}`}
        actions={
          event.canManage && (
            <>
              <Button
                variant="secondary"
                disabled={event.status === 'cancelled'}
                onClick={() => setEditor('edit')}
              >
                {t('edit')}
              </Button>
              <Button
                variant="secondary"
                disabled={event.status === 'cancelled' || event.status === 'completed'}
                onClick={() => setEditor('cancel')}
              >
                {t('eventCancel')}
              </Button>
            </>
          )
        }
      />
      <EventNavigation />
      {error && <Notice error>{error}</Notice>}
      <section className="panel event-panel">
        <div className="finance-tabs" role="tablist" aria-label={t('events')}>
          {[
            'info',
            'participants',
            ...(event.canManage ? ['attendance'] : []),
            ...(event.canManage || me.permissions.includes('documents:read') ? ['documents'] : []),
          ].map((value) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab === value}
              key={value}
              onClick={() => setTab(value)}
            >
              {t(`eventTab_${value}`)}
            </button>
          ))}
        </div>
        {tab === 'info' ? (
          <div className="event-description">
            <span className="badge">{t(`eventStatus_${event.status}`)}</span>
            {event.cancellationReason && <Notice>{event.cancellationReason}</Notice>}
            <p className="event-preserve-lines">{event.descriptionI18n[language]}</p>
            <dl className="event-facts">
              {[
                [t('eventCategory'), event.categoryNameI18n[language]],
                [t('eventLocation'), event.location || '—'],
                [t('eventOrganizer'), event.organizerName],
                [t('eventProject'), event.project || '—'],
                [t('eventVisibility'), t(`eventVisibility_${event.visibility}`)],
                [
                  t('eventParticipants'),
                  `${event.registeredCount}${event.capacity !== null ? ` / ${event.capacity}` : ''}`,
                ],
                [
                  t('eventAvailableSeats'),
                  event.capacity === null
                    ? t('eventUnlimitedSeats')
                    : String(Math.max(0, event.capacity - event.registeredCount)),
                ],
                [t('eventWaitlist'), String(event.waitlistedCount)],
                [
                  t('eventDeadline'),
                  event.registrationDeadline
                    ? formatDate(event.registrationDeadline, language)
                    : '—',
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : tab === 'participants' ? (
          <Registrations event={event} />
        ) : tab === 'attendance' && event.canManage ? (
          <EventAttendance event={event} />
        ) : tab === 'documents' &&
          (event.canManage || me.permissions.includes('documents:read')) ? (
          <EntryDocuments
            eventOccurrenceId={event.id}
            title={event.titleI18n[language]}
            canWrite={event.canManage}
          />
        ) : null}
      </section>
      {editor && (
        <Modal
          wide={editor === 'edit'}
          title={t(editor === 'edit' ? 'eventEdit' : 'eventCancel')}
          onClose={() => setEditor(null)}
        >
          {editor === 'edit' ? (
            <EventForm
              event={event}
              categories={categories.data?.items ?? []}
              onCancel={() => setEditor(null)}
              onDone={() => {
                setEditor(null);
                refreshEvents();
              }}
            />
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setPending(true);
                try {
                  if (f.get('scope') === 'series' && event.seriesId) {
                    const versions = await api<{ items: EventSeries[] }>('/event-series'),
                      series = versions.items.find((s) => s.id === event.seriesId);
                    if (!series) throw new Error('eventOfflineLocked');
                    await write(
                      `/event-series/${series.id}`,
                      {
                        version: series.version,
                        event: { status: 'cancelled' },
                        reason: f.get('reason'),
                      },
                      'PATCH',
                    );
                  } else
                    await write(`/events/${event.id}/cancel`, {
                      version: event.version,
                      reason: f.get('reason'),
                    });
                  setEditor(null);
                  refreshEvents();
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setPending(false);
                }
              }}
            >
              <p>{t('eventCancelHelp')}</p>
              {event.seriesId &&
                (['admin', 'board'].includes(me.role) || event.createdBy === me.user.id) && (
                  <Field label={t('eventEditScope')}>
                    <select name="scope">
                      <option value="single">{t('eventSingleOccurrence')}</option>
                      <option value="series">{t('eventCancelFutureSeries')}</option>
                    </select>
                  </Field>
                )}
              <Field label={t('reason')}>
                <textarea name="reason" required maxLength={500} />
              </Field>
              <FormActions pending={pending} onCancel={() => setEditor(null)} />
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
function Registrations({ event }: { event: EventOccurrence }) {
  const { t } = useTranslation(),
    { me } = useSession(),
    write = useEventWrite(),
    [error, setError] = useState(''),
    [adding, setAdding] = useState(false),
    [search, setSearch] = useState(''),
    [guest, setGuest] = useState(false),
    [pending, setPending] = useState(false),
    [notice, setNotice] = useState('');
  const query = useQuery({
    queryKey: ['event-registrations', me.activeOrganizationId, event.id],
    queryFn: () => api<{ items: EventRegistration[] }>(`/events/${event.id}/registrations`),
  });
  const people = useQuery({
    queryKey: ['event-people', me.activeOrganizationId, search],
    queryFn: () =>
      api<{ items: Array<{ id: string; displayName: string; member: boolean }> }>(
        `/event-people?search=${encodeURIComponent(search)}`,
      ),
    enabled: event.canManage && adding,
  });
  async function change(row: EventRegistration, status: EventRegistration['status']) {
    setError('');
    try {
      await write(`/registrations/${row.id}`, { version: row.version, status }, 'PATCH');
      refreshEvents();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <div className="event-section">
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      <div className="toolbar">
        {event.canManage ? (
          <Button disabled={event.status !== 'published'} onClick={() => setAdding(true)}>
            {t('eventAddParticipant')}
          </Button>
        ) : (
          <Button
            disabled={
              event.status !== 'published' ||
              query.data?.items.some((r) => r.status !== 'cancelled')
            }
            onClick={async () => {
              try {
                await write(`/events/${event.id}/registrations`, {});
                setNotice(t('eventRegistrationConfirmed'));
                refreshEvents();
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            {t('eventRegisterSelf')}
          </Button>
        )}
      </div>
      <QueryView query={query}>
        {(data) => (
          <ul className="finance-allocation-history">
            {data.items.map((row) => (
              <li key={row.id}>
                <span>
                  <strong>{row.displayName}</strong>
                  <small className="finance-cell-note">
                    {t(`eventRegistration_${row.status}`)}
                    {row.waitlistPosition !== null ? ` · ${row.waitlistPosition}` : ''}
                  </small>
                </span>
                <div className="event-checkin-actions">
                  {row.status !== 'cancelled' && (
                    <Button variant="secondary" onClick={() => void change(row, 'cancelled')}>
                      {t('eventUnregister')}
                    </Button>
                  )}
                  {event.canManage && row.status === 'waitlisted' && (
                    <Button variant="secondary" onClick={() => void change(row, 'registered')}>
                      {t('eventPromote')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
      {adding && (
        <Modal title={t('eventAddParticipant')} onClose={() => setAdding(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setPending(true);
              try {
                await write(`/events/${event.id}/registrations`, {
                  ...(guest
                    ? {
                        guest: {
                          firstName: f.get('firstName'),
                          lastName: f.get('lastName'),
                          email: f.get('email') ?? '',
                        },
                      }
                    : { personId: f.get('personId') }),
                  overrideDeadline: f.has('overrideDeadline'),
                });
                setAdding(false);
                setNotice(t('eventRegistrationConfirmed'));
                refreshEvents();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setPending(false);
              }
            }}
          >
            <label className="checkbox-row">
              <input type="checkbox" checked={guest} onChange={(e) => setGuest(e.target.checked)} />
              {t('eventExternalGuest')}
            </label>
            {guest ? (
              <div className="form-grid">
                <Field label={`${t('firstName')} *`}>
                  <input name="firstName" required maxLength={100} />
                </Field>
                <Field label={`${t('lastName')} *`}>
                  <input name="lastName" required maxLength={100} />
                </Field>
                <Field label={t('email')}>
                  <input name="email" type="email" />
                </Field>
              </div>
            ) : (
              <>
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder={t('eventSearchParticipants')}
                />
                <Field label={t('eventParticipant')}>
                  <select name="personId" required>
                    <option value="">{t('eventChoosePerson')}</option>
                    {people.data?.items.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.displayName}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}
            <label className="checkbox-row">
              <input name="overrideDeadline" type="checkbox" />
              {t('eventOverrideDeadline')}
            </label>
            {error && <Notice error>{error}</Notice>}
            <FormActions create pending={pending} onCancel={() => setAdding(false)} />
          </form>
        </Modal>
      )}
    </div>
  );
}
function EventAttendance({ event }: { event: EventOccurrence }) {
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    [search, setSearch] = useState(''),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false),
    [history, setHistory] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['event-attendance', me.activeOrganizationId, event.id],
    queryFn: () => api<{ items: AttendanceRecord[] }>(`/events/${event.id}/attendance`),
  });
  async function mark(row: AttendanceRecord, status: AttendanceRecord['status']) {
    setError('');
    try {
      const result = await api<AttendanceResult>(
        `/events/${event.id}/attendance/${row.registrationId}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            requestedStatus: status,
            expectedVersion: row.version,
            clientCreatedAt: new Date().toISOString(),
          }),
        },
      );
      if (result.status !== 'applied') setError(t('eventConflictRefresh'));
      refreshEvents();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <div className="event-section">
      <div className="toolbar">
        <Button
          disabled={pending || event.status === 'draft' || event.status === 'cancelled'}
          onClick={async () => {
            const generation = attendanceGeneration();
            setPending(true);
            setError('');
            try {
              if ((await queuedAttendance(event.id)).length) await synchronizeAttendance();
              const snapshot = await api<AttendanceSnapshot>(
                `/events/${event.id}/attendance/prepare`,
              );
              await savePreparedAttendance(me, snapshot, generation);
              location.assign(`/offline-attendance?event=${event.id}`);
            } catch (e) {
              setError(
                e instanceof Error && e.message.startsWith('event')
                  ? t(e.message)
                  : errorMessage(e),
              );
            } finally {
              setPending(false);
            }
          }}
        >
          {t('eventPrepareOffline')}
        </Button>
        <Link className="button button-secondary" to={`/offline-attendance?event=${event.id}`}>
          {t('eventOpenOffline')}
        </Link>
        {(['pdf', 'csv'] as const).map((format) => (
          <Button
            key={format}
            variant="secondary"
            onClick={async () => {
              try {
                await downloadPrivateFile(
                  `/events/${event.id}/attendance/export?format=${format}&language=${i18n.language === 'it' ? 'it' : 'de'}`,
                  `bnature-attendance-${event.id}.${format}`,
                );
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            {t(format === 'pdf' ? 'eventAttendancePdf' : 'eventAttendanceCsv')}
          </Button>
        ))}
      </div>
      {error && <Notice error>{error}</Notice>}
      <SearchInput value={search} onChange={setSearch} placeholder={t('eventSearchParticipants')} />
      <QueryView query={query}>
        {(data) => (
          <ul className="event-checkin-list">
            {data.items
              .filter((p) => p.displayName.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
              .map((row) => (
                <li key={row.registrationId}>
                  <div>
                    <strong>{row.displayName}</strong>
                    <span className="badge">{t(`eventAttendance_${row.status}`)}</span>
                    <small>
                      {row.checkedInAt
                        ? new Date(row.checkedInAt).toLocaleString(i18n.language)
                        : ''}{' '}
                      {row.recordedByName ?? ''}
                    </small>
                  </div>
                  <div className="event-checkin-actions">
                    {(['present', 'absent', 'excused', 'unrecorded'] as const).map((status) => (
                      <Button
                        key={status}
                        variant="secondary"
                        disabled={
                          row.registrationStatus !== 'registered' || event.status === 'cancelled'
                        }
                        aria-pressed={row.status === status}
                        onClick={() => void mark(row, status)}
                      >
                        {t(`eventAttendance_${status}`)}
                      </Button>
                    ))}
                    <Button variant="ghost" onClick={() => setHistory(row.registrationId)}>
                      {t('eventHistory')}
                    </Button>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </QueryView>
      {history && (
        <Modal title={t('eventHistory')} onClose={() => setHistory(null)}>
          <AttendanceHistory eventId={event.id} registrationId={history} />
        </Modal>
      )}
    </div>
  );
}
function AttendanceHistory({
  eventId,
  registrationId,
}: {
  eventId: string;
  registrationId: string;
}) {
  const { t, i18n } = useTranslation(),
    { me } = useSession();
  const query = useQuery({
    queryKey: ['event-attendance-history', me.activeOrganizationId, eventId, registrationId],
    queryFn: () =>
      api<{
        items: Array<{
          id: string;
          status: string;
          version: number;
          createdAt: string;
          recordedBy: string;
          recordedByName?: string | null;
        }>;
      }>(`/events/${eventId}/attendance/${registrationId}/history`),
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} />;
  return (
    <ul>
      {query.data.items.map((h) => (
        <li key={h.id}>
          {new Date(h.createdAt).toLocaleString(i18n.language)} · {t(`eventAttendance_${h.status}`)}{' '}
          · {h.recordedByName ?? ''} · v{h.version}
        </li>
      ))}
    </ul>
  );
}
export function EventCategories() {
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    categories = useCategories(),
    write = useEventWrite(),
    [editor, setEditor] = useState<EventCategory | null | false>(false),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  return (
    <>
      <PageHeading
        title={t('eventCategories')}
        description={t('eventCategoriesHelp')}
        actions={
          me.permissions.includes('events:categories') && (
            <>
              <Button onClick={() => setEditor(null)}>{t('eventAddCategory')}</Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    await write('/event-categories/initialize', {});
                    refreshEvents();
                  } catch (e) {
                    setError(errorMessage(e));
                  }
                }}
              >
                {t('eventInitializeCategories')}
              </Button>
            </>
          )
        }
      />
      <EventNavigation />
      {error && <Notice error>{error}</Notice>}
      <section className="panel event-section">
        <QueryView query={categories}>
          {(data) => (
            <ul className="finance-allocation-history">
              {data.items.map((c) => (
                <li key={c.id}>
                  <span>
                    {c.nameI18n[i18n.language === 'it' ? 'it' : 'de']} ·{' '}
                    {t(c.active ? 'active' : 'inactive')}
                  </span>
                  {me.permissions.includes('events:categories') && (
                    <Button variant="secondary" onClick={() => setEditor(c)}>
                      {t('edit')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </section>
      {editor !== false && (
        <Modal title={t('eventAddCategory')} onClose={() => setEditor(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setPending(true);
              try {
                const input = {
                  nameI18n: { de: f.get('de'), it: f.get('it') },
                  active: f.has('active'),
                };
                await write(
                  editor ? `/event-categories/${editor.id}` : '/event-categories',
                  editor ? { ...input, version: editor.version } : input,
                  editor ? 'PATCH' : 'POST',
                );
                setEditor(false);
                refreshEvents();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setPending(false);
              }
            }}
          >
            <Field label={`${t('eventTitleDe')} *`}>
              <input name="de" required maxLength={200} defaultValue={editor?.nameI18n.de ?? ''} />
            </Field>
            <Field label={`${t('eventTitleIt')} *`}>
              <input name="it" required maxLength={200} defaultValue={editor?.nameI18n.it ?? ''} />
            </Field>
            <label className="checkbox-row">
              <input type="checkbox" name="active" defaultChecked={editor?.active ?? true} />
              {t('active')}
            </label>
            {error && <Notice error>{error}</Notice>}
            <FormActions pending={pending} create={!editor} onCancel={() => setEditor(false)} />
          </form>
        </Modal>
      )}
    </>
  );
}

export function EventAttendanceIndex() {
  const { t, i18n } = useTranslation(),
    { me } = useSession();
  const query = useQuery({
    queryKey: ['event-attendance-index', me.activeOrganizationId],
    queryFn: () => allPages<EventOccurrence>('/events'),
  });
  return (
    <>
      <PageHeading title={t('eventAttendanceNav')} description={t('eventSelectForAttendance')} />
      <EventNavigation />
      <section className="panel event-section">
        <QueryView query={query}>
          {(data) => (
            <ul className="finance-allocation-history">
              {data
                .filter((e) => e.canManage)
                .map((e) => (
                  <li key={e.id}>
                    <span>
                      {e.titleI18n[i18n.language === 'it' ? 'it' : 'de']} ·{' '}
                      {formatDate(e.startAt, i18n.language)}
                    </span>
                    <Link className="button button-secondary" to={`/events/${e.id}?tab=attendance`}>
                      {t('eventTab_attendance')}
                    </Link>
                  </li>
                ))}
            </ul>
          )}
        </QueryView>
      </section>
    </>
  );
}
