import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import { createDatabase, schema as s } from '../../packages/db/src';
import { createApp } from '../../apps/api/src/app';
import { createAuth } from '../../apps/api/src/auth';
import { readConfig } from '../../apps/api/src/plugins/config';
import { bootstrap } from '../../apps/api/src/services/bootstrap';
import { deliverMail } from '../../apps/api/src/services/mail-worker';
import {
  MailDeliveryError,
  type OutgoingMail,
  type MailSender,
} from '../../apps/api/src/services/mail';
import { enqueueAutomaticMail } from '../../apps/api/src/modules/mail';
import {
  enqueueDeadlineReminders,
  enqueueLoanReminders,
  revalidateReminder,
  deadlineReminderDue,
  loanReminderDue,
} from '../../apps/api/src/modules/automatic-reminders';
import type {
  MailPreview,
  Member,
  FeeAssessment,
  EventOccurrence,
} from '../../packages/contracts/src';

const config = { ...readConfig(), EMAIL_MODE: 'local' as const };
if (config.NODE_ENV !== 'test' || new URL(config.DATABASE_URL).pathname !== '/bnature_test')
  throw new Error('Dedicated test database required');
const { db, pool } = createDatabase(config.DATABASE_URL);
let app: Awaited<ReturnType<typeof createApp>>;
const password = 'Mail-test-only-password-2026!';
const users: Record<string, { id: string; cookie: string }> = {};
let org = '',
  foreignOrg = '';
let de: Member, italian: Member, event: EventOccurrence;
let assessments: FeeAssessment[] = [];
const sent: OutgoingMail[] = [];
const sender: MailSender = {
  async send(message) {
    sent.push(message);
  },
  close() {},
};
function headers(role = 'admin', key?: string, organization = org) {
  return {
    cookie: users[role]!.cookie,
    origin: config.APP_URL,
    'x-organization-id': organization,
    ...(key ? { 'idempotency-key': key } : {}),
  };
}
const get = (path: string, role = 'admin') =>
  app.inject({ url: `/api/v1${path}`, headers: headers(role) });
const post = (path: string, payload: unknown, role = 'admin', key: string = crypto.randomUUID()) =>
  app.inject({
    method: 'POST',
    url: `/api/v1${path}`,
    headers: headers(role, key),
    payload: payload as Record<string, unknown>,
  });
async function ok<T>(response: Awaited<ReturnType<typeof get>>, status = 200): Promise<T> {
  expect(response.statusCode, response.body).toBe(status);
  return response.json<T>();
}
const preview = (request: unknown = { kind: 'fee_reminder' }, role = 'admin') =>
  post('/mail/preview', request, role);
const queue = (p: MailPreview, role = 'admin', key?: string) =>
  post('/mail/send', { request: p.request, previewHash: p.hash }, role, key);
const rows = () => db.select().from(s.mailMessages).orderBy(s.mailMessages.recipient);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/db/migrations' });
  await db.execute(sql`truncate table organizations, users cascade`);
  const root = await bootstrap(db, config, {
    name: 'Mail Admin',
    email: 'mail-admin@example.test',
    password,
    organizationName: 'Mail',
    slug: 'mail-root',
  });
  const foreign = await bootstrap(db, config, {
    name: 'Foreign',
    email: 'mail-foreign@example.test',
    password,
    organizationName: 'Foreign',
    slug: 'mail-foreign',
  });
  foreignOrg = foreign.organizationId;
  const provision = createAuth(db, config, true);
  for (const role of ['board', 'treasurer', 'member']) {
    const created = await provision.api.signUpEmail({
      body: { name: role, email: `mail-${role}@example.test`, password },
    });
    users[role] = { id: created.user.id, cookie: '' };
  }
  users.admin = { id: root.userId, cookie: '' };
  users.foreign = { id: foreign.userId, cookie: '' };
  app = await createApp(db, config);
  await app.ready();
  for (const [role, user] of Object.entries(users)) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: config.APP_URL },
      payload: { email: `mail-${role}@example.test`, password },
    });
    expect(response.statusCode, response.body).toBe(200);
    const cookie = response.headers['set-cookie'];
    user.cookie = (Array.isArray(cookie) ? cookie : [cookie])
      .filter(Boolean)
      .map((c) => c!.split(';')[0])
      .join('; ');
  }
  await app.close();
});
beforeEach(async () => {
  await db.execute(sql`truncate table mail_messages, mail_settings`);
  const [organization] = await db
    .insert(s.organizations)
    .values({ name: 'b*nature Mailtest', slug: `mail-${crypto.randomUUID()}` })
    .returning();
  org = organization!.id;
  for (const role of ['admin', 'board', 'treasurer', 'member'] as const)
    await db
      .insert(s.organizationUserRoles)
      .values({ organizationId: org, userId: users[role]!.id, role });
  app = await createApp(db, config);
  await app.ready();
  const members: Member[] = [];
  for (const [name, email, language] of [
    ['Deutsch', 'mail-de@example.test', 'de'],
    ['Italiano', 'mail-it@example.test', 'it'],
    ['Ohne E-Mail', '', 'de'],
    ['Ohne Zugang', 'mail-no-account@example.test', 'de'],
  ] as const) {
    members.push(
      await ok<Member>(
        await post('/members', {
          firstName: name,
          lastName: 'Test',
          email,
          preferredLanguage: language,
          membershipNumber: `M-${members.length}`,
          joinedAt: '2020-01-01',
        }),
        201,
      ),
    );
  }
  [de, italian] = members as [Member, Member];
  await db.insert(s.personUserLinks).values([
    { organizationId: org, personId: de.personId, userId: users.member!.id },
    { organizationId: org, personId: italian.personId, userId: users.board!.id },
  ]);
  const plan = await ok<{ id: string }>(
    await post('/fee-plans', { name: 'Jahresbeitrag', amountCents: 2500, interval: 'annual' }),
    201,
  );
  assessments = [];
  for (const member of members.slice(0, 3))
    assessments.push(
      await ok<FeeAssessment>(
        await post('/fee-assessments', {
          planId: plan.id,
          membershipId: member.id,
          fiscalYear: 2026,
          dueDate: '2020-01-01',
        }),
        201,
      ),
    );
  const category = await ok<{ id: string }>(
    await post('/event-categories', { nameI18n: { de: 'Natur', it: 'Natura' } }),
    201,
  );
  const future = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  event = await ok<EventOccurrence>(
    await post('/events', {
      titleI18n: { de: 'Waldpflege', it: 'Cura del bosco' },
      descriptionI18n: { de: 'Gemeinsam', it: 'Insieme' },
      categoryId: category.id,
      startLocal: `${future}T09:00`,
      endLocal: `${future}T12:00`,
      organizerId: users.admin!.id,
      status: 'published',
      visibility: 'members',
    }),
    201,
  );
  sent.length = 0;
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await pool.end();
});

describe('organization-scoped transactional email', () => {
  it('returns the extended status, settings and outbox contract and rejects unfinished mail kinds explicitly', async () => {
    const adminStatus = await ok<{ mode: string; sender: string | null; host: string | null }>(
      await get('/mail/status'),
    );
    expect(adminStatus.mode).toBe('local');
    expect(adminStatus.sender).toBe(config.EMAIL_FROM);
    const boardStatus = await ok<{ sender: string | null; host: string | null }>(
      await get('/mail/status', 'board'),
    );
    expect(boardStatus.sender).toBeNull();
    expect(boardStatus.host).toBeNull();
    const settings = await ok<{
      automaticDeadlineReminders: boolean;
      deadlineLastRunOn: string | null;
    }>(await get('/mail/settings'));
    expect(settings.automaticDeadlineReminders).toBe(false);
    expect(settings.deadlineLastRunOn).toBeNull();
    // Deadline reminders are automatic only; there is no manual preview for them.
    const unavailable = await preview({ kind: 'deadline_reminder' });
    expect(unavailable.statusCode).toBe(409);
    expect(unavailable.json().error.code).toBe('MAIL_KIND_UNAVAILABLE');
    const p = await ok<MailPreview>(await preview());
    expect(p.items.every((item) => item.userId === null)).toBe(true);
    expect(p.skipped.optedOut).toBe(0);
    await ok(await queue(p), 202);
    await deliverMail(db, config, sender);
    const messages = await ok<{
      items: { attempts: number; resolution: null; resolvedAt: null; resolutionNote: string }[];
    }>(await get('/mail/messages'));
    expect(messages.items[0]!.attempts).toBe(1);
    expect(messages.items[0]!.resolution).toBeNull();
    expect(messages.items[0]!.resolvedAt).toBeNull();
    expect(messages.items[0]!.resolutionNote).toBe('');
  });
  it('previews overdue fees in DE/IT and rejects unauthenticated, wrong-role and arbitrary-recipient requests', async () => {
    const p = await ok<MailPreview>(await preview());
    expect(p.items).toHaveLength(2);
    expect(p.skipped.invalidEmail).toBe(1);
    expect(p.items.find((i) => i.language === 'it')!.subject).toContain('Promemoria');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/mail/preview',
          headers: { origin: config.APP_URL },
          payload: { kind: 'fee_reminder' },
        })
      ).statusCode,
    ).toBe(401);
    expect((await preview(undefined, 'member')).statusCode).toBe(403);
    expect((await preview(undefined, 'board')).statusCode).toBe(403);
    expect(
      (await preview({ kind: 'fee_reminder', recipients: ['other@example.test'] })).statusCode,
    ).toBe(422);
    expect((await get('/mail/settings', 'treasurer')).statusCode).toBe(403);
    expect((await preview(undefined, 'treasurer')).statusCode).toBe(200);
  });
  it('queues concurrent retries exactly once, then hands each message off individually', async () => {
    const p = await ok<MailPreview>(await preview());
    const key = crypto.randomUUID();
    const responses = await Promise.all([queue(p, 'admin', key), queue(p, 'admin', key)]);
    responses.forEach((r) => expect(r.statusCode, r.body).toBe(202));
    expect(await rows()).toHaveLength(2);
    await Promise.all([deliverMail(db, config, sender), deliverMail(db, config, sender)]);
    expect(sent).toHaveLength(2);
    expect(new Set(sent.map((m) => m.id)).size).toBe(2);
    expect((await rows()).every((r) => r.state === 'sent')).toBe(true);
    expect((await ok<MailPreview>(await preview())).items).toHaveLength(0);
    expect((await queue({ ...p, hash: 'a'.repeat(64) }, 'admin', key)).statusCode).toBe(409);
  });
  it('rejects stale previews and cancels an already queued fee when it has been paid', async () => {
    const p = await ok<MailPreview>(await preview());
    await ok(await queue(p), 202);
    await ok(
      await post('/payments', {
        payerName: 'Test',
        paidOn: '2026-10-30',
        method: 'bank_transfer',
        amountCents: 2500,
        allocations: [{ assessmentId: assessments[0]!.id, amountCents: 2500 }],
      }),
      201,
    );
    expect((await queue(p)).statusCode).toBe(409);
    await deliverMail(db, config, sender);
    expect(sent).toHaveLength(1);
    expect((await rows()).find((r) => r.assessmentId === assessments[0]!.id)?.state).toBe(
      'cancelled',
    );
  });
  it('includes only members with accounts in invitations, isolates tenants and outboxes', async () => {
    const p = await ok<MailPreview>(
      await preview({ kind: 'event_invitation', eventId: event.id }, 'board'),
    );
    expect(p.items).toHaveLength(2);
    expect(p.skipped.noAccount).toBe(2);
    expect(p.items.find((i) => i.language === 'it')!.text).toContain('Cura del bosco');
    expect(p.items[0]!.text).toContain(`/events/${event.id}`);
    expect((await preview(p.request, 'treasurer')).statusCode).toBe(403);
    await ok(await queue(p, 'board'), 202);
    expect((await ok<{ total: number }>(await get('/mail/messages', 'treasurer'))).total).toBe(0);
    expect((await ok<{ total: number }>(await get('/mail/messages', 'board'))).total).toBe(2);
    const foreign = await app.inject({
      method: 'POST',
      url: '/api/v1/mail/preview',
      headers: headers('foreign', undefined, foreignOrg),
      payload: p.request,
    });
    expect(foreign.statusCode).toBe(404);
    const outbox = await app.inject({
      url: '/api/v1/mail/messages',
      headers: headers('foreign', undefined, foreignOrg),
    });
    expect(outbox.json().total).toBe(0);
    await deliverMail(db, config, sender);
    expect(sent).toHaveLength(2);
  });
  it('cancels invitations after registration or event cancellation', async () => {
    const p = await ok<MailPreview>(await preview({ kind: 'event_invitation', eventId: event.id }));
    await ok(await queue(p), 202);
    await ok(await post(`/events/${event.id}/registrations`, { personId: de.personId }), 201);
    await deliverMail(db, config, sender, 1);
    await ok(
      await post(`/events/${event.id}/cancel`, {
        version: event.version,
        reason: 'Test cancellation',
      }),
    );
    await deliverMail(db, config, sender);
    expect((await rows()).every((r) => ['sent', 'cancelled'].includes(r.state))).toBe(true);
    expect((await rows()).filter((r) => r.state === 'cancelled').length).toBeGreaterThanOrEqual(1);
    expect((await preview(p.request)).statusCode).toBe(409);
  });
  it('does not deliver after the sending role is revoked', async () => {
    const p = await ok<MailPreview>(await preview());
    await ok(await queue(p), 202);
    await db
      .update(s.organizationUserRoles)
      .set({ role: 'member' })
      .where(eq(s.organizationUserRoles.userId, users.admin!.id));
    await deliverMail(db, config, sender);
    expect(sent).toHaveLength(0);
    expect((await rows()).every((r) => r.state === 'cancelled')).toBe(true);
  });
  it('cancels a queued message when its recipient address changes', async () => {
    const p = await ok<MailPreview>(await preview());
    await ok(await queue(p), 202);
    await db
      .update(s.persons)
      .set({ email: 'changed@example.test' })
      .where(eq(s.persons.id, de.personId));
    await deliverMail(db, config, sender);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.recipient).toBe(italian.email);
    expect((await rows()).find((r) => r.personId === de.personId)?.state).toBe('cancelled');
  });
  it('never retries uncertain SMTP handoffs or interrupted sending states', async () => {
    const p = await ok<MailPreview>(await preview());
    await ok(await queue(p), 202);
    let attempts = 0;
    const uncertain: MailSender = {
      async send() {
        attempts++;
        throw new MailDeliveryError(true);
      },
      close() {},
    };
    await deliverMail(db, config, uncertain, 1);
    const pending = (await rows()).find((r) => r.state === 'queued')!;
    await db
      .update(s.mailMessages)
      .set({ state: 'sending', attemptedAt: new Date(Date.now() - 180_000) })
      .where(eq(s.mailMessages.id, pending.id));
    await deliverMail(db, config, uncertain);
    await deliverMail(db, config, uncertain);
    expect(attempts).toBe(1);
    expect((await rows()).every((r) => r.state === 'uncertain')).toBe(true);
  });
  it('starts with automation disabled and prevents duplicate scheduler runs and premature repeat reminders', async () => {
    await enqueueAutomaticMail(db, config);
    expect(await rows()).toHaveLength(0);
    const r = await app.inject({
      method: 'PUT',
      url: '/api/v1/mail/settings',
      headers: headers('admin', crypto.randomUUID()),
      payload: { automaticFeeReminders: true, reminderIntervalDays: 14 },
    });
    await ok(r);
    await Promise.all([enqueueAutomaticMail(db, config), enqueueAutomaticMail(db, config)]);
    expect(await rows()).toHaveLength(2);
    await db
      .update(s.mailSettings)
      .set({ lastRunOn: null })
      .where(eq(s.mailSettings.organizationId, org));
    await enqueueAutomaticMail(db, config);
    expect(await rows()).toHaveLength(2);
    await db
      .update(s.mailMessages)
      .set({ createdAt: new Date(Date.now() - 15 * 86_400_000) })
      .where(eq(s.mailMessages.organizationId, org));
    await db
      .update(s.mailSettings)
      .set({ lastRunOn: null })
      .where(eq(s.mailSettings.organizationId, org));
    await enqueueAutomaticMail(db, config);
    expect(await rows()).toHaveLength(2); // An old queue backlog must not create duplicate reminders.
    await deliverMail(db, config, sender);
    // Dedupe is per local business day; advance the stored key along with the historical fixture.
    await db
      .update(s.mailMessages)
      .set({ sentAt: new Date(Date.now() - 15 * 86_400_000) })
      .where(eq(s.mailMessages.organizationId, org));
    await db
      .update(s.mailMessages)
      .set({ dedupeKey: sql`'historical:' || id::text` })
      .where(eq(s.mailMessages.organizationId, org));
    await db
      .update(s.mailSettings)
      .set({ lastRunOn: null })
      .where(eq(s.mailSettings.organizationId, org));
    await enqueueAutomaticMail(db, config);
    expect(await rows()).toHaveLength(4);
  });
  it('keeps messages queued while transport is disabled and enforces source tenant constraints', async () => {
    const p = await ok<MailPreview>(await preview());
    await ok(await queue(p), 202);
    await deliverMail(db, { ...config, EMAIL_MODE: 'disabled' }, sender);
    expect(sent).toHaveLength(0);
    expect((await rows()).every((r) => r.state === 'queued')).toBe(true);
    const row = (await rows())[0]!;
    await expect(
      db.insert(s.mailMessages).values({
        ...row,
        id: crypto.randomUUID(),
        organizationId: foreignOrg,
        dedupeKey: 'foreign',
      }),
    ).rejects.toThrow();
  });
});

describe('automatic deadline and loan reminders', () => {
  const localDay = (offset: number) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(
      new Date(Date.now() + offset * 86_400_000),
    );
  const enable = (patch: Record<string, unknown> = {}) =>
    db.insert(s.mailSettings).values({
      organizationId: org,
      automaticDeadlineReminders: true,
      automaticLoanReminders: true,
      enabledBy: users.admin!.id,
      ...patch,
    });
  const deadline = async (patch: Record<string, unknown>) => {
    const [row] = await db
      .insert(s.complianceDeadlines)
      .values({
        organizationId: org,
        kind: 'internal',
        topic: 'custom',
        titleI18n: { de: 'Jahresbericht', it: 'Relazione annuale' },
        descriptionI18n: { de: '', it: '' },
        dueDate: localDay(7),
        reminderDays: [7],
        createdBy: users.admin!.id,
        ...patch,
      } as typeof s.complianceDeadlines.$inferInsert)
      .returning();
    return row!;
  };
  const byKind = async (kind: 'deadline_reminder' | 'loan_reminder') =>
    (await rows()).filter((r) => r.kind === kind);
  it('lets admins enable both automations through the settings endpoint', async () => {
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/mail/settings',
      headers: headers('admin', crypto.randomUUID()),
      payload: {
        automaticFeeReminders: false,
        reminderIntervalDays: 14,
        automaticDeadlineReminders: true,
        automaticLoanReminders: true,
      },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({
      automaticDeadlineReminders: true,
      automaticLoanReminders: true,
      loanLastRunOn: null,
    });
    const denied = await app.inject({
      method: 'PUT',
      url: '/api/v1/mail/settings',
      headers: headers('board', crypto.randomUUID()),
      payload: {
        automaticFeeReminders: false,
        reminderIntervalDays: 14,
        automaticDeadlineReminders: true,
      },
    });
    expect(denied.statusCode).toBe(403);
  });
  it('reminds the responsible person or role on the configured days, once per day', async () => {
    await enable({ automaticLoanReminders: false });
    const byRole = await deadline({ responsibleRole: 'board' });
    const byUser = await deadline({
      responsibleUserId: users.treasurer!.id,
      reminderDays: [30, 7],
    });
    await deadline({ dueDate: localDay(5) }); // not a reminder day
    await deadline({ dueDate: localDay(-1), status: 'not_applicable' });
    const overdue = await deadline({ dueDate: localDay(-1) }); // first day overdue, no owner
    await enqueueDeadlineReminders(db, config);
    await enqueueDeadlineReminders(db, config);
    const queued = await byKind('deadline_reminder');
    expect(queued.map((r) => [r.deadlineId, r.recipient]).sort()).toEqual(
      [
        [byRole.id, 'mail-board@example.test'],
        [byUser.id, 'mail-treasurer@example.test'],
        [overdue.id, 'mail-admin@example.test'],
      ].sort(),
    );
    const italian = queued.find((r) => r.recipient === 'mail-board@example.test')!;
    expect(italian.language).toBe('it');
    expect(italian.subject).toContain('Relazione annuale');
    expect(queued.find((r) => r.deadlineId === overdue.id)!.body).toContain('überfällig');
    expect(await revalidateReminder(db, italian)).toBe(true);
    await db
      .update(s.complianceDeadlines)
      .set({ dueDate: localDay(20), version: byRole.version + 1 })
      .where(eq(s.complianceDeadlines.id, byRole.id));
    expect(await revalidateReminder(db, italian)).toBe(false);
    await db
      .update(s.complianceDeadlines)
      .set({ status: 'not_applicable', version: byUser.version + 1 })
      .where(eq(s.complianceDeadlines.id, byUser.id));
    expect(
      await revalidateReminder(
        db,
        queued.find((r) => r.deadlineId === byUser.id)!,
      ),
    ).toBe(false);
  });
  it('reminds borrowers before the return date and when overdue, but not after return', async () => {
    await enable({ automaticDeadlineReminders: false });
    const [item] = await db
      .insert(s.inventoryItems)
      .values({
        organizationId: org,
        name: 'Fernglas',
        quantity: 5,
        createdBy: users.admin!.id,
      } as typeof s.inventoryItems.$inferInsert)
      .returning();
    const loan = async (personId: string, dueOn: string, patch: Record<string, unknown> = {}) => {
      const [row] = await db
        .insert(s.inventoryLoans)
        .values({
          organizationId: org,
          itemId: item!.id,
          personId,
          issuedOn: localDay(-30),
          dueOn,
          issueCondition: 'good',
          createdBy: users.admin!.id,
          ...patch,
        } as typeof s.inventoryLoans.$inferInsert)
        .returning();
      return row!;
    };
    const soon = await loan(de.personId, localDay(2));
    const late = await loan(italian.personId, localDay(-8));
    await loan(de.personId, localDay(10));
    await loan(de.personId, localDay(-1), {
      returnedOn: localDay(-1),
      returnCondition: 'good',
      returnedBy: users.admin!.id,
    });
    await enqueueLoanReminders(db, config);
    await enqueueLoanReminders(db, config);
    const queued = await byKind('loan_reminder');
    expect(queued.map((r) => r.loanId).sort()).toEqual([soon.id, late.id].sort());
    const lateMail = queued.find((r) => r.loanId === late.id)!;
    expect(lateMail.recipient).toBe('mail-it@example.test');
    expect(lateMail.subject).toContain('Restituzione scaduta');
    expect(await revalidateReminder(db, lateMail)).toBe(true);
    await db
      .update(s.inventoryLoans)
      .set({
        returnedOn: localDay(0),
        returnCondition: 'good',
        returnedBy: users.admin!.id,
        version: late.version + 1,
      })
      .where(eq(s.inventoryLoans.id, late.id));
    expect(await revalidateReminder(db, lateMail)).toBe(false);
    await deliverMail(db, config, sender);
    expect(sent.map((m) => m.recipient)).toEqual(['mail-de@example.test']);
  });
  it('stops when the enabling account is no longer an admin', async () => {
    await enable({ enabledBy: users.board!.id });
    await deadline({ responsibleRole: 'board' });
    await enqueueDeadlineReminders(db, config);
    expect(await byKind('deadline_reminder')).toEqual([]);
  });
  it('schedules reminder days', () => {
    expect([7, 1, 0, -1, -8, -15].map((d) => deadlineReminderDue(d, [7, 1]))).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect([6, -2, -7].some((d) => deadlineReminderDue(d, [7, 1]))).toBe(false);
    expect([2, -1, -8].every(loanReminderDue)).toBe(true);
    expect([3, 1, 0, -2].some(loanReminderDue)).toBe(false);
  });
});
describe('newsletter', () => {
  const newsletter = (patch: Record<string, unknown> = {}) => ({
    subjectI18n: { de: 'Frühjahrsputz im Biotop', it: 'Pulizie di primavera nel biotopo' },
    bodyI18n: { de: 'Wir treffen uns am Samstag.', it: 'Ci troviamo sabato.' },
    ...patch,
  });
  const put = (path: string, payload: unknown, role = 'admin') =>
    app.inject({
      method: 'PUT',
      url: `/api/v1${path}`,
      headers: headers(role),
      payload: payload as Record<string, unknown>,
    });
  const create = async (patch: Record<string, unknown> = {}, role = 'board') =>
    ok<{ id: string; version: number; status: string }>(
      await post('/mail/newsletters', newsletter(patch), role),
      201,
    );
  it('previews members, honours opt-outs and sends a draft exactly once', async () => {
    expect((await post('/mail/newsletters', newsletter(), 'treasurer')).statusCode).toBe(403);
    const draft = await create();
    const request = { kind: 'newsletter', newsletterId: draft.id };
    const first = await ok<MailPreview>(await preview(request, 'board'));
    expect(first.items.map((i) => i.recipient).sort()).toEqual([
      'mail-de@example.test',
      'mail-it@example.test',
      'mail-no-account@example.test',
    ]);
    expect(first.skipped.invalidEmail).toBe(1);
    const italianItem = first.items.find((i) => i.language === 'it')!;
    expect(italianItem.subject).toBe('b*nature Mailtest: Pulizie di primavera nel biotopo');
    expect(italianItem.text).toContain('Ci troviamo sabato.');
    // The linked member unsubscribes in the profile.
    expect(
      (await ok<{ optOut: boolean }>(await put('/profile/newsletter', { optOut: true }, 'member')))
        .optOut,
    ).toBe(true);
    expect(
      (await put('/profile/newsletter', { optOut: true }, 'treasurer')).json().error.code,
    ).toBe('PROFILE_UNLINKED');
    const second = await ok<MailPreview>(await preview(request, 'board'));
    expect(second.skipped.optedOut).toBe(1);
    expect(second.items.map((i) => i.recipient)).not.toContain('mail-de@example.test');
    await ok(await queue(second, 'board'), 202);
    const [stored] = await db
      .select()
      .from(s.mailNewsletters)
      .where(eq(s.mailNewsletters.id, draft.id));
    expect(stored!.status).toBe('sent');
    expect((await preview(request, 'board')).json().error.code).toBe('NEWSLETTER_NOT_DRAFT');
    expect(
      (
        await put(
          `/mail/newsletters/${draft.id}`,
          { ...newsletter(), version: draft.version },
          'board',
        )
      ).statusCode,
    ).toBe(409);
    // Unsubscribing after queueing still stops the message before SMTP handoff.
    await ok(await put(`/members/${italian.id}/newsletter`, { optOut: true }));
    await deliverMail(db, config, sender);
    expect(sent.map((m) => m.recipient)).toEqual(['mail-no-account@example.test']);
    const cancelled = (await rows()).find((r) => r.recipient === 'mail-it@example.test')!;
    expect(cancelled.state).toBe('cancelled');
  });
  it('limits group newsletters to active group members and lets drafts be edited or withdrawn', async () => {
    const [group] = await db
      .insert(s.groups)
      .values({ organizationId: org, name: 'Vogelschutz' })
      .returning();
    await db
      .insert(s.groupMembers)
      .values({ organizationId: org, groupId: group!.id, personId: italian.personId });
    const draft = await create({ groupIds: [group!.id] });
    const edited = await ok<{ version: number; subjectI18n: { de: string } }>(
      await put(
        `/mail/newsletters/${draft.id}`,
        {
          ...newsletter({ groupIds: [group!.id] }),
          subjectI18n: { de: 'Neu', it: 'Nuovo' },
          version: draft.version,
        },
        'board',
      ),
    );
    expect(edited.subjectI18n.de).toBe('Neu');
    const p = await ok<MailPreview>(
      await preview({ kind: 'newsletter', newsletterId: draft.id }, 'board'),
    );
    expect(p.items.map((i) => i.recipient)).toEqual(['mail-it@example.test']);
    expect(
      (await post('/mail/newsletters', newsletter({ groupIds: [crypto.randomUUID()] }), 'board'))
        .statusCode,
    ).toBe(404);
    const withdrawn = await ok<{ status: string }>(
      await post(`/mail/newsletters/${draft.id}/withdraw`, {}, 'board'),
    );
    expect(withdrawn.status).toBe('withdrawn');
    const listed = await ok<{ items: { id: string }[] }>(await get('/mail/newsletters', 'board'));
    expect(listed.items.map((x) => x.id)).not.toContain(draft.id);
  });
});
