import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../../packages/db/src';
import { createApp } from '../../apps/api/src/app';
import { bootstrap } from '../../apps/api/src/services/bootstrap';
import { readConfig } from '../../apps/api/src/plugins/config';
import type {
  CommunityPost,
  EventCategory,
  EventOccurrence,
  FeeAssessment,
  FeePlan,
  Group,
  InventoryItem,
  Member,
  MemberDashboard,
  MemberField,
  OwnFees,
  OwnMembershipDetail,
  Page,
  Payment,
  VolunteerDetail,
} from '../../packages/contracts/src';

const config = { ...readConfig(), EMAIL_MODE: 'disabled' as const };
if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('/bnature_test'))
  throw new Error('Dedicated test database required');

const { db, pool } = createDatabase(config.DATABASE_URL);
const app = await createApp(db, config);
const password = 'Member-self-test-Password-2026!';

let orgA = '';
let orgB = '';
let adminA = '';
let adminB = '';
let memberCookie = '';
let unlinkedMemberCookie = '';
let own!: Member;
let other!: Member;
let foreignMember!: Member;
let groupMine!: Group;
let groupOther!: Group;
let ownSinglePayment!: Payment;
let pooledPayment!: Payment;
let otherSinglePayment!: Payment;
let foreignPayment!: Payment;
let openPoll!: CommunityPost;
let openScheduleId = '';
let publishedEvent!: EventOccurrence;
let draftEvent!: EventOccurrence;

const headers = (cookie: string, key?: string, org = orgA) => ({
  cookie,
  origin: config.APP_URL,
  'x-organization-id': org,
  ...(key ? { 'idempotency-key': key } : {}),
});

const get = (path: string, cookie = adminA, org = orgA) =>
  app.inject({ url: `/api/v1${path}`, headers: headers(cookie, undefined, org) });

const send = (
  method: 'POST' | 'PUT' | 'PATCH',
  path: string,
  payload: unknown,
  cookie = adminA,
  key = crypto.randomUUID(),
  org = orgA,
) =>
  app.inject({
    method,
    url: `/api/v1${path}`,
    headers: headers(cookie, key, org),
    payload: payload as Record<string, unknown>,
  });

const post = (path: string, payload: unknown, cookie = adminA, org = orgA) =>
  send('POST', path, payload, cookie, crypto.randomUUID(), org);

async function ok<T>(res: Awaited<ReturnType<typeof get>>, expected = 200): Promise<T> {
  expect(res.statusCode, res.body).toBe(expected);
  return res.json<T>();
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

function localOffset(days: number, hour: number) {
  const target = new Date(Date.now() + days * 86_400_000);
  const datePart = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(target);
  return `${datePart}T${String(hour).padStart(2, '0')}:00`;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/db/migrations' });
  await db.execute(sql`truncate table organizations, users cascade`);

  const a = await bootstrap(db, config, {
    name: 'Self Admin A',
    email: 'self-admin-a@example.test',
    password,
    organizationName: 'b*nature Selbstservice Test',
    slug: 'self-org-a',
  });
  const b = await bootstrap(db, config, {
    name: 'Self Admin B',
    email: 'self-admin-b@example.test',
    password,
    organizationName: 'Fremder Verein',
    slug: 'self-org-b',
  });
  orgA = a.organizationId;
  orgB = b.organizationId;
  await app.ready();

  adminA = await login('self-admin-a@example.test');
  adminB = await login('self-admin-b@example.test');

  own = await ok<Member>(
    await post('/members', {
      firstName: 'Léna',
      lastName: 'Mair',
      email: 'lena.mair@example.test',
      membershipNumber: 'A-001',
      membershipType: 'ordinary',
      joinedAt: '2024-03-15',
    }),
    201,
  );
  other = await ok<Member>(
    await post('/members', {
      firstName: 'Marco',
      lastName: 'Rieger',
      email: 'marco.rieger@example.test',
      membershipNumber: 'A-002',
      joinedAt: '2024-04-01',
    }),
    201,
  );
  foreignMember = await ok<Member>(
    await post(
      '/members',
      {
        firstName: 'Fremd',
        lastName: 'Person',
        membershipNumber: 'B-001',
        joinedAt: '2024-01-01',
      },
      adminB,
      orgB,
    ),
    201,
  );

  await ok(
    await post('/users', {
      name: 'Léna Mair',
      email: 'self-member@example.test',
      password,
      role: 'member',
      personId: own.personId,
    }),
    201,
  );
  await ok(
    await post('/users', {
      name: 'Ohne Person',
      email: 'self-unlinked@example.test',
      password,
      role: 'member',
    }),
    201,
  );
  memberCookie = await login('self-member@example.test');
  unlinkedMemberCookie = await login('self-unlinked@example.test');

  groupMine = await ok<Group>(
    await post('/groups', { name: 'Habitatpflege', description: 'Trockenrasen pflegen' }),
    201,
  );
  groupOther = await ok<Group>(
    await post('/groups', { name: 'Vogelschutz', description: 'Nur andere Mitglieder' }),
    201,
  );
  await ok(
    await send('PUT', `/groups/${groupMine.id}/members`, { personIds: [own.personId] }),
    200,
  );
  await ok(
    await send('PUT', `/groups/${groupOther.id}/members`, { personIds: [other.personId] }),
    200,
  );

  // Consents and extra fields for own
  await ok(
    await post(`/members/${own.id}/consents`, {
      kind: 'data_processing',
      granted: true,
      decidedOn: '2024-03-15',
    }),
    201,
  );
  await ok(
    await post(`/members/${own.id}/consents`, {
      kind: 'photos',
      granted: false,
      decidedOn: '2024-03-16',
    }),
    201,
  );
  const shirtField = await ok<MemberField>(
    await post('/member-fields', {
      labelI18n: { de: 'Einsatzshirt', it: 'Maglietta' },
      type: 'select',
      options: ['S', 'M', 'L'],
    }),
    201,
  );
  await ok(
    await send('PUT', `/members/${own.id}/fields`, { values: { [shirtField.id]: 'M' } }),
    200,
  );

  // Finance: paid single payment + pooled payment + overdue open assessment for own
  const plan = await ok<FeePlan>(
    await post('/fee-plans', { name: 'Standardtarif', amountCents: 5000, interval: 'annual' }),
    201,
  );
  const paidAssess = await ok<FeeAssessment>(
    await post('/fee-assessments', {
      planId: plan.id,
      membershipId: own.id,
      fiscalYear: 2025,
      dueDate: '2025-01-31',
    }),
    201,
  );
  const partialAssess = await ok<FeeAssessment>(
    await post('/fee-assessments', {
      planId: plan.id,
      membershipId: own.id,
      fiscalYear: 2026,
      dueDate: '2020-02-01',
    }),
    201,
  );
  const otherAssess1 = await ok<FeeAssessment>(
    await post('/fee-assessments', {
      planId: plan.id,
      membershipId: other.id,
      fiscalYear: 2025,
      dueDate: '2025-01-31',
    }),
    201,
  );
  const otherAssess2 = await ok<FeeAssessment>(
    await post('/fee-assessments', {
      planId: plan.id,
      membershipId: other.id,
      fiscalYear: 2026,
      dueDate: '2026-01-31',
    }),
    201,
  );
  ownSinglePayment = await ok<Payment>(
    await post('/payments', {
      payerName: 'Léna Mair',
      paidOn: '2025-02-10',
      method: 'bank_transfer',
      reference: 'MITGLIED-2025',
      amountCents: 5000,
      allocations: [{ assessmentId: paidAssess.id, amountCents: 5000 }],
    }),
    201,
  );
  pooledPayment = await ok<Payment>(
    await post('/payments', {
      payerName: 'Sammelzahler',
      paidOn: '2026-02-10',
      method: 'bank_transfer',
      reference: 'SAMMEL-2026',
      amountCents: 4000,
      allocations: [
        { assessmentId: partialAssess.id, amountCents: 1500 },
        { assessmentId: otherAssess1.id, amountCents: 2500 },
      ],
    }),
    201,
  );
  otherSinglePayment = await ok<Payment>(
    await post('/payments', {
      payerName: 'Marco Rieger',
      paidOn: '2026-03-01',
      method: 'cash',
      amountCents: 5000,
      allocations: [{ assessmentId: otherAssess2.id, amountCents: 5000 }],
    }),
    201,
  );

  const foreignPlan = await ok<FeePlan>(
    await post(
      '/fee-plans',
      { name: 'Fremd', amountCents: 3000, interval: 'annual' },
      adminB,
      orgB,
    ),
    201,
  );
  const foreignAssess = await ok<FeeAssessment>(
    await post(
      '/fee-assessments',
      {
        planId: foreignPlan.id,
        membershipId: foreignMember.id,
        fiscalYear: 2026,
        dueDate: '2026-01-31',
      },
      adminB,
      orgB,
    ),
    201,
  );
  foreignPayment = await ok<Payment>(
    await post(
      '/payments',
      {
        payerName: 'Fremd',
        paidOn: '2026-03-01',
        method: 'cash',
        amountCents: 3000,
        allocations: [{ assessmentId: foreignAssess.id, amountCents: 3000 }],
      },
      adminB,
      orgB,
    ),
    201,
  );

  // Inventory loan (overdue) for own
  const item = await ok<InventoryItem>(
    await post('/inventory/items', { name: 'Astschere Profi', category: 'Werkzeug' }),
    201,
  );
  await ok(
    await post('/inventory/loans', {
      itemId: item.id,
      personId: own.personId,
      issuedOn: '2020-01-01',
      dueOn: '2020-02-01',
    }),
    201,
  );

  // Volunteer engagement + future assignment
  const volunteer = await ok<VolunteerDetail>(
    await post('/volunteers', {
      personId: own.personId,
      volunteerType: 'regular',
      startedOn: '2024-03-15',
    }),
    201,
  );
  await ok(
    await post('/volunteer-assignments', {
      engagementId: volunteer.id,
      task: 'Moorpfad kontrollieren',
      plannedStart: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      plannedEnd: new Date(Date.now() + 3 * 86_400_000 + 2 * 3_600_000).toISOString(),
      responsibleUserId: a.userId,
    }),
    201,
  );

  // Community news, polls (global open, groupOther open), schedule (global open, groupOther open), chat
  async function publishCommunityPost(payload: Record<string, unknown>) {
    const created = await ok<{ id: string }>(await post('/community/posts', payload), 201);
    const loaded = await ok<CommunityPost>(await get(`/community/posts/${created.id}`));
    await ok(await post(`/community/posts/${loaded.id}/publish`, { version: loaded.version }));
    return ok<CommunityPost>(await get(`/community/posts/${loaded.id}`));
  }

  await publishCommunityPost({
    kind: 'news',
    titleI18n: { de: 'Frühjahrseinsatz', it: 'Intervento primaverile' },
    bodyI18n: { de: 'Treffpunkt beim Vereinsheim.', it: 'Ritrovo in sede.' },
  });

  openPoll = await publishCommunityPost({
    kind: 'poll',
    titleI18n: { de: 'Lieblingstag für Einsätze?', it: 'Giorno preferito?' },
    bodyI18n: { de: 'Bitte abstimmen.', it: 'Vota per favore.' },
    options: [
      { de: 'Samstag', it: 'Sabato' },
      { de: 'Sonntag', it: 'Domenica' },
    ],
  });

  await publishCommunityPost({
    kind: 'poll',
    groupId: groupOther.id,
    titleI18n: { de: 'Interne Vogelzählung', it: 'Conteggio uccelli' },
    bodyI18n: { de: 'Nur für Vogelschutz.', it: 'Solo gruppo uccelli.' },
    options: [
      { de: 'Früh', it: 'Presto' },
      { de: 'Spät', it: 'Tardi' },
    ],
  });

  const sched = await ok<{ id: string }>(
    await post('/community/schedules', {
      titleI18n: { de: 'Terminumfrage Hecke', it: 'Sondaggio siepe' },
      location: 'Nordhang',
      slots: [
        {
          startAt: new Date(Date.now() + 8 * 86_400_000).toISOString(),
          endAt: new Date(Date.now() + 8 * 86_400_000 + 7_200_000).toISOString(),
        },
        {
          startAt: new Date(Date.now() + 9 * 86_400_000).toISOString(),
          endAt: new Date(Date.now() + 9 * 86_400_000 + 7_200_000).toISOString(),
        },
      ],
    }),
    201,
  );
  openScheduleId = sched.id;

  const otherGroupSched = await ok<{ id: string }>(
    await post('/community/schedules', {
      groupId: groupOther.id,
      titleI18n: { de: 'Termin Vogelschutz', it: 'Sondaggio uccelli' },
      location: 'See',
      slots: [
        {
          startAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
          endAt: new Date(Date.now() + 10 * 86_400_000 + 7_200_000).toISOString(),
        },
        {
          startAt: new Date(Date.now() + 11 * 86_400_000).toISOString(),
          endAt: new Date(Date.now() + 11 * 86_400_000 + 7_200_000).toISOString(),
        },
      ],
    }),
    201,
  );
  expect(otherGroupSched.id).toBeTruthy();

  await ok(
    await post('/community/chat', { groupId: groupMine.id, body: 'Treffpunkt am Parkplatz.' }),
    201,
  );
  await ok(await post('/community/chat', { groupId: groupOther.id, body: 'Nicht sichtbar.' }), 201);

  // Events: published upcoming event + draft upcoming event
  const cats = await ok<{ items: EventCategory[] }>(await post('/event-categories/initialize', {}));
  publishedEvent = await ok<EventOccurrence>(
    await post('/events', {
      titleI18n: { de: 'Blumenwiese mähen', it: 'Sfalcio del prato' },
      descriptionI18n: { de: 'Sensen und Rechen.', it: 'Falciatura insieme.' },
      categoryId: cats.items[0]!.id,
      startLocal: localOffset(5, 9),
      endLocal: localOffset(5, 12),
      timezone: 'Europe/Rome',
      location: 'Südhang Bozen',
      latitude: 46.498,
      longitude: 11.354,
      status: 'published',
      visibility: 'members',
      organizerId: a.userId,
    }),
    201,
  );
  draftEvent = await ok<EventOccurrence>(
    await post('/events', {
      titleI18n: { de: 'Interner Entwurf', it: 'Bozza interna' },
      descriptionI18n: { de: 'Noch nicht bereit.', it: 'Non pronto.' },
      categoryId: cats.items[0]!.id,
      startLocal: localOffset(6, 9),
      endLocal: localOffset(6, 12),
      timezone: 'Europe/Rome',
      status: 'draft',
      visibility: 'internal',
      organizerId: a.userId,
    }),
    201,
  );
  await ok(await post(`/events/${publishedEvent.id}/registrations`, {}, memberCookie), 201);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('member self-service dashboard, profile, receipts, groups and event ICS', () => {
  it('returns safe empty dashboard, membership, fees and 403 receipt for unlinked accounts', async () => {
    const dash = await ok<MemberDashboard>(await get('/dashboard/member', unlinkedMemberCookie));
    expect(dash.linked).toBe(false);
    expect(dash.membership).toBeNull();
    expect(dash.fees).toEqual({ openCount: 0, overdueCount: 0, openCents: 0 });
    expect(dash.myGroupCount).toBe(0);
    expect(dash.activeLoanCount).toBe(0);
    expect(dash.nextAssignment).toBeNull();

    const membership = await ok<OwnMembershipDetail>(
      await get('/profile/membership', unlinkedMemberCookie),
    );
    expect(membership.linked).toBe(false);
    expect(membership.groups).toEqual([]);
    expect(membership.extraFields).toEqual([]);

    const fees = await ok<OwnFees>(await get('/profile/fees', unlinkedMemberCookie));
    expect(fees.linked).toBe(false);
    expect(fees.hasMembership).toBe(false);
    expect(fees.assessments).toEqual([]);
    expect(fees.payments).toEqual([]);

    expect(
      (
        await get(
          `/profile/fees/payments/${ownSinglePayment.id}/receipt?language=de`,
          unlinkedMemberCookie,
        )
      ).statusCode,
    ).toBe(403);
  });

  it('aggregates live dashboard signals and updates unanswered poll & schedule counts', async () => {
    const dash = await ok<MemberDashboard>(await get('/dashboard/member', memberCookie));
    expect(dash.linked).toBe(true);
    expect(dash.personName).toBe('Léna Mair');
    expect(dash.membership).toMatchObject({
      id: own.id,
      membershipNumber: 'A-001',
      membershipType: 'ordinary',
      status: 'active',
    });
    expect(dash.fees).toEqual({ openCount: 1, overdueCount: 1, openCents: 3500 });
    expect(dash.community).toMatchObject({
      unreadNews: 1,
      unreadPolls: 1,
      unreadChat: 1,
      openUnansweredPolls: 1,
      openUnansweredSchedules: 1,
    });
    expect(dash.myGroupCount).toBe(1);
    expect(dash.activeLoanCount).toBe(1);
    expect(dash.overdueLoanCount).toBe(1);
    expect(dash.nextAssignment).toMatchObject({
      task: 'Moorpfad kontrollieren',
      eventTitle: null,
    });
    expect(dash.upcomingEvents.map((e) => e.id)).toEqual([publishedEvent.id]);
    expect(dash.upcomingEvents[0]).toMatchObject({
      myRegistrationStatus: 'registered',
      location: 'Südhang Bozen',
    });

    await ok(
      await send(
        'PUT',
        `/community/posts/${openPoll.id}/vote`,
        { version: openPoll.version, optionId: openPoll.options[0]!.id },
        memberCookie,
      ),
    );
    const schedDetail = await ok<{ slots: { id: string }[] }>(
      await get(`/community/schedules/${openScheduleId}`, memberCookie),
    );
    await ok(
      await send(
        'PUT',
        `/community/schedules/${openScheduleId}/answers`,
        { answers: [{ slotId: schedDetail.slots[0]!.id, answer: 'yes' }] },
        memberCookie,
      ),
    );

    const after = await ok<MemberDashboard>(await get('/dashboard/member', memberCookie));
    expect(after.community.openUnansweredPolls).toBe(0);
    expect(after.community.openUnansweredSchedules).toBe(0);
  });

  it('serves self-scoped membership card, groups, consents and custom fields without leakage', async () => {
    const detail = await ok<OwnMembershipDetail>(await get('/profile/membership', memberCookie));
    expect(detail.linked).toBe(true);
    expect(detail.person).toMatchObject({ firstName: 'Léna', lastName: 'Mair' });
    expect(detail.membership?.membershipNumber).toBe('A-001');
    expect(detail.groups.map((g) => g.name)).toEqual(['Habitatpflege']);
    expect(detail.consents.data_processing).toMatchObject({
      granted: true,
      decidedOn: '2024-03-15',
    });
    expect(detail.consents.photos).toMatchObject({ granted: false, decidedOn: '2024-03-16' });
    expect(detail.extraFields).toEqual([
      expect.objectContaining({ labelI18n: { de: 'Einsatzshirt', it: 'Maglietta' }, value: 'M' }),
    ]);
    expect(JSON.stringify(detail)).not.toContain('Marco');
    expect(JSON.stringify(detail)).not.toContain('Vogelschutz');
  });

  it('shows own fees and downloads single-member PDF receipts while blocking pooled and foreign ones', async () => {
    const fees = await ok<OwnFees>(await get('/profile/fees', memberCookie));
    expect(fees.linked).toBe(true);
    expect(fees.hasMembership).toBe(true);
    expect(fees.openCount).toBe(1);
    expect(fees.overdueCount).toBe(1);
    expect(fees.openCents).toBe(3500);
    expect(fees.assessments).toHaveLength(2);
    expect(fees.payments).toHaveLength(2);

    const single = fees.payments.find((p) => p.id === ownSinglePayment.id)!;
    expect(single.receiptAvailable).toBe(true);
    expect(single.allocations).toHaveLength(1);

    const pooled = fees.payments.find((p) => p.id === pooledPayment.id)!;
    expect(pooled.receiptAvailable).toBe(false);
    expect(pooled.allocations).toEqual([
      expect.objectContaining({ fiscalYear: 2026, amountCents: 1500 }),
    ]);
    expect(JSON.stringify(fees)).not.toContain('Marco');

    const pdf = await get(
      `/profile/fees/payments/${ownSinglePayment.id}/receipt?language=de`,
      memberCookie,
    );
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');

    expect(
      (await get(`/profile/fees/payments/${pooledPayment.id}/receipt?language=de`, memberCookie))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await get(
          `/profile/fees/payments/${otherSinglePayment.id}/receipt?language=de`,
          memberCookie,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await get(`/profile/fees/payments/${foreignPayment.id}/receipt?language=de`, memberCookie))
        .statusCode,
    ).toBe(404);

    // Admin finance routes remain forbidden for regular members.
    expect((await get('/fee-assessments', memberCookie)).statusCode).toBe(403);
    expect((await get('/payments', memberCookie)).statusCode).toBe(403);
    expect((await get(`/payments/${ownSinglePayment.id}/receipt`, memberCookie)).statusCode).toBe(
      403,
    );
  });

  it('marks group membership on /groups without exposing member rosters and serves single-event .ics', async () => {
    const groupsPage = await ok<Page<Group>>(await get('/groups', memberCookie));
    const mine = groupsPage.items.find((g) => g.id === groupMine.id)!;
    const otherGroup = groupsPage.items.find((g) => g.id === groupOther.id)!;
    expect(mine.isMember).toBe(true);
    expect(otherGroup.isMember).toBe(false);

    const detail = await ok<Group & { members: unknown[] }>(
      await get(`/groups/${groupMine.id}`, memberCookie),
    );
    expect(detail.isMember).toBe(true);
    expect(detail.members).toEqual([]);

    const ics = await get(`/events/${publishedEvent.id}/calendar.ics?language=it`, memberCookie);
    expect(ics.statusCode).toBe(200);
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.body).toContain('BEGIN:VEVENT');
    expect(ics.body).toContain('Sfalcio del prato');

    expect(
      (await get(`/events/${draftEvent.id}/calendar.ics?language=de`, memberCookie)).statusCode,
    ).toBe(404);
    expect(
      (await get(`/events/${draftEvent.id}/calendar.ics?language=de`, adminA)).statusCode,
    ).toBe(200);
  });
});
