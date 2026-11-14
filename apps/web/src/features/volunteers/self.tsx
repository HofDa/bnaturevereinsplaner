import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Clock3, Plus } from 'lucide-react';
import type { OwnVolunteering } from '@bnature/contracts';
import { api, errorMessage, queryClient } from '../../lib/api';
import { useSession } from '../../app/session';
import { Button, Field, Modal, Notice } from '../../components/ui';
import { useFinancialWrite } from '../finance/client';
import { toInstant } from './shared';

const hours = (minutes: number, language: string) =>
  (minutes / 60).toLocaleString(language, { maximumFractionDigits: 1 });

/** Profile panel for volunteers: own assignments and hours, plus reporting new hours. */
export function OwnVolunteeringPanel() {
  const { t, i18n } = useTranslation();
  const { me } = useSession();
  const [reporting, setReporting] = useState(false);
  const [notice, setNotice] = useState('');
  const query = useQuery({
    queryKey: ['own-volunteering', me.activeOrganizationId],
    queryFn: () => api<OwnVolunteering>('/me/volunteering'),
  });
  if (!query.data?.engagements.length) return null;
  const data = query.data;
  const now = Date.now();
  const upcoming = data.assignments.filter((a) => new Date(a.plannedEnd).getTime() >= now);
  const when = (start: string, end: string) => {
    const s = new Date(start),
      e = new Date(end);
    return `${s.toLocaleDateString(i18n.language)} ${s.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}–${e.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}`;
  };
  const lang = i18n.language.startsWith('it') ? 'it' : 'de';
  return (
    <section className="panel form-panel own-volunteering">
      <header className="extras-header">
        <h2>{t('ownVolTitle')}</h2>
        <Button variant="secondary" onClick={() => setReporting(true)}>
          <Plus size={16} />
          {t('ownVolReport')}
        </Button>
      </header>
      {notice && <Notice>{notice}</Notice>}
      <div className="own-vol-stats">
        <div>
          <strong>{hours(data.confirmedMinutesThisYear, i18n.language)}</strong>
          <span>{t('ownVolConfirmed')}</span>
        </div>
        <div>
          <strong>{hours(data.pendingMinutes, i18n.language)}</strong>
          <span>{t('ownVolPending')}</span>
        </div>
      </div>
      <h3>{t('ownVolUpcoming')}</h3>
      {upcoming.length ? (
        <ul className="guardian-list">
          {upcoming.map((a) => (
            <li key={a.id}>
              <div>
                <strong>{a.eventTitle ? a.eventTitle[lang] : a.task}</strong>
                <small>
                  {a.eventTitle ? `${a.task} · ` : ''}
                  {when(a.plannedStart, a.plannedEnd)}
                </small>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t('ownVolNoUpcoming')}</p>
      )}
      <h3>{t('ownVolEntries')}</h3>
      {data.timeEntries.length ? (
        <ul className="guardian-list">
          {data.timeEntries.slice(0, 10).map((entry) => (
            <li key={entry.id}>
              <div>
                <strong>
                  <Clock3 size={14} aria-hidden="true" /> {hours(entry.minutes, i18n.language)} h ·{' '}
                  {when(entry.actualStart, entry.actualEnd)}
                </strong>
                <small>{entry.description || '—'}</small>
              </div>
              <span className={`time-status time-${entry.status}`}>
                {t(`time_${entry.status}`)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t('ownVolNoEntries')}</p>
      )}
      {reporting && (
        <ReportHours
          data={data}
          onClose={() => setReporting(false)}
          onDone={() => {
            setReporting(false);
            setNotice(t('ownVolReported'));
          }}
        />
      )}
    </section>
  );
}

function localAssignmentParts(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function ReportHours({
  data,
  onClose,
  onDone,
}: {
  data: OwnVolunteering;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const write = useFinancialWrite();
  const open = data.engagements.filter((e) => !e.endedOn);
  const engagements = open.length ? open : data.engagements;
  const lang = i18n.language.startsWith('it') ? 'it' : 'de';
  const [engagementId, setEngagementId] = useState(engagements[0]!.id);
  const [assignmentId, setAssignmentId] = useState('');
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('12:00');
  const [breakMinutes, setBreakMinutes] = useState('0');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const past = data.assignments.filter(
    (a) => a.engagementId === engagementId && new Date(a.plannedStart).getTime() <= Date.now(),
  );
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await write('/me/volunteering/time-entries', {
        engagementId,
        assignmentId: assignmentId || null,
        actualStart: toInstant(`${day}T${start}`),
        actualEnd: toInstant(`${day}T${end}`),
        breakMinutes: Number(breakMinutes) || 0,
        description,
      });
      await queryClient.invalidateQueries({ queryKey: ['own-volunteering'] });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t('ownVolReport')} onClose={() => !busy && onClose()}>
      <form className="stack-form" onSubmit={(event) => void save(event)}>
        <p className="form-help">{t('ownVolReportHelp')}</p>
        {engagements.length > 1 && (
          <Field label={t('ownVolEngagement')}>
            <select value={engagementId} onChange={(e) => setEngagementId(e.target.value)}>
              {engagements.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.activity || e.startedOn}
                </option>
              ))}
            </select>
          </Field>
        )}
        {past.length > 0 && (
          <Field label={t('ownVolAssignment')}>
            <select
              value={assignmentId}
              onChange={(e) => {
                const nextId = e.target.value;
                setAssignmentId(nextId);
                const selected = past.find((item) => item.id === nextId);
                if (selected) {
                  const startLocal = localAssignmentParts(selected.plannedStart);
                  const endLocal = localAssignmentParts(selected.plannedEnd);
                  setDay(startLocal.day);
                  setStart(startLocal.time);
                  if (endLocal.day === startLocal.day) setEnd(endLocal.time);
                  if (!description.trim()) {
                    setDescription(selected.eventTitle ? selected.eventTitle[lang] : selected.task);
                  }
                }
              }}
            >
              <option value="">{t('ownVolNoAssignment')}</option>
              {past.map((a) => (
                <option key={a.id} value={a.id}>
                  {`${a.eventTitle ? a.eventTitle[lang] : a.task} · ${new Date(a.plannedStart).toLocaleDateString(i18n.language)}`}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="form-grid">
          <Field label={t('ownVolDay')}>
            <input
              type="date"
              required
              max={new Date().toISOString().slice(0, 10)}
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </Field>
          <Field label={t('ownVolStart')}>
            <input type="time" required value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label={t('ownVolEnd')}>
            <input type="time" required value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label={t('ownVolBreak')}>
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              value={breakMinutes}
              onChange={(e) => setBreakMinutes(e.target.value)}
            />
          </Field>
        </div>
        <Field label={t('ownVolDescription')}>
          <textarea
            rows={2}
            maxLength={1000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        {error && <Notice error>{error}</Notice>}
        <footer className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button disabled={busy}>{t(busy ? 'saving' : 'ownVolSubmit')}</Button>
        </footer>
      </form>
    </Modal>
  );
}
