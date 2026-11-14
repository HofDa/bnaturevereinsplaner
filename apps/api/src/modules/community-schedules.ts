import { and, asc, desc, count, eq, inArray, sql } from 'drizzle-orm';
import { schema as s, type Database, type Executor } from '@bnature/db';
import {
  bestSlots,
  can,
  type ScheduleAnswer,
  type ScheduleDetail,
  type ScheduleInput,
  type ScheduleSummary,
} from '@bnature/contracts';
import { HttpError, type Access } from '../middleware/access';
import { audit } from '../services/audit';
import { financialOperation, readSnapshot } from './finance/operations';
import { currentAccess, groupAccess } from './community';
import { eventInputSchema, eventLocal } from '@bnature/contracts';
import { eventWrite } from './events-operations';
import { validateEvent } from './events';

const sc = s.communitySchedules,
  sl = s.communityScheduleSlots,
  an = s.communityScheduleAnswers;
const manager = (a: Access) => can(a.role, 'community:manage');
/** Club organizers: whoever manages community content or events (incl. project leads). */
export const canCreateSchedule = (a: Access) => manager(a) || can(a.role, 'events:write');

/** Same audience rule as news and polls: club-wide, or an active group of the own person. */
function visible(a: Access) {
  return and(
    eq(sc.organizationId, a.organizationId),
    manager(a)
      ? undefined
      : sql`${sc.state}<>'archived' and (${sc.groupId} is null or ${sc.createdBy}=${a.userId} or exists(select 1 from groups g join group_members gm on gm.organization_id=g.organization_id and gm.group_id=g.id join person_user_links pl on pl.organization_id=gm.organization_id and pl.person_id=gm.person_id where g.organization_id=${a.organizationId} and g.id=${sc.groupId} and g.active=true and pl.user_id=${a.userId}))`,
  );
}
const isOpen = (row: typeof sc.$inferSelect) =>
  row.state === 'open' && (!row.closesAt || row.closesAt.getTime() > Date.now());

async function summaries(
  db: Executor,
  a: Access,
  rows: { row: typeof sc.$inferSelect; author: string; groupName: string | null }[],
): Promise<ScheduleSummary[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.row.id);
  const slotCounts = await db
    .select({ scheduleId: sl.scheduleId, n: sql<number>`count(*)::int` })
    .from(sl)
    .where(and(eq(sl.organizationId, a.organizationId), inArray(sl.scheduleId, ids)))
    .groupBy(sl.scheduleId);
  const participants = await db
    .select({
      scheduleId: an.scheduleId,
      n: sql<number>`count(distinct ${an.userId})::int`,
      mine: sql<boolean>`bool_or(${an.userId}=${a.userId})`,
    })
    .from(an)
    .where(and(eq(an.organizationId, a.organizationId), inArray(an.scheduleId, ids)))
    .groupBy(an.scheduleId);
  const finalIds = rows.flatMap((r) => (r.row.finalSlotId ? [r.row.finalSlotId] : []));
  const finals = finalIds.length
    ? await db
        .select({ id: sl.id, startAt: sl.startAt, endAt: sl.endAt })
        .from(sl)
        .where(and(eq(sl.organizationId, a.organizationId), inArray(sl.id, finalIds)))
    : [];
  return rows.map(({ row, author, groupName }) => {
    const p = participants.find((x) => x.scheduleId === row.id);
    const final = finals.find((f) => f.id === row.finalSlotId);
    return {
      id: row.id,
      titleI18n: row.titleI18n,
      groupId: row.groupId,
      groupName,
      location: row.location,
      state: row.state,
      isOpen: isOpen(row),
      closesAt: row.closesAt?.toISOString() ?? null,
      slotCount: slotCounts.find((x) => x.scheduleId === row.id)?.n ?? 0,
      participantCount: p?.n ?? 0,
      answered: !!p?.mine,
      finalSlot: final
        ? { startAt: final.startAt.toISOString(), endAt: final.endAt.toISOString() }
        : null,
      authorName: author,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

function projection(db: Executor) {
  return db
    .select({ row: sc, author: s.user.name, groupName: s.groups.name })
    .from(sc)
    .innerJoin(s.user, eq(s.user.id, sc.createdBy))
    .leftJoin(
      s.groups,
      and(eq(s.groups.organizationId, sc.organizationId), eq(s.groups.id, sc.groupId)),
    );
}

export function listSchedules(
  db: Database,
  access: Access,
  state: 'open' | 'closed',
  page = 1,
  pageSize = 50,
  groupId?: string,
) {
  return readSnapshot(db, async (tx) => {
    const a = await currentAccess(tx, access);
    const where = and(
      visible(a),
      state === 'open' ? eq(sc.state, 'open') : sql`${sc.state}<>'open'`,
      groupId ? eq(sc.groupId, groupId) : undefined,
    );
    const [total] = await tx.select({ n: count() }).from(sc).where(where);
    const rows = await projection(tx)
      .where(where)
      .orderBy(desc(sc.createdAt), asc(sc.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return { items: await summaries(tx, a, rows), total: total!.n, page, pageSize };
  });
}

async function scheduleRow(db: Executor, a: Access, id: string) {
  const [row] = await projection(db).where(and(visible(a), eq(sc.id, id)));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Terminfindung nicht gefunden.');
  return row;
}

export function getSchedule(db: Database, access: Access, id: string): Promise<ScheduleDetail> {
  return readSnapshot(db, async (tx) => {
    const a = await currentAccess(tx, access);
    const found = await scheduleRow(tx, a, id);
    const [summary] = await summaries(tx, a, [found]);
    const slots = await tx
      .select()
      .from(sl)
      .where(and(eq(sl.organizationId, a.organizationId), eq(sl.scheduleId, id)))
      .orderBy(asc(sl.position));
    const answers = await tx
      .select({ slotId: an.slotId, userId: an.userId, answer: an.answer, name: s.user.name })
      .from(an)
      .innerJoin(s.user, eq(s.user.id, an.userId))
      .where(and(eq(an.organizationId, a.organizationId), eq(an.scheduleId, id)));
    const count = (slotId: string, answer: ScheduleAnswer) =>
      answers.filter((x) => x.slotId === slotId && x.answer === answer).length;
    const slotViews = slots.map((slot) => ({
      id: slot.id,
      startAt: slot.startAt.toISOString(),
      endAt: slot.endAt.toISOString(),
      yes: count(slot.id, 'yes'),
      maybe: count(slot.id, 'maybe'),
      no: count(slot.id, 'no'),
      mine: answers.find((x) => x.slotId === slot.id && x.userId === a.userId)?.answer ?? null,
    }));
    const people = new Map<string, { name: string; answers: Record<string, ScheduleAnswer> }>();
    for (const x of answers) {
      const entry = people.get(x.userId) ?? { name: x.name, answers: {} };
      entry.answers[x.slotId] = x.answer;
      people.set(x.userId, entry);
    }
    return {
      ...summary!,
      descriptionI18n: found.row.descriptionI18n,
      version: found.row.version,
      slots: slotViews,
      bestSlotIds: bestSlots(slotViews),
      finalSlotId: found.row.finalSlotId,
      eventId: found.row.eventId,
      participants: [...people.values()].sort((x, y) => x.name.localeCompare(y.name)),
      canManage: manager(a) || found.row.createdBy === a.userId,
    };
  });
}

export function createSchedule(db: Database, access: Access, key: string, input: ScheduleInput) {
  return financialOperation(
    db,
    access,
    key,
    'community:schedule:create',
    input,
    'community:read',
    async (tx) => {
      const a = await currentAccess(tx, access);
      if (!canCreateSchedule(a))
        throw new HttpError(403, 'FORBIDDEN', 'Keine Berechtigung für Terminfindungen.');
      if (input.groupId) await groupAccess(tx, a, input.groupId);
      if (input.closesAt && Date.parse(input.closesAt) <= Date.now())
        throw new HttpError(409, 'DEADLINE_PASSED', 'Die Frist liegt in der Vergangenheit.');
      const [row] = await tx
        .insert(sc)
        .values({
          organizationId: a.organizationId,
          groupId: input.groupId,
          titleI18n: input.titleI18n,
          descriptionI18n: input.descriptionI18n,
          location: input.location,
          closesAt: input.closesAt ? new Date(input.closesAt) : null,
          createdBy: a.userId,
        })
        .returning({ id: sc.id });
      const ordered = [...input.slots].sort(
        (x, y) => Date.parse(x.startAt) - Date.parse(y.startAt),
      );
      await tx.insert(sl).values(
        ordered.map((slot, position) => ({
          organizationId: a.organizationId,
          scheduleId: row!.id,
          startAt: new Date(slot.startAt),
          endAt: new Date(slot.endAt),
          position,
        })),
      );
      await audit(tx, a, 'create', 'community_schedule', row!.id, ['titleI18n', 'slots']);
      return { id: row!.id };
    },
  );
}

/** Sets the own answer per slot; slots left out keep their previous answer. */
export function answerSchedule(
  db: Database,
  access: Access,
  key: string,
  id: string,
  input: { answers: { slotId: string; answer: ScheduleAnswer }[] },
) {
  return financialOperation(
    db,
    access,
    key,
    `community:schedule:answer:${id}`,
    input,
    'community:vote',
    async (tx) => {
      const a = await currentAccess(tx, access);
      const { row } = await scheduleRow(tx, a, id);
      if (row.groupId) await groupAccess(tx, a, row.groupId);
      if (!isOpen(row))
        throw new HttpError(409, 'SCHEDULE_CLOSED', 'Die Terminfindung ist abgeschlossen.');
      const slotIds = new Set(
        (
          await tx
            .select({ id: sl.id })
            .from(sl)
            .where(and(eq(sl.organizationId, a.organizationId), eq(sl.scheduleId, id)))
        ).map((x) => x.id),
      );
      if (
        input.answers.some((x) => !slotIds.has(x.slotId)) ||
        new Set(input.answers.map((x) => x.slotId)).size !== input.answers.length
      )
        throw new HttpError(404, 'NOT_FOUND', 'Termin nicht gefunden.');
      for (const x of input.answers)
        await tx
          .insert(an)
          .values({
            organizationId: a.organizationId,
            scheduleId: id,
            slotId: x.slotId,
            userId: a.userId,
            answer: x.answer,
          })
          .onConflictDoUpdate({
            target: [an.slotId, an.userId],
            set: { answer: x.answer, updatedAt: new Date() },
          });
      await audit(tx, a, 'answer', 'community_schedule', id, ['answers']);
      return { id };
    },
  );
}

export function closeSchedule(
  db: Database,
  access: Access,
  key: string,
  id: string,
  input: { version: number; finalSlotId: string | null },
) {
  return financialOperation(
    db,
    access,
    key,
    `community:schedule:close:${id}`,
    input,
    'community:read',
    async (tx) => {
      const a = await currentAccess(tx, access);
      const { row } = await scheduleRow(tx, a, id);
      if (!manager(a) && row.createdBy !== a.userId)
        throw new HttpError(403, 'FORBIDDEN', 'Nur die organisierende Person kann abschließen.');
      if (row.version !== input.version || row.state !== 'open')
        throw new HttpError(409, 'CONFLICT', 'Die Terminfindung wurde bereits geändert.');
      if (input.finalSlotId) {
        const [slot] = await tx
          .select({ id: sl.id })
          .from(sl)
          .where(
            and(
              eq(sl.organizationId, a.organizationId),
              eq(sl.scheduleId, id),
              eq(sl.id, input.finalSlotId),
            ),
          );
        if (!slot) throw new HttpError(404, 'NOT_FOUND', 'Termin nicht gefunden.');
      }
      await tx
        .update(sc)
        .set({
          state: 'closed',
          closedAt: new Date(),
          finalSlotId: input.finalSlotId,
          version: row.version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(sc.organizationId, a.organizationId), eq(sc.id, id)));
      await audit(tx, a, 'close', 'community_schedule', id, ['state', 'finalSlotId']);
      return { id };
    },
  );
}

/**
 * Creates one event from the fixed slot of a closed scheduling poll (title, description,
 * location and times in club time) and links it, in one transaction.
 */
export function createEventFromSchedule(
  db: Database,
  access: Access,
  key: string,
  id: string,
  input: {
    categoryId: string;
    visibility: 'internal' | 'members' | 'public';
    status: 'draft' | 'published';
  },
) {
  return eventWrite(
    db,
    access,
    key,
    `community:schedule:event:${id}`,
    input,
    'events:write',
    async (tx, current) => {
      const { row } = await scheduleRow(tx, current, id);
      if (!manager(current) && row.createdBy !== current.userId)
        throw new HttpError(
          403,
          'FORBIDDEN',
          'Nur die organisierende Person kann eine Veranstaltung anlegen.',
        );
      if (row.state === 'open' || !row.finalSlotId)
        throw new HttpError(409, 'SCHEDULE_NOT_FIXED', 'Zuerst einen Termin festlegen.');
      if (row.eventId)
        throw new HttpError(409, 'EVENT_EXISTS', 'Die Veranstaltung wurde bereits angelegt.');
      const [slot] = await tx
        .select()
        .from(sl)
        .where(and(eq(sl.organizationId, current.organizationId), eq(sl.id, row.finalSlotId)));
      const [org] = await tx
        .select({ timezone: s.organizations.timezone })
        .from(s.organizations)
        .where(eq(s.organizations.id, current.organizationId));
      const timezone = org!.timezone;
      const eventInput = eventInputSchema.parse({
        titleI18n: row.titleI18n,
        descriptionI18n: row.descriptionI18n,
        categoryId: input.categoryId,
        startLocal: eventLocal(slot!.startAt.toISOString(), timezone).slice(0, 16),
        endLocal: eventLocal(slot!.endAt.toISOString(), timezone).slice(0, 16),
        timezone,
        location: row.location,
        status: input.status,
        visibility: input.visibility,
      });
      const values = await validateEvent(tx, current, eventInput);
      const [event] = await tx
        .insert(s.eventOccurrences)
        .values({ ...values, organizationId: current.organizationId, createdBy: current.userId })
        .returning({ id: s.eventOccurrences.id });
      const linked = await tx
        .update(sc)
        .set({ eventId: event!.id, version: row.version + 1, updatedAt: new Date() })
        .where(
          and(
            eq(sc.organizationId, current.organizationId),
            eq(sc.id, id),
            sql`${sc.eventId} is null`,
          ),
        )
        .returning({ id: sc.id });
      if (!linked.length)
        throw new HttpError(409, 'EVENT_EXISTS', 'Die Veranstaltung wurde bereits angelegt.');
      await audit(tx, current, 'create', 'event_occurrence', event!.id, ['fromSchedule']);
      await audit(tx, current, 'link', 'community_schedule', id, ['eventId']);
      return { id: event!.id };
    },
  );
}
