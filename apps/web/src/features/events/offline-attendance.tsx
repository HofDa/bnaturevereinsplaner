import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { AttendanceSnapshot, AttendanceOperation, Me } from '@bnature/contracts';
import {
  Button,
  Field,
  Loading,
  Notice,
  PageHeading,
  SearchInput,
  formatDate,
} from '../../components/ui';
import { api, errorMessage, ApiError } from '../../lib/api';
import {
  preparedAttendance,
  queuedAttendance,
  queueAttendanceChange,
  resolveAttendanceConflict,
  removePreparedEvent,
  purgeAttendance,
  synchronizeAttendance,
  bindAttendanceUser,
  type QueuedAttendance,
} from '../../lib/attendance-offline';
export function AttendanceSyncManager({ me }: { me: Me }) {
  useEffect(() => {
    let active = true,
      timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      void bindAttendanceUser(me)
        .then(() => {
          if (active) return synchronizeAttendance();
        })
        .catch(() => undefined);
    };
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(sync, 500);
    };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('focus', sync);
    window.addEventListener('bnature-attendance-changed', changed);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener('online', sync);
      window.removeEventListener('focus', sync);
      window.removeEventListener('bnature-attendance-changed', changed);
    };
  }, [me]);
  return null;
}
export function usePreparedAttendance() {
  const [copies, setCopies] = useState<AttendanceSnapshot[]>([]),
    [queue, setQueue] = useState<QueuedAttendance[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const load = () => {
      void Promise.all([preparedAttendance(), queuedAttendance()])
        .then(([next, outbox]) => {
          if (alive) {
            setCopies(next);
            setQueue(outbox);
            setError('');
          }
        })
        .catch(() => {
          if (alive) setError('eventOfflineStorageError');
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    };
    const channel =
      typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('bnature-attendance');
    if (channel) channel.onmessage = load;
    load();
    const timer = setInterval(load, 60000);
    window.addEventListener('bnature-attendance-changed', load);
    window.addEventListener('focus', load);
    return () => {
      alive = false;
      clearInterval(timer);
      channel?.close();
      window.removeEventListener('bnature-attendance-changed', load);
      window.removeEventListener('focus', load);
    };
  }, []);
  return { copies, queue, loading, error };
}
const statuses: AttendanceOperation['requestedStatus'][] = [
  'present',
  'absent',
  'excused',
  'unrecorded',
];
export function OfflineAttendanceHub() {
  const { t, i18n } = useTranslation(),
    navigate = useNavigate(),
    { copies, queue, loading, error } = usePreparedAttendance();
  const [online, setOnline] = useState(navigator.onLine),
    [eventId, setEventId] = useState(new URLSearchParams(location.search).get('event') ?? ''),
    [search, setSearch] = useState(''),
    [message, setMessage] = useState(''),
    [failure, setFailure] = useState(''),
    [pending, setPending] = useState(false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  const selected = copies.find((c) => c.eventOccurrenceId === eventId) ?? copies[0],
    operations = queue.filter((q) => q.eventOccurrenceId === selected?.eventOccurrenceId),
    problems = operations.filter((q) => q.syncStatus === 'conflict' || q.syncStatus === 'error'),
    conflictRegistrations = new Set(problems.map((q) => q.registrationId));
  async function sync() {
    setPending(true);
    setFailure('');
    setMessage('');
    try {
      await synchronizeAttendance();
      const remaining = await queuedAttendance(selected?.eventOccurrenceId);
      if (!remaining.length) setMessage(t('eventSyncSuccess'));
      else if (remaining.some((q) => q.syncStatus === 'auth_required'))
        setFailure(t('eventSyncLoginRequired'));
    } catch {
      setFailure(t('eventOfflineStorageError'));
    } finally {
      setPending(false);
    }
  }
  useEffect(() => {
    if (!online) return;
    const run = () => void synchronizeAttendance().catch(() => undefined);
    let timer: ReturnType<typeof setTimeout>;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(run, 500);
    };
    run();
    window.addEventListener('bnature-attendance-changed', changed);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('bnature-attendance-changed', changed);
    };
  }, [online]);
  const selectedOrganizationId = selected?.organizationId;
  // Verify stored ownership on online entry without inventing an offline session.
  useEffect(() => {
    if (!online || !selectedOrganizationId) return;
    void api<Me>('/me', { headers: { 'X-Organization-Id': selectedOrganizationId } })
      .then(bindAttendanceUser)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 403) void purgeAttendance();
      });
  }, [online, selectedOrganizationId]);
  return (
    <div className="offline-attendance-page">
      <PageHeading
        title={t('eventOfflineAttendance')}
        description={t('eventOfflineAccessNotice')}
        actions={
          <Link className="button button-secondary" to="/events">
            {t('events')}
          </Link>
        }
      />
      <Notice>
        {t(online ? 'eventOnline' : 'eventOffline')} ·{' '}
        {t('eventPendingCount', { count: operations.length })}
      </Notice>
      {(failure || error) && <Notice error>{failure || t(error)}</Notice>}
      {message && <Notice>{message}</Notice>}
      {loading ? (
        <Loading />
      ) : !selected ? (
        <p>{t('eventNoPreparedCopies')}</p>
      ) : (
        <>
          <div className="toolbar">
            <Field label={t('events')}>
              <select
                value={selected.eventOccurrenceId}
                onChange={(e) => {
                  setEventId(e.target.value);
                  setSearch('');
                  navigate(`/offline-attendance?event=${e.target.value}`, { replace: true });
                }}
              >
                {copies.map((copy) => (
                  <option key={copy.eventOccurrenceId} value={copy.eventOccurrenceId}>
                    {copy.titleI18n[i18n.language === 'it' ? 'it' : 'de']}
                  </option>
                ))}
              </select>
            </Field>
            <Button disabled={!online || pending} onClick={() => void sync()}>
              {t('eventSyncNow')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void removePreparedEvent(selected.eventOccurrenceId).catch(() =>
                  setFailure(t('eventOfflineStorageError')),
                );
              }}
            >
              {t('eventRemoveOfflineCopy')}
            </Button>
          </div>
          <h2>{selected.titleI18n[i18n.language === 'it' ? 'it' : 'de']}</h2>
          <p>
            {formatDate(selected.startAt, i18n.language)} ·{' '}
            {t('eventOfflineExpires', { date: formatDate(selected.expiresAt, i18n.language) })}
          </p>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('eventSearchParticipants')}
          />
          <ul className="event-checkin-list">
            {selected.participants
              .filter((p) => p.displayName.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
              .map((participant) => (
                <li key={participant.registrationId}>
                  <div>
                    <strong>{participant.displayName}</strong>
                    <span className="badge">{t(`eventAttendance_${participant.status}`)}</span>
                  </div>
                  <div className="event-checkin-actions">
                    {statuses.map((status) => (
                      <Button
                        key={status}
                        variant={participant.status === status ? 'primary' : 'secondary'}
                        aria-pressed={participant.status === status}
                        disabled={
                          conflictRegistrations.has(participant.registrationId) ||
                          participant.registrationStatus !== 'registered'
                        }
                        onClick={async () => {
                          setFailure('');
                          setMessage('');
                          try {
                            await queueAttendanceChange(
                              selected.eventOccurrenceId,
                              participant.registrationId,
                              status,
                            );
                            if (online) await synchronizeAttendance();
                          } catch (e) {
                            setFailure(
                              e instanceof Error
                                ? t(e.message, { defaultValue: t('eventOfflineStorageError') })
                                : t('eventOfflineStorageError'),
                            );
                          }
                        }}
                      >
                        {t(`eventAttendance_${status}`)}
                      </Button>
                    ))}
                  </div>
                </li>
              ))}
          </ul>
          {problems.map((problem) => (
            <section className="panel event-conflict" key={problem.operationId}>
              <h3>
                {t(problem.syncStatus === 'conflict' ? 'eventConflict' : 'eventSyncRejected')}
              </h3>
              <p>
                {
                  selected.participants.find((p) => p.registrationId === problem.registrationId)
                    ?.displayName
                }
              </p>
              <p>
                {t('eventLocalValue')}:{' '}
                {t(
                  `eventAttendance_${selected.participants.find((p) => p.registrationId === problem.registrationId)?.status ?? problem.requestedStatus}`,
                )}{' '}
                · {t('eventServerValue')}:{' '}
                {problem.serverRecord
                  ? t(`eventAttendance_${problem.serverRecord.status}`)
                  : t('eventUnavailable')}
              </p>
              {problem.serverRecord ? (
                <div className="toolbar">
                  <Button
                    disabled={!online || pending}
                    onClick={async () => {
                      try {
                        await resolveAttendanceConflict(problem.operationId, 'local');
                        await sync();
                      } catch (e) {
                        setFailure(errorMessage(e));
                      }
                    }}
                  >
                    {t('eventUseLocal')}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      void resolveAttendanceConflict(problem.operationId, 'server').catch(() =>
                        setFailure(t('eventOfflineStorageError')),
                      );
                    }}
                  >
                    {t('eventUseServer')}
                  </Button>
                </div>
              ) : (
                <p>{t('eventSyncReview')}</p>
              )}
            </section>
          ))}
          {operations.some((op) => op.syncStatus === 'auth_required') && (
            <Notice error>
              <p>{t('eventSyncLoginRequired')}</p>
              <Link className="button button-secondary" to="/login">
                {t('eventLoginAction')}
              </Link>
            </Notice>
          )}
        </>
      )}
      <section>
        <p>{t('eventOfflinePrivacy')}</p>
        <Button
          variant="secondary"
          onClick={() => {
            void purgeAttendance().catch(() => setFailure(t('eventOfflineStorageError')));
          }}
        >
          {t('eventClearOffline')}
        </Button>
      </section>
    </div>
  );
}
