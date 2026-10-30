import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  eventInputSchema,
  eventLocal,
  localInstant,
  type EventOccurrence,
  type EventCategory,
  type EventSeries,
} from '@bnature/contracts';
import { Field, FormActions, Notice, Loading } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useSession } from '../../app/session';
import { useFinancialWrite as useEventWrite } from '../finance/client';
export function EventForm({
  event,
  categories,
  onDone,
  onCancel,
  defaultDate,
}: {
  event?: EventOccurrence;
  categories: EventCategory[];
  onDone: () => void;
  onCancel: () => void;
  defaultDate?: string;
}) {
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    write = useEventWrite();
  const organizers = useQuery({
    queryKey: ['event-organizers', me.activeOrganizationId],
    queryFn: () => api<{ items: Array<{ id: string; name: string }> }>('/event-organizers'),
  });
  const series = useQuery({
    queryKey: ['event-series', me.activeOrganizationId],
    queryFn: () => api<{ items: EventSeries[] }>('/event-series'),
    enabled: !!event?.seriesId,
  });
  const initial = event
    ? eventLocal(event.startAt, event.timezone)
    : (defaultDate ?? eventLocal(new Date().toISOString(), 'Europe/Rome').slice(0, 10)) + 'T09:00';
  const [scope, setScope] = useState('single'),
    [start, setStart] = useState(initial),
    [end, setEnd] = useState(
      event ? eventLocal(event.endAt, event.timezone) : initial.slice(0, 10) + 'T11:00',
    ),
    [repeat, setRepeat] = useState(''),
    [frequency, setFrequency] = useState('WEEKLY'),
    [endMode, setEndMode] = useState('count'),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  const currentSeries = series.data?.items.find((s) => s.id === event?.seriesId),
    wholeAllowed =
      !!event?.seriesId && (['admin', 'board'].includes(me.role) || event.createdBy === me.user.id);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError('');
    try {
      const timezone = String(form.get('timezone')),
        deadline = String(form.get('deadline') ?? '');
      const parsed = eventInputSchema.safeParse({
        titleI18n: { de: form.get('titleDe'), it: form.get('titleIt') },
        descriptionI18n: { de: form.get('descriptionDe'), it: form.get('descriptionIt') },
        categoryId: form.get('categoryId'),
        startLocal: start,
        endLocal: end,
        timezone,
        location: form.get('location'),
        latitude: form.get('latitude') ? Number(form.get('latitude')) : null,
        longitude: form.get('longitude') ? Number(form.get('longitude')) : null,
        organizerId: form.get('organizerId'),
        project: form.get('project'),
        status: form.get('status'),
        visibility: form.get('visibility'),
        registrationRequired: form.has('registrationRequired'),
        capacity: form.get('capacity') ? Number(form.get('capacity')) : null,
        registrationDeadline: deadline ? localInstant(deadline, timezone) : null,
        waitlistEnabled: form.has('waitlistEnabled'),
      });
      if (!parsed.success) {
        setError(t('validation'));
        return;
      }
      const data = parsed.data;
      let rule = String(form.get('advancedRule') ?? '').trim();
      if (repeat && !rule) {
        const interval = Number(form.get('interval'));
        const until = String(form.get('until') ?? '');
        rule = `FREQ=${frequency};INTERVAL=${interval};${endMode === 'count' ? `COUNT=${Number(form.get('count'))}` : `UNTIL=${localInstant(until + 'T23:59', timezone).replace(/[-:]/g, '')}`}`;
      }
      setPending(true);
      if (event && scope === 'series' && currentSeries)
        await write(
          `/event-series/${event.seriesId}`,
          {
            version: currentSeries.version,
            event: data,
            ...(rule ? { recurrenceRule: rule } : {}),
          },
          'PATCH',
        );
      else if (event)
        await write(`/events/${event.id}`, { ...data, version: event.version }, 'PATCH');
      else if (repeat) await write('/event-series', { event: data, recurrenceRule: rule });
      else await write('/events', data);
      onDone();
    } catch (e) {
      setError(
        e instanceof Error && e.message.startsWith('event') ? t(e.message) : errorMessage(e),
      );
    } finally {
      setPending(false);
    }
  }
  if (organizers.isPending) return <Loading />;
  return (
    <form onSubmit={(e) => void submit(e)}>
      {event?.seriesId && wholeAllowed && (
        <Field label={t('eventEditScope')}>
          <select
            value={scope}
            onChange={(e) => {
              const value = e.target.value;
              setScope(value);
              if (value === 'series' && currentSeries) {
                setStart(currentSeries.startLocal.slice(0, 16));
                setEnd(currentSeries.endLocal.slice(0, 16));
              } else if (event) {
                setStart(eventLocal(event.startAt, event.timezone));
                setEnd(eventLocal(event.endAt, event.timezone));
              }
            }}
          >
            <option value="single">{t('eventSingleOccurrence')}</option>
            <option value="series" disabled={!currentSeries}>
              {t('eventFutureSeries')}
            </option>
          </select>
        </Field>
      )}
      <div className="form-grid">
        <Field label={`${t('eventTitleDe')} *`}>
          <input name="titleDe" required maxLength={200} defaultValue={event?.titleI18n.de ?? ''} />
        </Field>
        <Field label={`${t('eventTitleIt')} *`}>
          <input name="titleIt" required maxLength={200} defaultValue={event?.titleI18n.it ?? ''} />
        </Field>
        <Field label={t('eventDescriptionDe')}>
          <textarea
            name="descriptionDe"
            rows={3}
            maxLength={10000}
            defaultValue={event?.descriptionI18n.de ?? ''}
          />
        </Field>
        <Field label={t('eventDescriptionIt')}>
          <textarea
            name="descriptionIt"
            rows={3}
            maxLength={10000}
            defaultValue={event?.descriptionI18n.it ?? ''}
          />
        </Field>
        <Field label={t('eventCategory')}>
          <select
            name="categoryId"
            required
            defaultValue={event?.categoryId ?? categories.find((c) => c.active)?.id}
          >
            {categories
              .filter((c) => c.active || c.id === event?.categoryId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameI18n[i18n.language === 'it' ? 'it' : 'de']}
                </option>
              ))}
          </select>
        </Field>
        <Field label={t('eventOrganizer')}>
          <select name="organizerId" required defaultValue={event?.organizerId ?? me.user.id}>
            {organizers.data?.items.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`${t('eventStart')} *`}>
          <input
            type="datetime-local"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
        <Field label={`${t('eventEnd')} *`}>
          <input
            type="datetime-local"
            required
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </Field>
        <Field label={t('eventTimezone')}>
          <input name="timezone" required defaultValue={event?.timezone ?? 'Europe/Rome'} />
        </Field>
        <Field label={t('eventLocation')}>
          <input name="location" maxLength={300} defaultValue={event?.location ?? ''} />
        </Field>
        <Field label={t('eventLatitude')}>
          <input
            name="latitude"
            type="number"
            min={-90}
            max={90}
            step="any"
            defaultValue={event?.latitude ?? ''}
          />
        </Field>
        <Field label={t('eventLongitude')}>
          <input
            name="longitude"
            type="number"
            min={-180}
            max={180}
            step="any"
            defaultValue={event?.longitude ?? ''}
          />
        </Field>
        <Field label={t('eventProject')}>
          <input name="project" maxLength={160} defaultValue={event?.project ?? ''} />
        </Field>
        <Field label={t('status')}>
          <select name="status" defaultValue={event?.status ?? 'draft'}>
            {['draft', 'published', 'completed'].map((status) => (
              <option key={status} value={status}>
                {t(`eventStatus_${status}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('eventVisibility')}>
          <select name="visibility" defaultValue={event?.visibility ?? 'members'}>
            {['internal', 'members', 'public'].map((v) => (
              <option key={v} value={v}>
                {t(`eventVisibility_${v}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('eventCapacity')} hint={t('eventCapacityHelp')}>
          <input
            name="capacity"
            type="number"
            min={1}
            max={10000}
            defaultValue={event?.capacity ?? ''}
          />
        </Field>
        <Field label={t('eventDeadline')}>
          <input
            name="deadline"
            type="datetime-local"
            defaultValue={
              event?.registrationDeadline
                ? eventLocal(event.registrationDeadline, event.timezone)
                : ''
            }
          />
        </Field>
      </div>
      <label className="checkbox-row">
        <input
          name="registrationRequired"
          type="checkbox"
          defaultChecked={event?.registrationRequired ?? true}
        />
        {t('eventRegistrationRequired')}
      </label>
      <label className="checkbox-row">
        <input
          name="waitlistEnabled"
          type="checkbox"
          defaultChecked={event?.waitlistEnabled ?? false}
        />
        {t('eventWaitlistEnabled')}
      </label>
      {!event && (
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={!!repeat}
            onChange={(e) => setRepeat(e.target.checked ? 'yes' : '')}
          />
          {t('eventRecurrence')}
        </label>
      )}
      {(repeat || scope === 'series') && (
        <fieldset>
          <legend>{t('eventRecurrence')}</legend>
          <p>{t('eventSeriesHelp')}</p>
          {scope === 'series' ? (
            <Field label="RRULE">
              <input name="advancedRule" defaultValue={currentSeries?.recurrenceRule ?? ''} />
            </Field>
          ) : (
            <>
              <div className="form-grid">
                <Field label={t('eventFrequency')}>
                  <select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                    {['DAILY', 'WEEKLY', 'MONTHLY'].map((f) => (
                      <option key={f} value={f}>
                        {t(`eventFrequency_${f}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('eventInterval')}>
                  <input name="interval" type="number" min={1} max={365} defaultValue={1} />
                </Field>
                <Field label={t('eventSeriesEnd')}>
                  <select value={endMode} onChange={(e) => setEndMode(e.target.value)}>
                    <option value="count">{t('eventSeriesCount')}</option>
                    <option value="until">{t('eventSeriesUntil')}</option>
                  </select>
                </Field>
                {endMode === 'count' ? (
                  <Field label={t('eventSeriesCount')}>
                    <input name="count" type="number" min={1} max={366} defaultValue={12} />
                  </Field>
                ) : (
                  <Field label={t('eventSeriesUntil')}>
                    <input name="until" type="date" required />
                  </Field>
                )}
                <Field label={t('eventAdvancedRule')}>
                  <input
                    name="advancedRule"
                    maxLength={500}
                    placeholder="FREQ=WEEKLY;BYDAY=MO,FR;COUNT=12"
                  />
                </Field>
              </div>
            </>
          )}
        </fieldset>
      )}
      {error && <Notice error>{error}</Notice>}
      <FormActions create={!event} pending={pending} onCancel={onCancel} />
    </form>
  );
}
