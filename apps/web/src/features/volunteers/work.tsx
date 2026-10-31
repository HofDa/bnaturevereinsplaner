import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Download } from 'lucide-react';
import type {
  EventOccurrence,
  Page,
  VolunteerAssignment,
  VolunteerSummary,
  VolunteerTimeEntry,
} from '@bnature/contracts';
import { api, allPages, downloadPrivateFile, errorMessage, queryClient } from '../../lib/api';
import { useSession } from '../../app/session';
import {
  Button,
  Empty,
  Field,
  Modal,
  Notice,
  PageHeading,
  Pagination,
  formatDate,
  QueryView,
} from '../../components/ui';
import {
  CoverageBadge,
  FormModal,
  StatusTag,
  VolunteerNavigation,
  dateTime,
  hoursLabel,
  toInstant,
  toLocalInput,
  usePermission,
  useVolunteerWrite,
} from './shared';

function useActiveVolunteers(enabled: boolean) {
  const { me } = useSession();
  return useQuery({
    queryKey: ['volunteer-options', me.activeOrganizationId],
    queryFn: () => allPages<VolunteerSummary>('/volunteers?status=active'),
    enabled,
  });
}
const refresh = () => void queryClient.invalidateQueries();
export function VolunteerAssignments() {
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    can = usePermission(),
    write = useVolunteerWrite(),
    language = i18n.language === 'it' ? 'it' : 'de';
  const [status, setStatus] = useState('planned'),
    [page, setPage] = useState(1),
    [editing, setEditing] = useState<VolunteerAssignment | 'new' | null>(null),
    [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['volunteer-assignments', me.activeOrganizationId, status, page],
    queryFn: () =>
      api<Page<VolunteerAssignment>>(
        `/volunteer-assignments?page=${page}${status ? `&status=${status}` : ''}`,
      ),
  });
  const volunteers = useActiveVolunteers(editing === 'new');
  const events = useQuery({
    queryKey: ['volunteer-event-options', me.activeOrganizationId],
    queryFn: () =>
      allPages<EventOccurrence>(
        `/events?from=${encodeURIComponent(new Date(Date.now() - 30 * 86400000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 366 * 86400000).toISOString())}`,
      ),
    enabled: !!editing,
  });
  const responsible = useQuery({
    queryKey: ['event-organizers', me.activeOrganizationId],
    queryFn: () => api<{ items: { id: string; name: string }[] }>('/event-organizers'),
    enabled: !!editing && can('events:write'),
  });
  const act = async (run: () => Promise<unknown>) => {
    setError('');
    try {
      await run();
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <>
      <PageHeading
        title={t('volAssignments')}
        description={t('volAssignmentsIntro')}
        actions={
          can('volunteers:assign') && (
            <Button onClick={() => setEditing('new')}>
              <Plus size={17} />
              {t('volPlanAssignment')}
            </Button>
          )
        }
      />
      <VolunteerNavigation />
      {error && <Notice error>{error}</Notice>}
      <section className="panel">
        <div className="toolbar">
          <Field label={t('status')}>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t('all')}</option>
              {(['planned', 'completed', 'cancelled'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`assignment_${s}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <QueryView query={query}>
          {(data) =>
            data.items.length ? (
              <>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('volVolunteer')}</th>
                        <th>{t('volTask')}</th>
                        <th>{t('volPlannedTime')}</th>
                        <th>{t('volRole')}</th>
                        <th>{t('volInsuranceStatus')}</th>
                        <th>{t('status')}</th>
                        <th>{t('actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((a) => (
                        <tr key={a.id}>
                          <td>
                            <strong>{a.volunteerName}</strong>
                            <small className="cell-note">
                              {a.eventTitleI18n?.[language] ?? a.project}
                            </small>
                          </td>
                          <td>
                            {a.task}
                            {a.responsibleName && (
                              <small className="cell-note">
                                {t('volResponsible')}: {a.responsibleName}
                              </small>
                            )}
                          </td>
                          <td>
                            {dateTime(a.plannedStart, i18n.language)} –{' '}
                            {dateTime(a.plannedEnd, i18n.language).split(' ').at(-1)}
                          </td>
                          <td>{t(`assignmentRole_${a.role}`)}</td>
                          <td>
                            <CoverageBadge status={a.coverageStatus} />
                          </td>
                          <td>
                            <StatusTag prefix="assignment" value={a.status} />
                          </td>
                          <td className="row-actions">
                            {can('volunteers:assign') && a.status === 'planned' && (
                              <>
                                <Button variant="ghost" onClick={() => setEditing(a)}>
                                  {t('edit')}
                                </Button>
                                <Button
                                  variant="ghost"
                                  onClick={() =>
                                    void act(() =>
                                      write(
                                        `/volunteer-assignments/${a.id}`,
                                        { version: a.version, status: 'completed' },
                                        'PATCH',
                                      ),
                                    )
                                  }
                                >
                                  {t('volMarkCompleted')}
                                </Button>
                                <Button
                                  variant="ghost"
                                  onClick={() =>
                                    void act(() =>
                                      write(
                                        `/volunteer-assignments/${a.id}`,
                                        { version: a.version, status: 'cancelled' },
                                        'PATCH',
                                      ),
                                    )
                                  }
                                >
                                  {t('cancel')}
                                </Button>
                              </>
                            )}
                            {can('volunteers:assign') &&
                              a.eventOccurrenceId &&
                              a.status !== 'cancelled' && (
                                <Button
                                  variant="ghost"
                                  onClick={() =>
                                    void act(() =>
                                      write(`/volunteer-assignments/${a.id}/attendance-draft`, {}),
                                    )
                                  }
                                >
                                  {t('volDraftFromAttendance')}
                                </Button>
                              )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={page}
                  pageSize={data.pageSize}
                  total={data.total}
                  onChange={setPage}
                />
              </>
            ) : (
              <Empty description={t('volAssignmentsEmpty')} />
            )
          }
        </QueryView>
        <p className="form-hint">{t('volAttendanceNotHours')}</p>
      </section>
      {editing && (
        <FormModal
          wide
          title={t(editing === 'new' ? 'volPlanAssignment' : 'edit')}
          onClose={() => setEditing(null)}
          fields={[
            ...(editing === 'new'
              ? [
                  {
                    name: 'engagementId',
                    label: t('volVolunteer'),
                    type: 'select' as const,
                    required: true,
                    options: [
                      { value: '', label: t('choosePerson') },
                      ...(volunteers.data ?? []).map((v) => ({
                        value: v.id,
                        label: `${v.firstName} ${v.lastName} · ${t(`vol_${v.volunteerType}`)}`,
                      })),
                    ],
                  },
                  {
                    name: 'eventOccurrenceId',
                    label: t('volEvent'),
                    type: 'select' as const,
                    options: [
                      {
                        value: '',
                        label: can('volunteers:write') ? t('volNoEvent') : t('volChooseEvent'),
                      },
                      ...(events.data ?? [])
                        .filter((e) => e.status !== 'cancelled')
                        .map((e) => ({
                          value: e.id,
                          label: `${e.titleI18n[language]} · ${formatDate(e.startAt, i18n.language)}`,
                        })),
                    ],
                  },
                ]
              : []),
            {
              name: 'role',
              label: t('volRole'),
              type: 'select',
              defaultValue: editing === 'new' ? 'helper' : editing.role,
              options: [
                { value: 'helper', label: t('assignmentRole_helper') },
                { value: 'lead', label: t('assignmentRole_lead') },
              ],
            },
            {
              name: 'task',
              label: t('volTask'),
              required: true,
              defaultValue: editing === 'new' ? '' : editing.task,
            },
            {
              name: 'plannedStart',
              label: t('volPlannedStart'),
              type: 'datetime-local',
              required: true,
              defaultValue: editing === 'new' ? '' : toLocalInput(editing.plannedStart),
            },
            {
              name: 'plannedEnd',
              label: t('volPlannedEnd'),
              type: 'datetime-local',
              required: true,
              defaultValue: editing === 'new' ? '' : toLocalInput(editing.plannedEnd),
            },
            {
              name: 'responsibleUserId',
              label: t('volResponsible'),
              type: 'select',
              defaultValue: editing === 'new' ? '' : (editing.responsibleUserId ?? ''),
              options: [
                { value: '', label: '—' },
                ...(responsible.data?.items ?? []).map((u) => ({ value: u.id, label: u.name })),
              ],
            },
            {
              name: 'project',
              label: t('eventProject'),
              defaultValue: editing === 'new' ? '' : editing.project,
            },
          ]}
          onSubmit={async (v) => {
            const common = {
              role: v.role,
              task: v.task,
              plannedStart: toInstant(String(v.plannedStart)),
              plannedEnd: toInstant(String(v.plannedEnd)),
              responsibleUserId: v.responsibleUserId || null,
              project: v.project,
            };
            if (editing === 'new')
              await write('/volunteer-assignments', {
                ...common,
                engagementId: v.engagementId,
                eventOccurrenceId: v.eventOccurrenceId || null,
              });
            else
              await write(
                `/volunteer-assignments/${editing.id}`,
                { ...common, version: editing.version },
                'PATCH',
              );
            refresh();
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
type TimePage = Page<VolunteerTimeEntry> & {
  totals: { confirmedMinutes: number; pendingMinutes: number; entries: number };
};
export function VolunteerHours() {
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    can = usePermission(),
    write = useVolunteerWrite(),
    language = i18n.language === 'it' ? 'it' : 'de';
  const [status, setStatus] = useState(''),
    [engagement, setEngagement] = useState(''),
    [page, setPage] = useState(1),
    [dialog, setDialog] = useState<
      { kind: 'new' } | { kind: 'correct' | 'reject' | 'history'; entry: VolunteerTimeEntry } | null
    >(null),
    [error, setError] = useState('');
  const volunteers = useActiveVolunteers(true);
  const filters = `${status ? `&status=${status}` : ''}${engagement ? `&engagementId=${engagement}` : ''}`;
  const query = useQuery({
    queryKey: ['volunteer-time', me.activeOrganizationId, filters, page],
    queryFn: () => api<TimePage>(`/volunteer-time-entries?page=${page}${filters}`),
  });
  const decide = async (
    entry: VolunteerTimeEntry,
    decision: 'submit' | 'confirm' | 'reject',
    reason = '',
  ) => {
    setError('');
    try {
      await write(`/volunteer-time-entries/${entry.id}/decision`, {
        version: entry.version,
        decision,
        reason,
      });
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const download = (format: 'csv' | 'pdf') =>
    void downloadPrivateFile(
      `/volunteer-time-entries/export?format=${format}&language=${language}${filters}`,
      `volunteer-hours.${format}`,
    ).catch((e) => setError(errorMessage(e)));
  return (
    <>
      <PageHeading
        title={t('volHours')}
        description={t('volHoursIntro')}
        actions={
          <>
            <Button variant="secondary" onClick={() => download('csv')}>
              <Download size={16} />
              CSV
            </Button>
            <Button variant="secondary" onClick={() => download('pdf')}>
              <Download size={16} />
              PDF
            </Button>
            {can('volunteers:assign') && (
              <Button onClick={() => setDialog({ kind: 'new' })}>
                <Plus size={17} />
                {t('volRecordTime')}
              </Button>
            )}
          </>
        }
      />
      <VolunteerNavigation />
      {error && <Notice error>{error}</Notice>}
      <section className="panel">
        <div className="toolbar event-filters">
          <Field label={t('volVolunteer')}>
            <select
              value={engagement}
              onChange={(e) => {
                setEngagement(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t('all')}</option>
              {volunteers.data?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.firstName} {v.lastName}
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
              <option value="">{t('all')}</option>
              {(['draft', 'submitted', 'confirmed', 'rejected'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`time_${s}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <QueryView query={query}>
          {(data) => (
            <>
              <div className="totals-row" aria-live="polite">
                <span>
                  {t('volConfirmedHours')}:{' '}
                  <strong>{hoursLabel(data.totals.confirmedMinutes)}</strong>
                </span>
                <span>
                  {t('volPendingHours')}: <strong>{hoursLabel(data.totals.pendingMinutes)}</strong>
                </span>
              </div>
              {data.items.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('volVolunteer')}</th>
                        <th>{t('volActualTime')}</th>
                        <th>{t('volBreak')}</th>
                        <th>{t('volNetHours')}</th>
                        <th>{t('status')}</th>
                        <th>{t('actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((e) => (
                        <tr key={e.id}>
                          <td>
                            <strong>{e.volunteerName}</strong>
                            <small className="cell-note">
                              {e.eventTitleI18n?.[language] ?? e.project ?? ''}
                              {e.source === 'attendance' ? ` · ${t('volFromAttendance')}` : ''}
                            </small>
                          </td>
                          <td>
                            {dateTime(e.actualStart, i18n.language)} –{' '}
                            {dateTime(e.actualEnd, i18n.language).split(' ').at(-1)}
                          </td>
                          <td className="numeric">{e.breakMinutes}′</td>
                          <td className="numeric">{hoursLabel(e.minutes)}</td>
                          <td>
                            <StatusTag prefix="time" value={e.status} />
                            {e.confirmedByName && (
                              <small className="cell-note">{e.confirmedByName}</small>
                            )}
                          </td>
                          <td className="row-actions">
                            {e.status === 'draft' && can('volunteers:assign') && (
                              <Button variant="ghost" onClick={() => void decide(e, 'submit')}>
                                {t('volSubmit')}
                              </Button>
                            )}
                            {['draft', 'submitted'].includes(e.status) &&
                              can('volunteer_hours:confirm') && (
                                <>
                                  <Button variant="ghost" onClick={() => void decide(e, 'confirm')}>
                                    {t('volConfirm')}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    onClick={() => setDialog({ kind: 'reject', entry: e })}
                                  >
                                    {t('volReject')}
                                  </Button>
                                </>
                              )}
                            {e.status !== 'rejected' &&
                              can(
                                e.status === 'confirmed'
                                  ? 'volunteer_hours:confirm'
                                  : 'volunteers:assign',
                              ) && (
                                <Button
                                  variant="ghost"
                                  onClick={() => setDialog({ kind: 'correct', entry: e })}
                                >
                                  {t('volCorrect')}
                                </Button>
                              )}
                            <Button
                              variant="ghost"
                              onClick={async () => {
                                const entry = await api<VolunteerTimeEntry>(
                                  `/volunteer-time-entries/${e.id}`,
                                );
                                setDialog({ kind: 'history', entry });
                              }}
                            >
                              {t('volHistory')}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty description={t('volHoursEmpty')} />
              )}
              <Pagination
                page={page}
                pageSize={data.pageSize}
                total={data.total}
                onChange={setPage}
              />
            </>
          )}
        </QueryView>
      </section>
      {dialog?.kind === 'new' && (
        <FormModal
          wide
          title={t('volRecordTime')}
          onClose={() => setDialog(null)}
          fields={[
            {
              name: 'engagementId',
              label: t('volVolunteer'),
              type: 'select',
              required: true,
              options: [
                { value: '', label: t('choosePerson') },
                ...(volunteers.data ?? []).map((v) => ({
                  value: v.id,
                  label: `${v.firstName} ${v.lastName}`,
                })),
              ],
            },
            {
              name: 'actualStart',
              label: t('volActualStart'),
              type: 'datetime-local',
              required: true,
            },
            { name: 'actualEnd', label: t('volActualEnd'), type: 'datetime-local', required: true },
            {
              name: 'breakMinutes',
              label: t('volBreakMinutes'),
              type: 'number',
              min: 0,
              defaultValue: 0,
            },
            { name: 'description', label: t('volTask') },
            { name: 'project', label: t('eventProject') },
            { name: 'submit', label: t('volSubmitNow'), type: 'checkbox', defaultValue: true },
          ]}
          onSubmit={async (v) => {
            await write('/volunteer-time-entries', {
              engagementId: v.engagementId,
              actualStart: toInstant(String(v.actualStart)),
              actualEnd: toInstant(String(v.actualEnd)),
              breakMinutes: Number(v.breakMinutes || 0),
              description: v.description,
              project: v.project,
              submit: v.submit,
            });
            refresh();
            setDialog(null);
          }}
        >
          <p className="form-hint">{t('volAttendanceNotHours')}</p>
        </FormModal>
      )}
      {dialog?.kind === 'correct' && (
        <FormModal
          title={t('volCorrect')}
          onClose={() => setDialog(null)}
          fields={[
            {
              name: 'actualStart',
              label: t('volActualStart'),
              type: 'datetime-local',
              required: true,
              defaultValue: toLocalInput(dialog.entry.actualStart),
            },
            {
              name: 'actualEnd',
              label: t('volActualEnd'),
              type: 'datetime-local',
              required: true,
              defaultValue: toLocalInput(dialog.entry.actualEnd),
            },
            {
              name: 'breakMinutes',
              label: t('volBreakMinutes'),
              type: 'number',
              min: 0,
              defaultValue: dialog.entry.breakMinutes,
            },
            { name: 'reason', label: t('volCorrectionReason'), required: true },
          ]}
          onSubmit={async (v) => {
            await write(`/volunteer-time-entries/${dialog.entry.id}/correction`, {
              version: dialog.entry.version,
              actualStart: toInstant(String(v.actualStart)),
              actualEnd: toInstant(String(v.actualEnd)),
              breakMinutes: Number(v.breakMinutes || 0),
              reason: v.reason,
            });
            refresh();
            setDialog(null);
          }}
        >
          {dialog.entry.status === 'confirmed' && <Notice>{t('volCorrectionReconfirm')}</Notice>}
        </FormModal>
      )}
      {dialog?.kind === 'reject' && (
        <FormModal
          title={t('volReject')}
          onClose={() => setDialog(null)}
          fields={[{ name: 'reason', label: t('volRejectReason'), required: true }]}
          onSubmit={async (v) => {
            await write(`/volunteer-time-entries/${dialog.entry.id}/decision`, {
              version: dialog.entry.version,
              decision: 'reject',
              reason: v.reason,
            });
            refresh();
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'history' && (
        <Modal title={t('volHistory')} onClose={() => setDialog(null)}>
          <ol className="history-list">
            {dialog.entry.history.map((h) => (
              <li key={h.version}>
                <strong>{t(`volTimeAction_${h.action}`)}</strong> ·{' '}
                {dateTime(h.createdAt, i18n.language)} · {h.actorName ?? '—'}
                {h.reason && <small>{h.reason}</small>}
                <small>
                  {t('volPrevious')}: {hoursLabel(Number(h.previous.minutes ?? 0))} ·{' '}
                  {t(`time_${String(h.previous.status)}`)}
                </small>
              </li>
            ))}
          </ol>
          {!dialog.entry.history.length && <p className="muted">{t('volNoHistory')}</p>}
        </Modal>
      )}
    </>
  );
}
