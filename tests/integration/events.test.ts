import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, sql } from 'drizzle-orm';
import { createDatabase, schema as s } from '../../packages/db/src';
import { createApp } from '../../apps/api/src/app';
import { readConfig } from '../../apps/api/src/plugins/config';
import { bootstrap } from '../../apps/api/src/services/bootstrap';
import {
  encodeDocumentMetadata,
  type EventOccurrence,
  type EventCategory,
  type EventRegistration,
  type EventSeries,
  type AttendanceResult,
  type AttendanceSnapshot,
  type DocumentDetail,
} from '../../packages/contracts/src';
const config = readConfig();
if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('/bnature_test'))
  throw new Error('Dedicated test database required');
const { db, pool } = createDatabase(config.DATABASE_URL),
  app = await createApp(db, config),
  password = 'Events-test-only-2026!';
let admin = '',
  lead = '',
  otherLead = '',
  member = '',
  treasurer = '',
  foreign = '',
  org = '',
  adminId = '',
  leadId = '',
  memberPerson = '',
  category: EventCategory,
  event: EventOccurrence,
  first: EventRegistration,
  second: EventRegistration,
  third: EventRegistration;
const headers = (cookie = admin, key?: string) => ({
  cookie,
  origin: config.APP_URL,
  ...(key ? { 'idempotency-key': key } : {}),
});
const get = (path: string, cookie = admin) =>
  app.inject({ url: `/api/v1${path}`, headers: headers(cookie) });
const send = (
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  payload: unknown,
  cookie = admin,
  key: string = crypto.randomUUID(),
) =>
  app.inject({
    method,
    url: `/api/v1${path}`,
    headers: headers(cookie, key),
    payload: payload as Record<string, unknown>,
  });
const post = (path: string, payload: unknown, cookie = admin, key?: string) =>
  send('POST', path, payload, cookie, key);
async function ok<T>(response: Awaited<ReturnType<typeof get>>, code = 200) {
  expect(response.statusCode, response.body).toBe(code);
  return response.json<T>();
}
async function login(email: string) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { origin: config.APP_URL },
    payload: { email, password },
  });
  expect(r.statusCode, r.body).toBe(200);
  const cookies = r.headers['set-cookie'];
  return (Array.isArray(cookies) ? cookies : [cookies])
    .filter(Boolean)
    .map((c) => c!.split(';')[0])
    .join('; ');
}
const payload = (patch: Record<string, unknown> = {}) => ({
  titleI18n: { de: 'Naturschutz-Workshop', it: 'Laboratorio naturalistico' },
  descriptionI18n: { de: 'Waldpflege', it: 'Cura del bosco' },
  categoryId: category.id,
  startLocal: '2027-05-01T09:00',
  endLocal: '2027-05-01T12:00',
  timezone: 'Europe/Rome',
  status: 'published',
  visibility: 'members',
  organizerId: leadId,
  capacity: 2,
  waitlistEnabled: true,
  ...patch,
});
const op = (registrationId: string, expectedVersion = 0, status = 'present') => ({
  operationId: crypto.randomUUID(),
  organizationId: org,
  eventOccurrenceId: event.id,
  registrationId,
  requestedStatus: status,
  expectedVersion,
  clientCreatedAt: new Date().toISOString(),
});
beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/db/migrations' });
  await db.execute(sql`truncate table organizations,users cascade`);
  const root = await bootstrap(db, config, {
    name: 'Events Admin',
    email: 'events-admin@example.test',
    password,
    organizationName: 'Events',
    slug: 'events',
  });
  org = root.organizationId;
  await bootstrap(db, config, {
    name: 'Foreign Admin',
    email: 'events-foreign@example.test',
    password,
    organizationName: 'Foreign',
    slug: 'events-foreign',
  });
  await app.ready();
  admin = await login('events-admin@example.test');
  foreign = await login('events-foreign@example.test');
  for (const [role, email] of [
    ['project_lead', 'lead'],
    ['project_lead', 'otherlead'],
    ['member', 'member'],
    ['treasurer', 'treasurer'],
  ] as const)
    await ok(
      await post('/users', { name: email, email: `events-${email}@example.test`, password, role }),
      201,
    );
  lead = await login('events-lead@example.test');
  otherLead = await login('events-otherlead@example.test');
  member = await login('events-member@example.test');
  treasurer = await login('events-treasurer@example.test');
  const [a] = await db.select().from(s.user).where(eq(s.user.email, 'events-admin@example.test'));
  adminId = a!.id;
  const [l] = await db.select().from(s.user).where(eq(s.user.email, 'events-lead@example.test'));
  leadId = l!.id;
  const person = await ok<{ personId: string }>(
    await post('/members', {
      firstName: 'Mira',
      lastName: 'Member',
      membershipNumber: 'EV-001',
      joinedAt: '2020-01-01',
    }),
    201,
  );
  memberPerson = person.personId;
  const [m] = await db.select().from(s.user).where(eq(s.user.email, 'events-member@example.test'));
  await db
    .insert(s.personUserLinks)
    .values({ organizationId: org, userId: m!.id, personId: memberPerson });
  const seeded = await ok<{ items: EventCategory[] }>(
    await post('/event-categories/initialize', {}),
  );
  expect(seeded.items).toHaveLength(8);
  category = seeded.items[0]!;
});
afterAll(async () => {
  await app.close();
  await pool.end();
});
describe('event management and recurrence', () => {
  it('creates, updates and authorizes event instances', async () => {
    event = await ok(await post('/events', payload()), 201);
    expect(event.startAt).toBe('2027-05-01T07:00:00.000Z');
    expect((await post('/events', payload(), member)).statusCode).toBe(403);
    expect(
      (await send('PATCH', `/events/${event.id}`, { version: 1, location: 'Brixen' }, otherLead))
        .statusCode,
    ).toBe(403);
    event = await ok(
      await send(
        'PATCH',
        `/events/${event.id}`,
        { version: event.version, location: 'Brixen', project: 'Waldpflege' },
        lead,
      ),
    );
    expect(event.location).toBe('Brixen');
    expect(
      (await send('PATCH', `/events/${event.id}`, { version: 1, location: 'Stale' }, lead))
        .statusCode,
    ).toBe(409);
    expect((await get(`/events/${event.id}`, foreign)).statusCode).toBe(404);
    const internal = await ok<EventOccurrence>(
      await post('/events', payload({ visibility: 'internal' })),
      201,
    );
    expect((await get(`/events/${internal.id}`, member)).statusCode).toBe(404);
  });
  it('materializes finite series in local time, supports exceptions and preserves past instances', async () => {
    const series = await ok<EventSeries>(
      await post('/event-series', {
        event: payload({ startLocal: '2027-03-21T09:00', endLocal: '2027-03-21T11:00' }),
        recurrenceRule: 'FREQ=WEEKLY;COUNT=3',
      }),
      201,
    );
    expect(series.occurrenceCount).toBe(3);
    let rows = (await ok<{ items: EventOccurrence[] }>(await get('/events?pageSize=100'))).items
      .filter((e) => e.seriesId === series.id)
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
    expect(rows.map((r) => r.startAt.slice(11, 16))).toEqual(['08:00', '07:00', '07:00']);
    const moved = await ok<EventOccurrence>(
      await send('PATCH', `/events/${rows[1]!.id}`, {
        version: 1,
        startLocal: '2027-03-29T10:00',
        endLocal: '2027-03-29T12:00',
      }),
    );
    expect(moved.startAt).toContain('08:00:00');
    await ok(await post(`/events/${rows[2]!.id}/cancel`, { version: 1, reason: 'Auslassen' }));
    await ok(
      await send('PATCH', `/event-series/${series.id}`, {
        version: 1,
        event: { location: 'Serienort' },
      }),
    );
    rows = (await ok<{ items: EventOccurrence[] }>(await get('/events?pageSize=100'))).items.filter(
      (e) => e.seriesId === series.id,
    );
    expect(rows.find((r) => r.id === moved.id)?.location).toBe('');
    expect(rows.find((r) => r.id === moved.id)?.startAt).toBe(moved.startAt);
    expect(rows.filter((r) => r.status === 'cancelled')).toHaveLength(1);
    const past = await ok<EventSeries>(
      await post('/event-series', {
        event: payload({ startLocal: '2025-01-01T09:00', endLocal: '2025-01-01T10:00' }),
        recurrenceRule: 'FREQ=DAILY;COUNT=2',
      }),
      201,
    );
    await ok(
      await send('PATCH', `/event-series/${past.id}`, {
        version: 1,
        event: { location: 'Future only' },
      }),
    );
    expect(
      (await ok<{ items: EventOccurrence[] }>(await get('/events?pageSize=100'))).items
        .filter((e) => e.seriesId === past.id)
        .every((e) => e.location === ''),
    ).toBe(true);
    expect(
      (await post('/event-series', { event: payload(), recurrenceRule: 'FREQ=DAILY' })).statusCode,
    ).toBe(422);
  });
});
describe('series edits and category configuration', () => {
  it('preserves registered occurrence identities during metadata edits and rejects structural replacement', async () => {
    const series = await ok<EventSeries>(
      await post('/event-series', {
        event: payload({ startLocal: '2027-08-01T09:00', endLocal: '2027-08-01T11:00' }),
        recurrenceRule: 'FREQ=WEEKLY;COUNT=2',
      }),
      201,
    );
    const occurrences = (
      await ok<{ items: EventOccurrence[] }>(await get('/events?pageSize=100'))
    ).items.filter((e) => e.seriesId === series.id);
    const occurrence = occurrences[0]!;
    const registration = await ok<EventRegistration>(
      await post(
        `/events/${occurrence.id}/registrations`,
        { guest: { firstName: 'Series', lastName: 'Identity' } },
        lead,
      ),
      201,
    );
    expect(
      (
        await send('PATCH', `/event-series/${series.id}`, {
          version: series.version,
          recurrenceRule: 'FREQ=DAILY;COUNT=2',
        })
      ).statusCode,
    ).toBe(409);
    expect((await ok<EventOccurrence>(await get(`/events/${occurrence.id}`))).startAt).toBe(
      occurrence.startAt,
    );
    await ok(
      await send('PATCH', `/event-series/${series.id}`, {
        version: series.version,
        event: {
          location: 'Neuer Treffpunkt',
          startLocal: '2027-08-01T09:00',
          endLocal: '2027-08-01T11:00',
        },
      }),
    );
    const registrations = await ok<{ items: EventRegistration[] }>(
      await get(`/events/${occurrence.id}/registrations`),
    );
    expect(registrations.items[0]!.id).toBe(registration.id);
    expect((await ok<EventOccurrence>(await get(`/events/${occurrence.id}`))).location).toBe(
      'Neuer Treffpunkt',
    );
  });
  it('cancels future series occurrences including overrides and preserves the reason', async () => {
    const temporaryCategory = await ok<EventCategory>(
      await post('/event-categories', {
        nameI18n: { de: 'Serienabsage', it: 'Annullamento serie' },
      }),
      201,
    );
    const series = await ok<EventSeries>(
      await post('/event-series', {
        event: payload({
          categoryId: temporaryCategory.id,
          startLocal: '2027-09-01T09:00',
          endLocal: '2027-09-01T11:00',
        }),
        recurrenceRule: 'FREQ=WEEKLY;COUNT=2',
      }),
      201,
    );
    const rows = (
      await ok<{ items: EventOccurrence[] }>(await get('/events?pageSize=100'))
    ).items.filter((e) => e.seriesId === series.id);
    const moved = await ok<EventOccurrence>(
      await send('PATCH', `/events/${rows[0]!.id}`, {
        version: rows[0]!.version,
        startLocal: '2027-09-02T10:00',
        endLocal: '2027-09-02T11:00',
      }),
    );
    await ok(
      await post(
        `/events/${moved.id}/registrations`,
        { guest: { firstName: 'Cancel', lastName: 'Series' } },
        lead,
      ),
      201,
    );
    await ok(
      await send('PATCH', `/event-categories/${temporaryCategory.id}`, {
        version: temporaryCategory.version,
        active: false,
      }),
    );
    const cancelled = await ok<EventSeries>(
      await send('PATCH', `/event-series/${series.id}`, {
        version: series.version,
        event: { status: 'cancelled' },
        reason: 'Unwetter',
      }),
    );
    expect(cancelled.cancellationReason).toBe('Unwetter');
    const after = (
      await ok<{ items: EventOccurrence[] }>(await get('/events?pageSize=100'))
    ).items.filter((e) => e.seriesId === series.id);
    expect(after).toHaveLength(2);
    expect(
      after.every((e) => e.status === 'cancelled' && e.cancellationReason === 'Unwetter'),
    ).toBe(true);
    expect(
      (await ok<{ items: EventRegistration[] }>(await get(`/events/${moved.id}/registrations`)))
        .items[0]!.status,
    ).toBe('cancelled');
    expect(
      (
        await send('PATCH', `/event-series/${series.id}`, {
          version: cancelled.version,
          event: { status: 'published' },
        })
      ).statusCode,
    ).toBe(409);
  });
  it('versions bilingual categories and prevents inactive categories for new events', async () => {
    const created = await ok<EventCategory>(
      await post('/event-categories', { nameI18n: { de: 'Monitoring', it: 'Monitoraggio' } }),
      201,
    );
    const updated = await ok<EventCategory>(
      await send('PATCH', `/event-categories/${created.id}`, {
        version: created.version,
        active: false,
      }),
    );
    expect(updated.version).toBe(2);
    expect((await post('/events', payload({ categoryId: created.id }))).statusCode).toBe(409);
    expect(
      (
        await post(
          '/event-categories',
          { nameI18n: { de: 'Unauthorized', it: 'Non autorizzato' } },
          lead,
        )
      ).statusCode,
    ).toBe(403);
  });
});
describe('registrations, capacity and FIFO waitlist', () => {
  it('keeps one identity per occurrence and creates guests without memberships', async () => {
    const before = (await db.select().from(s.memberships)).length;
    first = await ok(await post(`/events/${event.id}/registrations`, {}, member), 201);
    expect(first.personId).toBe(memberPerson);
    expect((await post(`/events/${event.id}/registrations`, {}, member)).statusCode).toBe(409);
    second = await ok(
      await post(
        `/events/${event.id}/registrations`,
        { guest: { firstName: 'Luca', lastName: 'Guest' } },
        lead,
      ),
      201,
    );
    expect((await db.select().from(s.memberships)).length).toBe(before);
    expect(
      (
        await send(
          'PATCH',
          `/registrations/${second.id}`,
          { version: second.version, status: 'waitlisted' },
          lead,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await ok<{ items: EventRegistration[] }>(
          await get(`/events/${event.id}/registrations`, lead),
        )
      ).items.find((r) => r.id === second.id)?.status,
    ).toBe('registered');
    expect(
      (
        await ok<{ items: EventRegistration[] }>(
          await get(`/events/${event.id}/registrations`, member),
        )
      ).items,
    ).toHaveLength(1);
    expect(
      (
        await post(
          `/events/${event.id}/registrations`,
          { guest: { firstName: 'Unauthorized', lastName: 'Guest' } },
          member,
        )
      ).statusCode,
    ).toBe(403);
  });
  it('serializes concurrent bookings for the last place and orders waitlists', async () => {
    const race = await ok<EventOccurrence>(await post('/events', payload({ capacity: 1 })), 201);
    const results = await Promise.all(
      ['A', 'B', 'C'].map((lastName) =>
        post(`/events/${race.id}/registrations`, { guest: { firstName: 'Race', lastName } }, lead),
      ),
    );
    for (const result of results) expect(result.statusCode, result.body).toBe(201);
    const rows = (
      await ok<{ items: EventRegistration[] }>(await get(`/events/${race.id}/registrations`, lead))
    ).items;
    expect(rows.filter((r) => r.status === 'registered')).toHaveLength(1);
    expect(rows.filter((r) => r.status === 'waitlisted').map((r) => r.waitlistPosition)).toEqual([
      1, 2,
    ]);
    const confirmed = rows.find((r) => r.status === 'registered')!,
      waiting = rows.filter((r) => r.status === 'waitlisted');
    await ok(
      await send('DELETE', `/registrations/${confirmed.id}`, { version: confirmed.version }, lead),
    );
    const next = (
      await ok<{ items: EventRegistration[] }>(await get(`/events/${race.id}/registrations`, lead))
    ).items;
    expect(next.find((r) => r.id === waiting[0]!.id)?.status).toBe('registered');
    expect(next.find((r) => r.id === waiting[1]!.id)?.waitlistPosition).toBe(1);
    const extra = await db
      .insert(s.persons)
      .values({ organizationId: org, firstName: 'Raw', lastName: 'Insert' })
      .returning();
    await expect(
      db.execute(
        sql`insert into event_registrations(organization_id,event_occurrence_id,person_id,status,created_by) values(${org},${race.id},${extra[0]!.id},'registered',${adminId})`,
      ),
    ).rejects.toThrow();
  });
  it('preserves capacity on edits and requires deliberate late registration', async () => {
    expect(
      (await send('PATCH', `/events/${event.id}`, { version: event.version, capacity: 1 }, lead))
        .statusCode,
    ).toBe(409);
    const late = await ok<EventOccurrence>(
      await post('/events', payload({ registrationDeadline: '2020-01-01T00:00:00Z' })),
      201,
    );
    expect((await post(`/events/${late.id}/registrations`, {}, member)).statusCode).toBe(409);
    expect(
      (
        await post(
          `/events/${late.id}/registrations`,
          { guest: { firstName: 'Late', lastName: 'Guest' }, overrideDeadline: true },
          lead,
        )
      ).statusCode,
    ).toBe(201);
  });
});
describe('late waitlist decisions', () => {
  it('keeps a late waitlist pending until an explicit, FIFO-respecting promotion', async () => {
    const late = await ok<EventOccurrence>(
      await post('/events', payload({ capacity: 1, registrationDeadline: '2020-01-01T00:00:00Z' })),
      201,
    );
    const first = await ok<EventRegistration>(
      await post(
        `/events/${late.id}/registrations`,
        { guest: { firstName: 'Late', lastName: 'First' }, overrideDeadline: true },
        lead,
      ),
      201,
    );
    const next = await ok<EventRegistration>(
      await post(
        `/events/${late.id}/registrations`,
        { guest: { firstName: 'Late', lastName: 'Next' }, overrideDeadline: true },
        lead,
      ),
      201,
    );
    await ok(await send('DELETE', `/registrations/${first.id}`, { version: first.version }, lead));
    const rows = await ok<{ items: EventRegistration[] }>(
      await get(`/events/${late.id}/registrations`, lead),
    );
    expect(rows.items.find((r) => r.id === next.id)?.status).toBe('waitlisted');
    const promoted = await ok<EventRegistration>(
      await send(
        'PATCH',
        `/registrations/${next.id}`,
        { version: next.version, status: 'registered' },
        lead,
      ),
    );
    expect(promoted.status).toBe('registered');
  });
});
describe('attendance and offline operation protocol', () => {
  it('prepares only minimal authorized offline data', async () => {
    const snapshot = await ok<AttendanceSnapshot>(
      await get(`/events/${event.id}/attendance/prepare`, lead),
    );
    expect(snapshot.participants).toHaveLength(2);
    expect(snapshot.expiresAt > snapshot.preparedAt).toBe(true);
    const serialized = JSON.stringify(snapshot);
    for (const field of ['fiscalCode', 'email', 'street', 'phone', 'personId', 'recordedBy'])
      expect(serialized).not.toContain(`"${field}"`);
    expect((await get(`/events/${event.id}/attendance/prepare`, member)).statusCode).toBe(403);
    expect((await get(`/events/${event.id}/attendance/prepare`, otherLead)).statusCode).toBe(403);
  });
  it('applies one operation once, records history and returns explicit version conflicts', async () => {
    const input = op(first.id),
      result = await ok<{ results: AttendanceResult[] }>(
        await post('/attendance/sync', { operations: [input] }, lead),
      );
    expect(result.results[0]!.status).toBe('applied');
    expect(result.results[0]!.record?.status).toBe('present');
    const repeated = await ok<{ results: AttendanceResult[] }>(
      await post('/attendance/sync', { operations: [input] }, lead),
    );
    expect(repeated.results[0]!.replayed).toBe(true);
    expect(repeated.results[0]!.record?.version).toBe(1);
    const conflict = await ok<{ results: AttendanceResult[] }>(
      await post('/attendance/sync', { operations: [op(first.id, 0, 'absent')] }, lead),
    );
    expect(conflict.results[0]!.status).toBe('conflict');
    expect(conflict.results[0]!.record?.status).toBe('present');
    const history = await ok<{ items: Array<{ version: number }> }>(
      await get(`/events/${event.id}/attendance/${first.id}/history`, lead),
    );
    expect(history.items).toHaveLength(1);
    const audits = await db
      .select()
      .from(s.auditLogs)
      .where(
        and(
          eq(s.auditLogs.organizationId, org),
          eq(s.auditLogs.entityId, first.id),
          eq(s.auditLogs.action, 'attendance'),
        ),
      );
    expect(audits).toHaveLength(1);
    const correction = await ok<AttendanceResult>(
      await send(
        'PUT',
        `/events/${event.id}/attendance/${first.id}`,
        {
          operationId: crypto.randomUUID(),
          requestedStatus: 'excused',
          expectedVersion: 1,
          clientCreatedAt: new Date().toISOString(),
        },
        lead,
      ),
    );
    expect(correction.status).toBe('applied');
    expect(correction.record?.checkedInAt).toBeNull();
    await expect(
      db.execute(
        sql`update event_attendances set status='absent',version=version+1 where registration_id=${first.id}`,
      ),
    ).rejects.toThrow();
  });
  it('confirms operations individually and does not roll back valid siblings', async () => {
    const bad = { ...op(second.id), organizationId: crypto.randomUUID() },
      good = op(second.id);
    const result = await ok<{ results: AttendanceResult[] }>(
      await post('/attendance/sync', { operations: [bad, good] }, lead),
    );
    expect(result.results.map((r) => r.status)).toEqual(['rejected', 'applied']);
    expect(
      (await post('/attendance/sync', { operations: [op(first.id)] }, member)).statusCode,
    ).toBe(403);
    expect(
      (
        await post(
          '/attendance/sync',
          { operations: [{ ...op(first.id), actorUserId: adminId }] },
          lead,
        )
      ).statusCode,
    ).toBe(422);
  });
  it('enforces fresh sessions, role revocation and organization separation', async () => {
    const input = op(first.id, 2),
      expired = lead;
    await db
      .update(s.session)
      .set({ expiresAt: new Date(0) })
      .where(eq(s.session.userId, leadId));
    expect((await post('/attendance/sync', { operations: [input] }, expired)).statusCode).toBe(401);
    lead = await login('events-lead@example.test');
    await db
      .update(s.organizationUserRoles)
      .set({ role: 'member' })
      .where(
        and(
          eq(s.organizationUserRoles.organizationId, org),
          eq(s.organizationUserRoles.userId, leadId),
        ),
      );
    expect((await post('/attendance/sync', { operations: [input] }, lead)).statusCode).toBe(403);
    await db
      .update(s.organizationUserRoles)
      .set({ role: 'project_lead' })
      .where(
        and(
          eq(s.organizationUserRoles.organizationId, org),
          eq(s.organizationUserRoles.userId, leadId),
        ),
      );
    const foreignResponse = await ok<{ results: AttendanceResult[] }>(
      await post('/attendance/sync', { operations: [input] }, foreign),
    );
    expect(foreignResponse.results[0]!.status).toBe('rejected');
  });
  it('exports real attendance data as CSV/PDF and timezone-safe ICS', async () => {
    const csv = await get(`/events/${event.id}/attendance/export?format=csv&language=it`, lead);
    expect(csv.statusCode, csv.body).toBe(200);
    expect(csv.body).toContain('Giustificato');
    expect(csv.body).toContain('Mira Member');
    const pdf = await get(`/events/${event.id}/attendance/export?format=pdf`, lead);
    expect(pdf.statusCode, pdf.body).toBe(200);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const ics = await get('/events/calendar.ics?language=it', member);
    expect(ics.statusCode, ics.body).toBe(200);
    expect(ics.body).toContain('BEGIN:VCALENDAR');
    expect(ics.body).toContain('Laboratorio naturalistico');
    expect(ics.body).not.toContain('Mira Member');
    expect((await get(`/events/${event.id}/attendance/export`, member)).statusCode).toBe(403);
  });
  it('escapes control-prefixed user names in the actual attendance CSV', async () => {
    const [before] = await db.select().from(s.user).where(eq(s.user.id, leadId));
    try {
      const update = await app.inject({
        method: 'POST',
        url: '/api/auth/update-user',
        headers: headers(lead),
        payload: { name: '\t=1+1' },
      });
      expect(update.statusCode, update.body).toBe(200);
      const csv = await get(`/events/${event.id}/attendance/export?format=csv`, lead);
      expect(csv.statusCode, csv.body).toBe(200);
      expect(csv.body).toContain('"\'\t=1+1"');
      expect(csv.body).not.toContain('"\t=1+1"');
    } finally {
      await db.update(s.user).set({ name: before!.name }).where(eq(s.user.id, leadId));
    }
  });
  it('links private event documents without exposing general archives to project leaders', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/documents`,
      headers: {
        ...headers(lead, crypto.randomUUID()),
        'content-type': 'application/pdf',
        'x-document-metadata': encodeDocumentMetadata({
          title: 'Programm',
          category: 'other',
          eventOccurrenceId: event.id,
          filename: 'programm.pdf',
        }),
      },
      payload: Buffer.from('%PDF-1.4\n%%EOF'),
    });
    const doc = await ok<DocumentDetail>(response, 201);
    expect(doc.eventOccurrenceId).toBe(event.id);
    const content = `/events/${event.id}/documents/${doc.id}/versions/${doc.latestVersion!.id}/content`;
    expect((await get(content, lead)).statusCode).toBe(200);
    expect((await get(content, otherLead)).statusCode).toBe(403);
    expect((await get(content, foreign)).statusCode).toBe(404);
    expect((await get(content, member)).statusCode).toBe(403);
    expect((await get(`/documents/${doc.id}`, treasurer)).statusCode).toBe(200);
    expect((await get(`/documents?eventOccurrenceId=${event.id}`, treasurer)).statusCode).toBe(200);
    expect((await get(content, treasurer)).statusCode).toBe(403);
    const general = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: {
        ...headers(admin, crypto.randomUUID()),
        'content-type': 'application/pdf',
        'x-document-metadata': encodeDocumentMetadata({
          title: 'Allgemeines',
          category: 'other',
          filename: 'general.pdf',
        }),
      },
      payload: Buffer.from('%PDF-1.4\n%%EOF'),
    });
    const privateDoc = await ok<DocumentDetail>(general, 201);
    expect((await get(`/documents/${privateDoc.id}`, lead)).statusCode).toBe(403);
  });
  it('cancels events with registrations atomically without financial entries', async () => {
    third = await ok(
      await post(
        `/events/${event.id}/registrations`,
        { guest: { firstName: 'Wait', lastName: 'List' } },
        lead,
      ),
      201,
    );
    expect(third.status).toBe('waitlisted');
    await ok(
      await post(`/events/${event.id}/cancel`, { version: event.version, reason: 'Wetter' }, lead),
    );
    const rows = (
      await ok<{ items: EventRegistration[] }>(await get(`/events/${event.id}/registrations`, lead))
    ).items;
    expect(rows.every((r) => r.status === 'cancelled')).toBe(true);
    const sync = await ok<{ results: AttendanceResult[] }>(
      await post('/attendance/sync', { operations: [op(first.id, 2)] }, lead),
    );
    expect(sync.results[0]!.status).toBe('rejected');
    expect(await db.select().from(s.cashbookEntries)).toEqual([]);
    expect(await db.select().from(s.payments)).toEqual([]);
  });
  it('keeps the full waitlist rank when members can only see their own registration', async () => {
    const ranked = await ok<EventOccurrence>(
      await post('/events', payload({ capacity: 1 }), lead),
      201,
    );
    await ok(
      await post(
        `/events/${ranked.id}/registrations`,
        { guest: { firstName: 'First', lastName: 'Seat' } },
        lead,
      ),
      201,
    );
    await ok(
      await post(
        `/events/${ranked.id}/registrations`,
        { guest: { firstName: 'First', lastName: 'Waiting' } },
        lead,
      ),
      201,
    );
    const own = await ok<EventRegistration>(
      await post(`/events/${ranked.id}/registrations`, {}, member),
      201,
    );
    expect(own.waitlistPosition).toBe(2);
    const visible = await ok<{ items: EventRegistration[] }>(
      await get(`/events/${ranked.id}/registrations`, member),
    );
    expect(visible.items).toHaveLength(1);
    expect(visible.items[0]!.waitlistPosition).toBe(2);
  });
});
