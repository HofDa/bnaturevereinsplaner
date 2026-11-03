import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CalendarCheck, Check, MapPin, Minus, Plus, Trash2, X } from 'lucide-react';
import type { ScheduleAnswer, ScheduleDetail, ScheduleSummary } from '@bnature/contracts';
import { api, errorMessage, queryClient } from '../lib/api';
import { useSession } from '../app/session';
import { useFinancialWrite } from './finance/client';
import {
  Button,
  Empty,
  ErrorState,
  Field,
  Loading,
  Modal,
  Notice,
  PageHeading,
} from '../components/ui';

const lang = (language: string) => (language.startsWith('it') ? 'it' : 'de');
export const canCreateSchedules = (permissions: string[]) =>
  permissions.includes('community:manage') || permissions.includes('events:write');
const answers: ScheduleAnswer[] = ['yes', 'maybe', 'no'];
const AnswerIcon = ({ answer }: { answer: ScheduleAnswer }) =>
  answer === 'yes' ? (
    <Check size={15} />
  ) : answer === 'maybe' ? (
    <Minus size={15} />
  ) : (
    <X size={15} />
  );

function slotLabel(startAt: string, endAt: string, language: string) {
  const start = new Date(startAt),
    end = new Date(endAt);
  const day = start.toLocaleDateString(language, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = (d: Date) => d.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
  const sameDay = start.toDateString() === end.toDateString();
  return sameDay
    ? `${day}, ${time(start)}–${time(end)}`
    : `${day}, ${time(start)} – ${end.toLocaleDateString(language, { day: 'numeric', month: 'short' })}, ${time(end)}`;
}

export function ScheduleList({ state, groupId }: { state: 'open' | 'closed'; groupId: string }) {
  const { t, i18n } = useTranslation();
  const { me } = useSession();
  const query = useQuery({
    queryKey: ['community', 'schedules', me.activeOrganizationId, state],
    queryFn: () => api<{ items: ScheduleSummary[] }>(`/community/schedules?state=${state}`),
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} />;
  const items = query.data.items.filter((x) => !groupId || x.groupId === groupId);
  if (!items.length)
    return (
      <div className="panel">
        <Empty
          title={t(state === 'open' ? 'schedEmptyOpen' : 'schedEmptyClosed')}
          description={t('schedEmptyHint')}
        />
      </div>
    );
  return (
    <div className="community-feed">
      {items.map((item) => (
        <article className="panel community-card" key={item.id}>
          <div className="community-meta">
            <span>{item.groupName ?? t('commWholeClub')}</span>
            <span>{item.authorName}</span>
            {item.location && <span>{item.location}</span>}
          </div>
          <h2>
            <Link to={`/community/schedules/${item.id}`}>
              {item.titleI18n[lang(i18n.language)]}
            </Link>
          </h2>
          <p className="community-excerpt">
            {item.finalSlot
              ? t('schedFixed', {
                  slot: slotLabel(item.finalSlot.startAt, item.finalSlot.endAt, i18n.language),
                })
              : t('schedSummary', { slots: item.slotCount, count: item.participantCount })}
          </p>
          <div className="community-card-footer">
            <span>
              {item.isOpen
                ? t(item.answered ? 'schedAnswered' : 'schedNotAnswered')
                : t('commClosed')}
            </span>
            <Link className="button button-secondary" to={`/community/schedules/${item.id}`}>
              {t(item.isOpen ? 'schedAnswer' : 'schedViewResult')}
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}

type DraftSlot = { key: string; day: string; start: string; end: string };
const nextDay = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA');
};

export function ScheduleEditor({
  defaultGroupId,
  onClose,
  onSaved,
}: {
  defaultGroupId: string | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { me } = useSession();
  const write = useFinancialWrite();
  const audiences = useQuery({
    queryKey: ['community', 'audiences', me.activeOrganizationId],
    queryFn: () => api<{ groups: { id: string; name: string }[] }>('/community/audiences'),
  });
  const tomorrow = nextDay(new Date().toLocaleDateString('en-CA'));
  const [slots, setSlots] = useState<DraftSlot[]>([
    { key: crypto.randomUUID(), day: tomorrow, start: '09:00', end: '12:00' },
    { key: crypto.randomUUID(), day: nextDay(tomorrow), start: '09:00', end: '12:00' },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = (key: string, patch: Partial<DraftSlot>) =>
    setSlots((all) => all.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const closes = String(form.get('closesAt') ?? '');
    setBusy(true);
    setError('');
    try {
      const result = await write<{ id: string }>('/community/schedules', {
        titleI18n: { de: form.get('titleDe'), it: form.get('titleIt') },
        descriptionI18n: { de: form.get('descriptionDe'), it: form.get('descriptionIt') },
        location: form.get('location'),
        groupId: form.get('groupId') || null,
        closesAt: closes ? new Date(closes).toISOString() : null,
        slots: slots.map((s) => ({
          startAt: new Date(`${s.day}T${s.start}`).toISOString(),
          endAt: new Date(`${s.day}T${s.end}`).toISOString(),
        })),
      });
      await queryClient.invalidateQueries({ queryKey: ['community', 'schedules'] });
      onSaved(result.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal wide title={t('schedCreate')} onClose={() => !busy && onClose()}>
      <form className="stack-form" onSubmit={(event) => void save(event)}>
        <p className="form-help">{t('schedCreateHelp')}</p>
        <div className="form-grid">
          <Field label={t('schedTitleDe')}>
            <input name="titleDe" required maxLength={200} />
          </Field>
          <Field label={t('schedTitleIt')}>
            <input name="titleIt" required maxLength={200} />
          </Field>
          <Field label={t('schedDescriptionDe')}>
            <textarea name="descriptionDe" rows={2} maxLength={5000} />
          </Field>
          <Field label={t('schedDescriptionIt')}>
            <textarea name="descriptionIt" rows={2} maxLength={5000} />
          </Field>
          <Field label={t('schedLocation')}>
            <input name="location" maxLength={200} />
          </Field>
          <Field label={t('commAudience')}>
            <select name="groupId" defaultValue={defaultGroupId ?? ''}>
              <option value="">{t('commWholeClub')}</option>
              {audiences.data?.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('schedDeadline')} hint={t('schedDeadlineHint')}>
            <input name="closesAt" type="datetime-local" />
          </Field>
        </div>
        <fieldset className="sched-slots">
          <legend>{t('schedSlots')}</legend>
          {slots.map((slot, i) => (
            <div className="sched-slot-row" key={slot.key}>
              <Field label={t('schedSlotDay', { n: i + 1 })}>
                <input
                  type="date"
                  required
                  value={slot.day}
                  onChange={(e) => update(slot.key, { day: e.target.value })}
                />
              </Field>
              <Field label={t('schedSlotStart', { n: i + 1 })}>
                <input
                  type="time"
                  required
                  value={slot.start}
                  onChange={(e) => update(slot.key, { start: e.target.value })}
                />
              </Field>
              <Field label={t('schedSlotEnd', { n: i + 1 })}>
                <input
                  type="time"
                  required
                  value={slot.end}
                  onChange={(e) => update(slot.key, { end: e.target.value })}
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                aria-label={t('schedSlotRemove', { n: i + 1 })}
                disabled={slots.length <= 2}
                onClick={() => setSlots((all) => all.filter((s) => s.key !== slot.key))}
              >
                <Trash2 size={16} />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            disabled={slots.length >= 30}
            onClick={() => {
              const last = slots.at(-1)!;
              setSlots((all) => [
                ...all,
                {
                  key: crypto.randomUUID(),
                  day: nextDay(last.day),
                  start: last.start,
                  end: last.end,
                },
              ]);
            }}
          >
            <Plus size={16} />
            {t('schedSlotAdd')}
          </Button>
        </fieldset>
        {error && <Notice error>{error}</Notice>}
        <footer className="form-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button disabled={busy}>{t(busy ? 'saving' : 'schedPublish')}</Button>
        </footer>
      </form>
    </Modal>
  );
}

export function ScheduleDetailPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const { me } = useSession();
  const write = useFinancialWrite();
  const key = ['community', 'schedule', me.activeOrganizationId, id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api<ScheduleDetail>(`/community/schedules/${id}`),
  });
  const [draft, setDraft] = useState<Record<string, ScheduleAnswer>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);
  const [finalSlot, setFinalSlot] = useState('');
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const data = query.data;
  const chosen = (slotId: string) =>
    draft[slotId] ?? data.slots.find((s) => s.id === slotId)?.mine ?? null;
  const changed = Object.keys(draft).length > 0;
  const label = (slot: { startAt: string; endAt: string }) =>
    slotLabel(slot.startAt, slot.endAt, i18n.language);
  async function save() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await write(
        `/community/schedules/${data.id}/answers`,
        { answers: Object.entries(draft).map(([slotId, answer]) => ({ slotId, answer })) },
        'PUT',
      );
      setDraft({});
      setNotice(t('schedSaved'));
      await queryClient.invalidateQueries({ queryKey: ['community'] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    setBusy(true);
    setError('');
    try {
      await write(`/community/schedules/${data.id}/close`, {
        version: data.version,
        finalSlotId: finalSlot || null,
      });
      setClosing(false);
      await queryClient.invalidateQueries({ queryKey: ['community'] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const max = Math.max(1, ...data.slots.map((s) => s.yes + s.maybe + s.no));
  return (
    <>
      <Link to="/community?kind=schedule" className="back-link">
        <ArrowLeft size={16} />
        {t('schedTab')}
      </Link>
      <PageHeading
        title={data.titleI18n[lang(i18n.language)]}
        description={[data.groupName ?? t('commWholeClub'), data.authorName].join(' · ')}
        actions={
          data.canManage &&
          data.isOpen && (
            <Button
              variant="secondary"
              onClick={() => {
                setFinalSlot(data.bestSlotIds[0] ?? '');
                setClosing(true);
              }}
            >
              <CalendarCheck size={16} />
              {t('schedClose')}
            </Button>
          )
        }
      />
      {data.descriptionI18n[lang(i18n.language)] && (
        <p className="sched-description">{data.descriptionI18n[lang(i18n.language)]}</p>
      )}
      <p className="sched-meta">
        {data.location && (
          <span>
            <MapPin size={15} aria-hidden="true" /> {data.location}
          </span>
        )}
        {data.closesAt && data.isOpen && (
          <span>
            {t('schedOpenUntil', { date: new Date(data.closesAt).toLocaleString(i18n.language) })}
          </span>
        )}
        <span>{t('schedParticipants', { count: data.participantCount })}</span>
      </p>
      {data.finalSlot && (
        <Notice>
          <strong>{t('schedFixed', { slot: label(data.finalSlot) })}</strong>
        </Notice>
      )}
      {!data.isOpen && !data.finalSlot && <Notice>{t('schedClosedNoSlot')}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {error && !closing && <Notice error>{error}</Notice>}
      <section className="panel sched-panel" aria-label={t('schedSlots')}>
        {data.isOpen && <p className="form-help">{t('schedAnswerHelp')}</p>}
        <ul className="sched-list">
          {data.slots.map((slot) => {
            const best = data.bestSlotIds.includes(slot.id);
            const final = data.finalSlotId === slot.id;
            return (
              <li key={slot.id} className={`${best ? 'best' : ''} ${final ? 'final' : ''}`}>
                <div className="sched-slot-head">
                  <strong>{label(slot)}</strong>
                  {final ? (
                    <span className="sched-badge">{t('schedFinal')}</span>
                  ) : (
                    best && <span className="sched-badge">{t('schedBest')}</span>
                  )}
                </div>
                <div className="sched-tally">
                  <span className="sched-bar" aria-hidden="true">
                    <i className="viz-1" style={{ width: `${(slot.yes / max) * 100}%` }} />
                    <i
                      className="sched-bar-maybe"
                      style={{ width: `${(slot.maybe / max) * 100}%` }}
                    />
                  </span>
                  <span className="sr-only">
                    {t('schedTally', { yes: slot.yes, maybe: slot.maybe, no: slot.no })}
                  </span>
                  <span aria-hidden="true">
                    <Check size={13} /> {slot.yes} · <Minus size={13} /> {slot.maybe} ·{' '}
                    <X size={13} /> {slot.no}
                  </span>
                </div>
                {data.isOpen && (
                  <fieldset className="sched-choice">
                    <legend className="sr-only">
                      {t('schedYourAnswer', { slot: label(slot) })}
                    </legend>
                    {answers.map((answer) => (
                      <label key={answer} className={`sched-option sched-${answer}`}>
                        <input
                          type="radio"
                          name={`slot-${slot.id}`}
                          value={answer}
                          checked={chosen(slot.id) === answer}
                          onChange={() => setDraft((d) => ({ ...d, [slot.id]: answer }))}
                        />
                        <AnswerIcon answer={answer} />
                        <span>{t(`sched_${answer}`)}</span>
                      </label>
                    ))}
                  </fieldset>
                )}
              </li>
            );
          })}
        </ul>
        {data.isOpen && (
          <div className="form-actions">
            {changed && (
              <Button variant="secondary" disabled={busy} onClick={() => setDraft({})}>
                {t('cancel')}
              </Button>
            )}
            <Button disabled={busy || !changed} onClick={() => void save()}>
              {t(busy ? 'saving' : 'schedSave')}
            </Button>
          </div>
        )}
      </section>
      {data.participants.length > 0 && (
        <section className="panel sched-panel">
          <h2>{t('schedWho')}</h2>
          <div className="table-scroll" tabIndex={0}>
            <table className="sched-matrix">
              <thead>
                <tr>
                  <th>{t('name')}</th>
                  {data.slots.map((slot) => (
                    <th key={slot.id} className="align-center">
                      {label(slot)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.participants.map((p) => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    {data.slots.map((slot) => {
                      const a = p.answers[slot.id];
                      return (
                        <td key={slot.id} className={`align-center ${a ? `sched-cell-${a}` : ''}`}>
                          {a ? (
                            <>
                              <AnswerIcon answer={a} />
                              <span className="sr-only">{t(`sched_${a}`)}</span>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {closing && (
        <Modal title={t('schedClose')} onClose={() => !busy && setClosing(false)}>
          <div className="stack-form">
            <p>{t('schedCloseHelp')}</p>
            <Field label={t('schedFinalSlot')}>
              <select value={finalSlot} onChange={(e) => setFinalSlot(e.target.value)}>
                <option value="">{t('schedNoFinal')}</option>
                {data.slots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {label(slot)} ({slot.yes} {t('sched_yes')})
                  </option>
                ))}
              </select>
            </Field>
            {error && <Notice error>{error}</Notice>}
            <footer className="form-actions">
              <Button variant="secondary" disabled={busy} onClick={() => setClosing(false)}>
                {t('cancel')}
              </Button>
              <Button disabled={busy} onClick={() => void close()}>
                {t('schedCloseConfirm')}
              </Button>
            </footer>
          </div>
        </Modal>
      )}
    </>
  );
}
