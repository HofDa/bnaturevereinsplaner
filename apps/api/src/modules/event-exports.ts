import { eventLocal, type EventOccurrence } from '@bnature/contracts';
import type { Database } from '@bnature/db';
import { HttpError, type Access } from '../middleware/access';
import { getEvent, listEvents } from './events';
import { attendanceList } from './event-attendance';
import { renderPdf, organizationName } from './finance/pdf';
import { readSnapshot } from './finance/operations';
const escapeIcs = (text: string) =>
  text
    .replaceAll('\\', '\\\\')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .replaceAll('\n', '\\n')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,');
const stamp = (value: string) =>
  new Date(value)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
// RFC 5545 limits physical content lines to 75 octets; split only between Unicode code points.
export function foldIcs(line: string) {
  const result: string[] = [];
  let current = '';
  for (const char of line) {
    if (Buffer.byteLength(current + char, 'utf8') > 75) {
      result.push(current);
      current = ' ';
    }
    current += char;
  }
  result.push(current);
  return result.join('\r\n');
}
export function eventsIcs(events: EventOccurrence[], language: 'de' | 'it') {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//b*nature//Events//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id}@bnature`,
      `DTSTAMP:${stamp(event.updatedAt)}`,
      `SEQUENCE:${event.version}`,
      `DTSTART:${stamp(event.startAt)}`,
      `DTEND:${stamp(event.endAt)}`,
      `SUMMARY:${escapeIcs(event.titleI18n[language])}`,
      `DESCRIPTION:${escapeIcs(event.descriptionI18n[language])}`,
      `LOCATION:${escapeIcs(event.location)}`,
      `STATUS:${event.status === 'cancelled' ? 'CANCELLED' : event.status === 'draft' ? 'TENTATIVE' : 'CONFIRMED'}`,
      `X-BNATURE-TIMEZONE:${escapeIcs(event.timezone)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcs).join('\r\n') + '\r\n';
}
export async function calendarExport(
  db: Database,
  a: Access,
  q: Parameters<typeof listEvents>[2],
  language: 'de' | 'it',
) {
  return readSnapshot(db, async (tx) => {
    const items: EventOccurrence[] = [];
    let page = 1;
    while (true) {
      const rows = await listEvents(tx, a, { ...q, page, pageSize: 100 });
      items.push(...rows.items);
      if (items.length >= rows.total) break;
      if (++page > 50)
        throw new HttpError(
          422,
          'EXPORT_TOO_LARGE',
          'Calendar export requires a narrower date range',
        );
    }
    return eventsIcs(items, language);
  });
}
const labels = {
  de: {
    title: 'Anwesenheitsliste',
    name: 'Name',
    registration: 'Anmeldung',
    status: 'Anwesenheit',
    checked: 'Check-in',
    version: 'Version',
    recorded: 'Erfasst durch',
    unrecorded: 'Noch nicht erfasst',
    present: 'Anwesend',
    absent: 'Abwesend',
    excused: 'Entschuldigt',
    registered: 'Angemeldet',
    waitlisted: 'Warteliste',
    cancelled: 'Abgemeldet',
  },
  it: {
    title: 'Elenco presenze',
    name: 'Nome',
    registration: 'Iscrizione',
    status: 'Presenza',
    checked: 'Check-in',
    version: 'Versione',
    recorded: 'Registrato da',
    unrecorded: 'Non registrata',
    present: 'Presente',
    absent: 'Assente',
    excused: 'Giustificato',
    registered: 'Iscritto',
    waitlisted: 'Lista d’attesa',
    cancelled: 'Annullata',
  },
};
const cell = (value: unknown) =>
  `"${String(value)
    .replace(/^[=+@-]/, "'$&")
    .replaceAll('"', '""')}"`;
export async function attendanceExport(
  db: Database,
  a: Access,
  id: string,
  format: 'pdf' | 'csv',
  language: 'de' | 'it',
) {
  return readSnapshot(db, async (tx) => {
    const event = await getEvent(tx, a, id),
      { items } = await attendanceList(tx, a, id),
      t = labels[language];
    const lines = items.map((row) => [
      row.displayName,
      t[row.registrationStatus],
      t[row.status],
      row.checkedInAt ?? '',
      String(row.version),
      row.recordedByName ?? '',
    ]);
    if (format === 'csv')
      return (
        '\uFEFF' +
        [[t.name, t.registration, t.status, t.checked, t.version, t.recorded], ...lines]
          .map((row) => row.map(cell).join(';'))
          .join('\r\n')
      );
    return renderPdf(
      `${t.title}: ${event.titleI18n[language]}`,
      await organizationName(tx, a.organizationId),
      [
        `${eventLocal(event.startAt, event.timezone)} · ${event.timezone}`,
        `${t.name} | ${t.registration} | ${t.status} | ${t.checked}`,
        ...lines.map((row) => row.join(' | ')),
      ],
      language,
    );
  });
}
