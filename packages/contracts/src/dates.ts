export function dateInTimeZone(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const wallClock = new Map<string, Intl.DateTimeFormat>();
/**
 * Wall-clock time (YYYY-MM-DDTHH:mm) of an instant in a time zone. Uses Intl only, so views
 * that merely display times do not need the Temporal polyfill.
 */
export function eventLocal(instant: string, timezone: string) {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) throw new RangeError('invalidInstant');
  let format = wallClock.get(timezone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    wallClock.set(timezone, format);
  }
  const part: Record<string, string> = {};
  for (const { type, value } of format.formatToParts(at)) part[type] = value;
  return `${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}`;
}
