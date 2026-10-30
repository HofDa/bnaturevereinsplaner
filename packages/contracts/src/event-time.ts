import { Temporal } from '@js-temporal/polyfill';
import { RRule, rrulestr } from 'rrule';
import type { EventInput } from './events';
export function localInstant(local: string, timezone: string) {
  const plain = Temporal.PlainDateTime.from(local);
  const zoned = plain.toZonedDateTime(timezone, { disambiguation: 'compatible' });
  // Reject a nonexistent wall time instead of silently moving an appointment through a DST gap.
  if (!zoned.toPlainDateTime().equals(plain)) throw new Error('eventNonexistentTime');
  return zoned.toInstant().toString();
}
export function eventLocal(instant: string, timezone: string) {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(timezone)
    .toPlainDateTime()
    .toString({ smallestUnit: 'minute' });
}
export function eventTimes(input: Pick<EventInput, 'startLocal' | 'endLocal' | 'timezone'>) {
  const startAt = localInstant(input.startLocal, input.timezone),
    endAt = localInstant(input.endLocal, input.timezone);
  if (Temporal.Instant.compare(startAt, endAt) >= 0) throw new Error('endBeforeStart');
  if (
    Temporal.PlainDateTime.from(input.startLocal)
      .until(Temporal.PlainDateTime.from(input.endLocal))
      .total({ unit: 'days' }) > 31
  )
    throw new Error('eventDurationLimit');
  return { startAt, endAt };
}
export function expandSeries(input: EventInput, recurrenceRule: string) {
  const rule = recurrenceRule.toUpperCase().replace(/^RRULE:/, '');
  if (!/^(?:[A-Z]+=[A-Z0-9,+-]+)(?:;[A-Z]+=[A-Z0-9,+-]+)*$/.test(rule))
    throw new Error('eventInvalidRecurrence');
  const fields = Object.fromEntries(rule.split(';').map((p) => p.split('=')));
  if (
    !['DAILY', 'WEEKLY', 'MONTHLY'].includes(fields.FREQ ?? '') ||
    (!fields.COUNT && !fields.UNTIL) ||
    (fields.COUNT && fields.UNTIL)
  )
    throw new Error('eventBoundedSeries');
  if (
    Object.keys(fields).some(
      (k) =>
        ![
          'FREQ',
          'INTERVAL',
          'COUNT',
          'UNTIL',
          'BYDAY',
          'BYMONTHDAY',
          'WKST',
          'BYMONTH',
          'BYSETPOS',
        ].includes(k),
    )
  )
    throw new Error('eventInvalidRecurrence');
  if (
    fields.COUNT &&
    (!/^\d+$/.test(fields.COUNT) || Number(fields.COUNT) > 366 || Number(fields.COUNT) < 1)
  )
    throw new Error('eventSeriesLimit');
  if (
    fields.INTERVAL &&
    (!/^\d+$/.test(fields.INTERVAL) || Number(fields.INTERVAL) < 1 || Number(fields.INTERVAL) > 365)
  )
    throw new Error('eventSeriesLimit');
  const start = Temporal.PlainDateTime.from(input.startLocal),
    end = Temporal.PlainDateTime.from(input.endLocal),
    duration = start.until(end),
    floating = (p: Temporal.PlainDateTime) =>
      new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
  if (duration.sign <= 0) throw new Error('endBeforeStart');
  const options = rrulestr(`RRULE:${rule}`).origOptions;
  if (options.until) {
    const until = options.until;
    // UTC UNTIL is an instant per RFC 5545; translate its cutoff to the series' wall-clock domain.
    const local = eventLocal(until.toISOString(), input.timezone);
    options.until = floating(Temporal.PlainDateTime.from(local));
    if (start.until(Temporal.PlainDateTime.from(local)).total({ unit: 'days' }) > 732)
      throw new Error('eventSeriesLimit');
  }
  const rr = new RRule({ ...options, dtstart: floating(start) });
  // Limit materialized dates before building occurrence rows; reject incomplete COUNT within the horizon.
  const dates = rr.between(floating(start), floating(start.add({ days: 732 })), true);
  if (
    !dates.length ||
    dates.length > 366 ||
    (fields.COUNT && dates.length !== Number(fields.COUNT))
  )
    throw new Error('eventSeriesLimit');
  return dates.map((date) => {
    const local = Temporal.PlainDateTime.from(date.toISOString().slice(0, 19));
    if (start.until(local).total({ unit: 'days' }) > 732) throw new Error('eventSeriesLimit');
    return {
      ...eventTimes({
        startLocal: local.toString(),
        endLocal: local.add(duration).toString(),
        timezone: input.timezone,
      }),
      startLocal: local.toString(),
      endLocal: local.add(duration).toString(),
    };
  });
}
