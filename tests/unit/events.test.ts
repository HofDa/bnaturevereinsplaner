import { describe, it, expect } from 'vitest';
import {
  eventInputSchema,
  eventTimes,
  eventLocal,
  expandSeries,
  attendanceOperationSchema,
} from '../../packages/contracts/src';
import { eventsIcs, foldIcs } from '../../apps/api/src/modules/event-exports';
const event = () =>
  eventInputSchema.parse({
    titleI18n: { de: 'Exkursion', it: 'Escursione' },
    categoryId: crypto.randomUUID(),
    startLocal: '2027-03-21T09:00',
    endLocal: '2027-03-21T11:00',
    timezone: 'Europe/Rome',
  });
describe('event time and recurrence', () => {
  it('keeps 09:00 local across spring and autumn DST transitions', () => {
    for (const startLocal of ['2027-03-21T09:00', '2027-10-24T09:00']) {
      const input = { ...event(), startLocal, endLocal: startLocal.replace('09:00', '11:00') },
        rows = expandSeries(input, 'FREQ=WEEKLY;COUNT=3');
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => eventLocal(r.startAt, 'Europe/Rome').endsWith('T09:00'))).toBe(true);
      expect(rows[0]!.startAt.slice(11, 16)).not.toBe(rows[1]!.startAt.slice(11, 16));
    }
  });
  it('rejects nonexistent local times and backwards ranges', () => {
    expect(() =>
      eventTimes({ ...event(), startLocal: '2027-03-28T02:30', endLocal: '2027-03-28T04:00' }),
    ).toThrow('eventNonexistentTime');
    expect(() => eventTimes({ ...event(), endLocal: '2027-03-21T08:00' })).toThrow(
      'endBeforeStart',
    );
  });
  it('bounds materialization, accepts daily/monthly and custom intervals', () => {
    for (const rule of [
      'FREQ=DAILY;COUNT=3',
      'FREQ=MONTHLY;INTERVAL=2;COUNT=3',
      'FREQ=WEEKLY;BYDAY=MO,FR;COUNT=3',
    ])
      expect(expandSeries(event(), rule)).toHaveLength(3);
    for (const rule of [
      'FREQ=DAILY',
      'FREQ=SECONDLY;COUNT=2',
      'FREQ=DAILY;COUNT=367',
      'FREQ=DAILY;INTERVAL=0;COUNT=3',
      'FREQ=MONTHLY;INTERVAL=365;COUNT=3',
    ])
      expect(() => expandSeries(event(), rule)).toThrow();
  });
  it('rejects forged actor identity in sync operations', () => {
    const op = {
      operationId: crypto.randomUUID(),
      organizationId: crypto.randomUUID(),
      eventOccurrenceId: crypto.randomUUID(),
      registrationId: crypto.randomUUID(),
      requestedStatus: 'present',
      expectedVersion: 0,
      clientCreatedAt: new Date().toISOString(),
    };
    expect(attendanceOperationSchema.safeParse(op).success).toBe(true);
    expect(
      attendanceOperationSchema.safeParse({ ...op, actorUserId: crypto.randomUUID() }).success,
    ).toBe(false);
  });
  it('folds UTF-8 ICS content at 75 octets', () => {
    for (const line of foldIcs('SUMMARY:' + 'Ökologisch 🌿'.repeat(30)).split('\r\n'))
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(eventsIcs([], 'de')).toContain('VERSION:2.0\r\n');
  });
});
