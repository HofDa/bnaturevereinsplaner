import { createHash, randomUUID } from 'node:crypto';
import { and, or, eq, inArray, desc, count, sql, lt, gte } from 'drizzle-orm';
import { z } from 'zod';
import { schema as s, type Database, type Executor } from '@bnature/db';
import {
  can,
  mailPreviewItemSchema,
  type MailRequest,
  type MailPreview,
  type MailPreviewItem,
  type MailKind,
  type Permission,
  type MailSettings,
} from '@bnature/contracts';
import { HttpError, type Access } from '../middleware/access';
import type { Config } from '../plugins/config';
import { audit } from '../services/audit';
import { financialOperation, readSnapshot, canonicalJson } from './finance/operations';
import { businessDate, getAssessment } from './finance/service';
import { feeReminderMail, eventInvitationMail } from './mail-templates';

export const mailPermission = (kind: MailKind): Permission =>
  kind === 'fee_reminder' ? 'finance:write' : 'mail:invite';
export function requireMailPermission(a: Access, kind: MailKind) {
  if (!can(a.role, mailPermission(kind)))
    throw new HttpError(403, 'FORBIDDEN', 'Keine Berechtigung für diesen Versand.');
}
export async function getMailSettings(db: Executor, org: string): Promise<MailSettings> {
  const [row] = await db
    .select()
    .from(s.mailSettings)
    .where(eq(s.mailSettings.organizationId, org));
  return {
    automaticFeeReminders: row?.automaticFeeReminders ?? false,
    reminderIntervalDays: row?.reminderIntervalDays ?? 14,
    lastRunOn: row?.lastRunOn ?? null,
  };
}
export function updateMailSettings(
  db: Database,
  a: Access,
  key: string,
  input: Omit<MailSettings, 'lastRunOn'>,
) {
  return financialOperation(db, a, key, 'mail:settings', input, 'users:manage', async (tx) => {
    await tx
      .insert(s.mailSettings)
      .values({ organizationId: a.organizationId, ...input, enabledBy: a.userId })
      .onConflictDoUpdate({
        target: s.mailSettings.organizationId,
        set: { ...input, enabledBy: a.userId, lastRunOn: null },
      });
    await audit(tx, a, 'update', 'mail_settings', a.organizationId, [
      'automaticFeeReminders',
      'reminderIntervalDays',
    ]);
    return { ...input, lastRunOn: null };
  });
}

type Candidate = MailPreviewItem & { dedupeKey: string };
const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
async function candidates(
  db: Executor,
  org: string,
  request: MailRequest,
  config: Config,
  only?: { sourceId: string; personId: string },
) {
  const [organization] = await db.select().from(s.organizations).where(eq(s.organizations.id, org));
  if (!organization) throw new HttpError(404, 'NOT_FOUND', 'Organisation nicht gefunden.');
  const people = await db
    .select({
      person: s.persons,
      membershipId: s.memberships.id,
      hasAccount: sql<boolean>`exists(select 1 from person_user_links pl join organization_user_roles r on r.organization_id=pl.organization_id and r.user_id=pl.user_id where pl.organization_id=${org} and pl.person_id=${s.persons.id})`,
    })
    .from(s.persons)
    .innerJoin(
      s.memberships,
      and(eq(s.memberships.organizationId, org), eq(s.memberships.personId, s.persons.id)),
    )
    .where(
      and(
        eq(s.persons.organizationId, org),
        eq(s.memberships.status, 'active'),
        only ? eq(s.persons.id, only.personId) : undefined,
      ),
    );
  const skipped = { invalidEmail: 0, noAccount: 0, recentlyContacted: 0 };
  const items: Candidate[] = [];
  const today = await businessDate(db, org);
  const add = (
    person: typeof s.persons.$inferSelect,
    sourceId: string,
    content: { subject: string; text: string },
  ) => {
    const recipient = person.email.trim().toLowerCase();
    if (!z.email().safeParse(recipient).success) {
      skipped.invalidEmail++;
      return;
    }
    const name = `${person.firstName} ${person.lastName}`;
    items.push({
      personId: person.id,
      sourceId,
      recipient,
      name,
      language: person.preferredLanguage,
      ...content,
      dedupeKey:
        request.kind === 'fee_reminder'
          ? `fee:${sourceId}:${today}`
          : `event:${sourceId}:${person.id}:${digest(content)}`,
    });
  };
  if (request.kind === 'fee_reminder') {
    const assessments = await db
      .select({
        id: s.membershipFeeAssessments.id,
        membershipId: s.membershipFeeAssessments.membershipId,
      })
      .from(s.membershipFeeAssessments)
      .where(
        and(
          eq(s.membershipFeeAssessments.organizationId, org),
          lt(s.membershipFeeAssessments.dueDate, today),
          only ? eq(s.membershipFeeAssessments.id, only.sourceId) : undefined,
        ),
      );
    const byMember = new Map(people.map((row) => [row.membershipId, row.person]));
    for (const row of assessments) {
      const person = byMember.get(row.membershipId);
      if (!person) continue;
      const assessment = await getAssessment(db, org, row.id, today);
      if (!assessment.overdue || assessment.openCents <= 0) continue;
      add(
        person,
        row.id,
        feeReminderMail({
          language: person.preferredLanguage,
          organization: organization.name,
          name: `${person.firstName} ${person.lastName}`,
          plan: assessment.planName,
          amountCents: assessment.openCents,
          dueDate: assessment.dueDate,
        }),
      );
    }
  } else {
    const [event] = await db
      .select()
      .from(s.eventOccurrences)
      .where(
        and(eq(s.eventOccurrences.organizationId, org), eq(s.eventOccurrences.id, request.eventId)),
      );
    if (!event) throw new HttpError(404, 'NOT_FOUND', 'Veranstaltung nicht gefunden.');
    if (
      event.status !== 'published' ||
      event.visibility === 'internal' ||
      event.startAt <= new Date() ||
      (event.registrationDeadline && event.registrationDeadline <= new Date())
    )
      throw new HttpError(
        409,
        'MAIL_EVENT_UNAVAILABLE',
        'Nur kommende veröffentlichte Veranstaltungen können eingeladen werden.',
      );
    const registrations = await db
      .select({ personId: s.eventRegistrations.personId })
      .from(s.eventRegistrations)
      .where(
        and(
          eq(s.eventRegistrations.organizationId, org),
          eq(s.eventRegistrations.eventOccurrenceId, event.id),
          inArray(s.eventRegistrations.status, ['registered', 'waitlisted']),
        ),
      );
    const registered = new Set(registrations.map((r) => r.personId));
    for (const { person, hasAccount } of people) {
      if (registered.has(person.id)) continue;
      if (!hasAccount) {
        skipped.noAccount++;
        continue;
      }
      add(
        person,
        event.id,
        eventInvitationMail({
          language: person.preferredLanguage,
          organization: organization.name,
          name: `${person.firstName} ${person.lastName}`,
          title: event.titleI18n[person.preferredLanguage],
          startAt: event.startAt,
          endAt: event.endAt,
          timezone: event.timezone,
          location: event.location,
          appUrl: config.APP_URL,
          eventId: event.id,
        }),
      );
    }
  }
  return { items, skipped };
}
async function buildPreview(
  db: Executor,
  org: string,
  request: MailRequest,
  config: Config,
): Promise<MailPreview> {
  const { items, skipped } = await candidates(db, org, request, config);
  const settings = await getMailSettings(db, org);
  const since = new Date(Date.now() - settings.reminderIntervalDays * 86_400_000);
  const previous = await db
    .select()
    .from(s.mailMessages)
    .where(
      and(
        eq(s.mailMessages.organizationId, org),
        eq(s.mailMessages.kind, request.kind),
        request.kind === 'fee_reminder'
          ? or(
              gte(
                sql<Date>`coalesce(${s.mailMessages.sentAt}, ${s.mailMessages.attemptedAt}, ${s.mailMessages.createdAt})`,
                since,
              ),
              inArray(s.mailMessages.state, ['queued', 'sending', 'uncertain']),
            )
          : eq(s.mailMessages.eventId, request.eventId),
      ),
    );
  const recentKeys = new Set(previous.map((r) => r.dedupeKey));
  const recentAssessments = new Set(previous.map((r) => r.assessmentId));
  const eligible = items
    .filter((item) => {
      const recent =
        recentKeys.has(item.dedupeKey) ||
        (request.kind === 'fee_reminder' && recentAssessments.has(item.sourceId));
      if (recent) skipped.recentlyContacted++;
      return !recent;
    })
    .sort((a, b) => a.personId.localeCompare(b.personId) || a.sourceId.localeCompare(b.sourceId));
  if (eligible.length > 250)
    throw new HttpError(
      422,
      'MAIL_TOO_MANY',
      'Dieser Versand unterstützt höchstens 250 Nachrichten.',
    );
  return {
    request,
    items: eligible.map((item) => mailPreviewItemSchema.parse(item)),
    skipped,
    hash: digest({ request, items: eligible, skipped }),
  };
}
export async function previewMail(db: Database, a: Access, request: MailRequest, config: Config) {
  requireMailPermission(a, request.kind);
  return readSnapshot(db, (tx) => buildPreview(tx, a.organizationId, request, config));
}
export async function enqueuePreview(
  db: Database,
  a: Access,
  key: string,
  request: MailRequest,
  hash: string,
  config: Config,
) {
  if (config.EMAIL_MODE === 'disabled')
    throw new HttpError(409, 'MAIL_DISABLED', 'Der E-Mail-Versand ist noch nicht eingerichtet.');
  return financialOperation(
    db,
    a,
    key,
    'mail:enqueue',
    { request, hash },
    mailPermission(request.kind),
    async (tx) => {
      const preview = await buildPreview(tx, a.organizationId, request, config);
      if (preview.hash !== hash)
        throw new HttpError(
          409,
          'MAIL_PREVIEW_CHANGED',
          'Die Empfängerliste hat sich geändert. Bitte die Vorschau erneut prüfen.',
        );
      return queueItems(tx, a, preview);
    },
  );
}
async function queueItems(
  tx: Executor,
  a: Pick<Access, 'organizationId' | 'userId'>,
  preview: MailPreview,
) {
  const { request } = preview;
  const today = await businessDate(tx, a.organizationId);
  for (const item of preview.items)
    await tx.insert(s.mailMessages).values({
      organizationId: a.organizationId,
      kind: request.kind,
      personId: item.personId,
      assessmentId: request.kind === 'fee_reminder' ? item.sourceId : null,
      eventId: request.kind === 'event_invitation' ? item.sourceId : null,
      actorUserId: a.userId,
      recipient: item.recipient,
      language: item.language,
      subject: item.subject,
      body: item.text,
      dedupeKey:
        request.kind === 'fee_reminder'
          ? `fee:${item.sourceId}:${today}`
          : `event:${item.sourceId}:${item.personId}:${digest({ subject: item.subject, text: item.text })}`,
    });
  const batchId = randomUUID();
  await audit(tx, a, 'queue', 'mail_batch', batchId, ['kind', 'recipients']);
  return { queued: preview.items.length, batchId };
}
export async function listMail(db: Database, a: Access, page: number) {
  const kinds: MailKind[] = [];
  if (can(a.role, 'finance:read')) kinds.push('fee_reminder');
  if (can(a.role, 'mail:invite')) kinds.push('event_invitation');
  if (!kinds.length) throw new HttpError(403, 'FORBIDDEN', 'Keine Berechtigung.');
  const where = and(
    eq(s.mailMessages.organizationId, a.organizationId),
    inArray(s.mailMessages.kind, kinds),
  );
  const rows = await db
    .select()
    .from(s.mailMessages)
    .where(where)
    .orderBy(desc(s.mailMessages.createdAt), desc(s.mailMessages.id))
    .limit(20)
    .offset((page - 1) * 20);
  const [total] = await db.select({ n: count() }).from(s.mailMessages).where(where);
  return {
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      recipient: r.recipient,
      subject: r.subject,
      text: r.body,
      state: r.state,
      createdAt: r.createdAt.toISOString(),
      sentAt: r.sentAt?.toISOString() ?? null,
      errorCode: r.errorCode,
    })),
    total: total?.n ?? 0,
    page,
    pageSize: 20,
  };
}
export async function revalidateMail(
  db: Executor,
  row: typeof s.mailMessages.$inferSelect,
  config: Config,
) {
  const [actor] = await db
    .select({ role: s.organizationUserRoles.role })
    .from(s.organizationUserRoles)
    .where(
      and(
        eq(s.organizationUserRoles.organizationId, row.organizationId),
        eq(s.organizationUserRoles.userId, row.actorUserId),
      ),
    );
  if (!actor || !can(actor.role, mailPermission(row.kind))) return false;
  try {
    const result = await candidates(
      db,
      row.organizationId,
      row.kind === 'fee_reminder'
        ? { kind: 'fee_reminder' }
        : { kind: 'event_invitation', eventId: row.eventId! },
      config,
      { sourceId: row.assessmentId ?? row.eventId!, personId: row.personId },
    );
    const current = result.items[0];
    return (
      !!current &&
      current.recipient === row.recipient &&
      current.subject === row.subject &&
      current.text === row.body
    );
  } catch (error) {
    if (error instanceof HttpError && [404, 409].includes(error.status)) return false;
    throw error;
  }
}

export async function enqueueAutomaticMail(db: Database, config: Config) {
  if (config.EMAIL_MODE === 'disabled') return;
  const settings = await db
    .select()
    .from(s.mailSettings)
    .where(eq(s.mailSettings.automaticFeeReminders, true));
  for (const setting of settings) {
    const today = await businessDate(db, setting.organizationId);
    if (setting.lastRunOn === today) continue;
    // Recheck the switch under the same organization lock as manual writers.
    await db.transaction(async (tx) => {
      await tx
        .select()
        .from(s.organizations)
        .where(eq(s.organizations.id, setting.organizationId))
        .for('no key update');
      const [current] = await tx
        .select()
        .from(s.mailSettings)
        .where(eq(s.mailSettings.organizationId, setting.organizationId));
      const [role] = await tx
        .select()
        .from(s.organizationUserRoles)
        .where(
          and(
            eq(s.organizationUserRoles.organizationId, setting.organizationId),
            eq(s.organizationUserRoles.userId, setting.enabledBy),
          ),
        );
      if (
        !current?.automaticFeeReminders ||
        current.enabledBy !== setting.enabledBy ||
        role?.role !== 'admin' ||
        current.lastRunOn === today
      )
        return;
      const preview = await buildPreview(
        tx,
        setting.organizationId,
        { kind: 'fee_reminder' },
        config,
      );
      if (preview.items.length)
        await queueItems(
          tx,
          { organizationId: setting.organizationId, userId: setting.enabledBy },
          preview,
        );
      await tx
        .update(s.mailSettings)
        .set({ lastRunOn: today })
        .where(eq(s.mailSettings.organizationId, setting.organizationId));
    });
  }
}
