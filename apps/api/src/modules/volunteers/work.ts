import { assertResponsibleUser } from '../../middleware/access';
import { and, eq, inArray, sql, asc, desc, count, gte, lt, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { schema as s, type Database, type Executor, type Transaction } from '@bnature/db';
import {
  can,
  assignmentSchema,
  timeEntrySchema,
  netMinutes,
  formatMinutes,
  type VolunteerAssignment,
  type VolunteerTimeEntry,
  type assignmentInputSchema,
  type assignmentPatchSchema,
  type assignmentQuerySchema,
  type timeEntryInputSchema,
  type timeEntryCorrectionSchema,
  type timeEntryDecisionSchema,
  type timeEntryQuerySchema,
  type timeExportQuerySchema,
  localDate,
  csvCell,
} from '@bnature/contracts';
import type { z } from 'zod';
import { HttpError, currentAccess, type Access } from '../../middleware/access';
import { audit } from '../../services/audit';
import { financialOperation, readSnapshot } from '../finance/operations';
import { eventRow, ownPerson } from '../events';
import { renderPdf, organizationName } from '../finance/pdf';
import { wire } from '../responses';
import { ve, engagementRow, coverageAssessor } from './common';

const va = s.volunteerAssignments,
  te = s.volunteerTimeEntries,
  ev = s.eventOccurrences;
const responsible = alias(s.user, 'responsible_user');
const confirmer = alias(s.user, 'confirming_user');
const projectLead = (a: Access) => !can(a.role, 'volunteers:write');
// Project leads only see and plan work for events they manage.
const scopedEvents = (a: Access): SQL | undefined =>
  projectLead(a)
    ? sql`exists(select 1 from event_occurrences e where e.organization_id="volunteer_assignments"."organization_id" and e.id="volunteer_assignments"."event_occurrence_id" and (e.organizer_id=${a.userId} or e.created_by=${a.userId}))`
    : undefined;
function assignmentProjection(db: Executor) {
  return db
    .select({
      id: va.id,
      engagementId: va.engagementId,
      personId: ve.personId,
      volunteerName: sql<string>`${s.persons.firstName}||' '||${s.persons.lastName}`,
      volunteerType: ve.volunteerType,
      eventOccurrenceId: va.eventOccurrenceId,
      eventTitleI18n: ev.titleI18n,
      role: va.role,
      task: va.task,
      plannedStart: va.plannedStart,
      plannedEnd: va.plannedEnd,
      responsibleUserId: va.responsibleUserId,
      responsibleName: responsible.name,
      project: va.project,
      status: va.status,
      version: va.version,
    })
    .from(va)
    .innerJoin(ve, and(eq(ve.organizationId, va.organizationId), eq(ve.id, va.engagementId)))
    .innerJoin(
      s.persons,
      and(eq(s.persons.organizationId, ve.organizationId), eq(s.persons.id, ve.personId)),
    )
    .leftJoin(ev, and(eq(ev.organizationId, va.organizationId), eq(ev.id, va.eventOccurrenceId)))
    .leftJoin(responsible, eq(responsible.id, va.responsibleUserId));
}
async function presentAssignments(
  db: Executor,
  a: Access,
  rows: Awaited<ReturnType<ReturnType<typeof assignmentProjection>['where']>>,
): Promise<VolunteerAssignment[]> {
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.engagementId))];
  const engagements = new Map(
    (
      await db
        .select()
        .from(ve)
        .where(and(eq(ve.organizationId, a.organizationId), inArray(ve.id, ids)))
    ).map((e) => [e.id, e]),
  );
  const assess = await coverageAssessor(db, a.organizationId, ids);
  return rows.map((row) => {
    const engagement = engagements.get(row.engagementId);
    if (!engagement) throw new HttpError(404, 'NOT_FOUND', 'Freiwilligeneinsatz nicht gefunden.');
    const coverageStatus = assess(engagement, localDate(row.plannedStart)).status;
    return assignmentSchema.parse({ ...wire(row), coverageStatus });
  });
}
export async function getAssignment(db: Executor, a: Access, id: string) {
  const rows = await assignmentProjection(db).where(
    and(eq(va.organizationId, a.organizationId), eq(va.id, id), scopedEvents(a)),
  );
  if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Einsatz nicht gefunden.');
  return (await presentAssignments(db, a, rows))[0]!;
}
export async function listAssignments(
  db: Database,
  a: Access,
  q: z.infer<typeof assignmentQuerySchema>,
) {
  return readSnapshot(db, async (tx) => {
    const where = and(
      eq(va.organizationId, a.organizationId),
      scopedEvents(a),
      q.engagementId ? eq(va.engagementId, q.engagementId) : undefined,
      q.eventOccurrenceId ? eq(va.eventOccurrenceId, q.eventOccurrenceId) : undefined,
      q.status ? eq(va.status, q.status) : undefined,
      q.from ? gte(va.plannedStart, new Date(`${q.from}T00:00:00Z`)) : undefined,
      q.to ? lt(va.plannedStart, new Date(Date.parse(`${q.to}T00:00:00Z`) + 86400000)) : undefined,
    );
    const rows = await assignmentProjection(tx)
      .where(where)
      .orderBy(asc(va.plannedStart), asc(va.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [total] = await tx.select({ n: count() }).from(va).where(where);
    return {
      items: await presentAssignments(tx, a, rows),
      total: total?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  });
}

async function assertEventScope(tx: Transaction, a: Access, eventId: string | null) {
  if (eventId) {
    await eventRow(tx, a, eventId, true);
    return;
  }
  if (projectLead(a))
    throw new HttpError(
      403,
      'FORBIDDEN',
      'Projektleitungen planen Einsätze nur zu eigenen Veranstaltungen.',
    );
}
async function assertOverlapFree(
  tx: Transaction,
  a: Access,
  engagementId: string,
  start: string,
  end: string,
  exceptId: string | null,
) {
  const [clash] = await tx
    .select({ id: va.id })
    .from(va)
    .where(
      and(
        eq(va.organizationId, a.organizationId),
        eq(va.engagementId, engagementId),
        sql`${va.status}<>'cancelled'`,
        exceptId ? sql`${va.id}<>${exceptId}` : undefined,
        sql`tstzrange(${va.plannedStart},${va.plannedEnd}) && tstzrange(${start}::timestamptz,${end}::timestamptz)`,
      ),
    );
  if (clash)
    throw new HttpError(
      409,
      'ASSIGNMENT_OVERLAP',
      'Der Einsatz überschneidet sich mit einem anderen.',
    );
}
const assignmentResult =
  (db: Database, a: Access) => async (r: { data: { id: string }; replayed: boolean }) => ({
    data: await getAssignment(db, a, r.data.id),
    replayed: r.replayed,
  });
export function createAssignment(
  db: Database,
  a: Access,
  key: string,
  input: z.infer<typeof assignmentInputSchema>,
) {
  return financialOperation(
    db,
    a,
    key,
    'volunteer-assignments:create',
    input,
    'volunteers:assign',
    async (tx) => {
      const current = await currentAccess(tx, a);
      await assertEventScope(tx, current, input.eventOccurrenceId);
      const engagement = await engagementRow(tx, current, input.engagementId, true);
      if (engagement.status !== 'active')
        throw new HttpError(
          409,
          'VOLUNTEER_NOT_ACTIVE',
          'Nur aktive Freiwillige können eingeplant werden.',
        );
      if (input.plannedStart.slice(0, 10) < engagement.startedOn)
        throw new HttpError(409, 'ASSIGNMENT_BEFORE_START', 'Der Einsatz liegt vor dem Eintritt.');
      if (input.eventOccurrenceId) {
        const [duplicate] = await tx
          .select({ id: va.id })
          .from(va)
          .where(
            and(
              eq(va.organizationId, a.organizationId),
              eq(va.engagementId, input.engagementId),
              eq(va.eventOccurrenceId, input.eventOccurrenceId),
              sql`${va.status}<>'cancelled'`,
            ),
          );
        if (duplicate)
          throw new HttpError(
            409,
            'ASSIGNMENT_EXISTS',
            'Diese Person ist für die Veranstaltung bereits eingeplant.',
          );
      }
      await assertResponsibleUser(tx, current, input.responsibleUserId);
      await assertOverlapFree(
        tx,
        current,
        input.engagementId,
        input.plannedStart,
        input.plannedEnd,
        null,
      );
      const [row] = await tx
        .insert(va)
        .values({
          ...input,
          plannedStart: new Date(input.plannedStart),
          plannedEnd: new Date(input.plannedEnd),
          organizationId: a.organizationId,
          createdBy: a.userId,
        })
        .returning({ id: va.id });
      await audit(tx, a, 'create', 'volunteer_assignment', row!.id, Object.keys(input));
      return { id: row!.id };
    },
  ).then(assignmentResult(db, a));
}
export function updateAssignment(
  db: Database,
  a: Access,
  key: string,
  id: string,
  input: z.infer<typeof assignmentPatchSchema>,
) {
  return financialOperation(
    db,
    a,
    key,
    `volunteer-assignments:update:${id}`,
    input,
    'volunteers:assign',
    async (tx) => {
      const current = await currentAccess(tx, a);
      const [row] = await tx
        .select()
        .from(va)
        .where(and(eq(va.organizationId, a.organizationId), eq(va.id, id), scopedEvents(current)))
        .for('update');
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Einsatz nicht gefunden.');
      await assertEventScope(tx, current, row.eventOccurrenceId);
      if (row.version !== input.version)
        throw new HttpError(409, 'STALE_VERSION', 'Der Einsatz wurde zwischenzeitlich geändert.');
      if (row.status === 'cancelled')
        throw new HttpError(409, 'ASSIGNMENT_CANCELLED', 'Abgesagte Einsätze sind abgeschlossen.');
      const { version, plannedStart, plannedEnd, ...patch } = input;
      const start = plannedStart ?? row.plannedStart.toISOString(),
        end = plannedEnd ?? row.plannedEnd.toISOString();
      if (Date.parse(end) <= Date.parse(start))
        throw new HttpError(422, 'VALIDATION_ERROR', 'Das Ende liegt vor dem Beginn.');
      if (patch.responsibleUserId !== undefined)
        await assertResponsibleUser(tx, current, patch.responsibleUserId);
      if ((patch.status ?? row.status) !== 'cancelled')
        await assertOverlapFree(tx, current, row.engagementId, start, end, id);
      await tx
        .update(va)
        .set({
          ...patch,
          plannedStart: new Date(start),
          plannedEnd: new Date(end),
          version: version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(va.organizationId, a.organizationId), eq(va.id, id)));
      await audit(
        tx,
        a,
        'update',
        'volunteer_assignment',
        id,
        Object.keys(input).filter((k) => k !== 'version'),
      );
      return { id };
    },
  ).then(assignmentResult(db, a));
}

function timeProjection(db: Executor) {
  return db
    .select({
      id: te.id,
      engagementId: te.engagementId,
      volunteerName: sql<string>`${s.persons.firstName}||' '||${s.persons.lastName}`,
      assignmentId: te.assignmentId,
      eventTitleI18n: ev.titleI18n,
      actualStart: te.actualStart,
      actualEnd: te.actualEnd,
      breakMinutes: te.breakMinutes,
      minutes: te.minutes,
      description: te.description,
      project: te.project,
      status: te.status,
      source: te.source,
      confirmedByName: confirmer.name,
      confirmedAt: te.confirmedAt,
      version: te.version,
    })
    .from(te)
    .innerJoin(ve, and(eq(ve.organizationId, te.organizationId), eq(ve.id, te.engagementId)))
    .innerJoin(
      s.persons,
      and(eq(s.persons.organizationId, ve.organizationId), eq(s.persons.id, ve.personId)),
    )
    .leftJoin(va, and(eq(va.organizationId, te.organizationId), eq(va.id, te.assignmentId)))
    .leftJoin(ev, and(eq(ev.organizationId, va.organizationId), eq(ev.id, va.eventOccurrenceId)))
    .leftJoin(confirmer, eq(confirmer.id, te.confirmedBy));
}
function timeWhere(a: Access, q: Omit<z.infer<typeof timeEntryQuerySchema>, 'page' | 'pageSize'>) {
  return and(
    eq(te.organizationId, a.organizationId),
    projectLead(a)
      ? sql`exists(select 1 from volunteer_assignments x join event_occurrences e on e.organization_id=x.organization_id and e.id=x.event_occurrence_id where x.organization_id="volunteer_time_entries"."organization_id" and x.id="volunteer_time_entries"."assignment_id" and (e.organizer_id=${a.userId} or e.created_by=${a.userId}))`
      : undefined,
    q.engagementId ? eq(te.engagementId, q.engagementId) : undefined,
    q.status ? eq(te.status, q.status) : undefined,
    q.project ? eq(te.project, q.project) : undefined,
    q.from ? gte(te.actualStart, new Date(`${q.from}T00:00:00Z`)) : undefined,
    q.to ? lt(te.actualStart, new Date(Date.parse(`${q.to}T00:00:00Z`) + 86400000)) : undefined,
  );
}
export async function getTimeEntry(
  db: Executor,
  a: Access,
  id: string,
): Promise<VolunteerTimeEntry> {
  const [row] = await timeProjection(db).where(and(timeWhere(a, {}), eq(te.id, id)));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Zeiteintrag nicht gefunden.');
  const history = await db
    .select({
      version: s.volunteerTimeEntryHistory.version,
      action: s.volunteerTimeEntryHistory.action,
      reason: s.volunteerTimeEntryHistory.reason,
      previous: s.volunteerTimeEntryHistory.previous,
      actorName: s.user.name,
      createdAt: s.volunteerTimeEntryHistory.createdAt,
    })
    .from(s.volunteerTimeEntryHistory)
    .leftJoin(s.user, eq(s.user.id, s.volunteerTimeEntryHistory.actorUserId))
    .where(
      and(
        eq(s.volunteerTimeEntryHistory.organizationId, a.organizationId),
        eq(s.volunteerTimeEntryHistory.timeEntryId, id),
      ),
    )
    .orderBy(asc(s.volunteerTimeEntryHistory.version));
  return timeEntrySchema.parse({ ...wire(row), history: history.map((h) => wire(h)) });
}
export async function listTimeEntries(
  db: Database,
  a: Access,
  q: z.infer<typeof timeEntryQuerySchema>,
) {
  return readSnapshot(db, async (tx) => {
    const where = timeWhere(a, q);
    const rows = await timeProjection(tx)
      .where(where)
      .orderBy(desc(te.actualStart), asc(te.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [totals] = await tx
      .select({
        entries: count(),
        confirmedMinutes: sql<number>`coalesce(sum(${te.minutes}) filter (where ${te.status}='confirmed'),0)::int`,
        pendingMinutes: sql<number>`coalesce(sum(${te.minutes}) filter (where ${te.status} in ('draft','submitted')),0)::int`,
      })
      .from(te)
      .where(where);
    return {
      items: rows.map((row) => timeEntrySchema.parse(wire(row))),
      total: totals?.entries ?? 0,
      page: q.page,
      pageSize: q.pageSize,
      totals: totals!,
    };
  });
}
async function assignmentScope(
  tx: Transaction,
  a: Access,
  assignmentId: string | null,
  engagementId: string,
) {
  if (!assignmentId) {
    if (projectLead(a))
      throw new HttpError(
        403,
        'FORBIDDEN',
        'Projektleitungen erfassen Stunden nur zu eigenen Einsätzen.',
      );
    return null;
  }
  const [row] = await tx
    .select()
    .from(va)
    .where(and(eq(va.organizationId, a.organizationId), eq(va.id, assignmentId)));
  if (!row || row.engagementId !== engagementId)
    throw new HttpError(404, 'NOT_FOUND', 'Einsatz nicht gefunden.');
  await assertEventScope(tx, a, row.eventOccurrenceId);
  return row;
}
async function assertTimeFree(
  tx: Transaction,
  a: Access,
  engagementId: string,
  start: string,
  end: string,
  exceptId: string | null,
) {
  const [clash] = await tx
    .select({ id: te.id })
    .from(te)
    .where(
      and(
        eq(te.organizationId, a.organizationId),
        eq(te.engagementId, engagementId),
        sql`${te.status}<>'rejected'`,
        exceptId ? sql`${te.id}<>${exceptId}` : undefined,
        sql`tstzrange(${te.actualStart},${te.actualEnd}) && tstzrange(${start}::timestamptz,${end}::timestamptz)`,
      ),
    );
  if (clash)
    throw new HttpError(409, 'TIME_OVERLAP', 'Für diesen Zeitraum ist bereits Zeit erfasst.');
}
const timeResult =
  (db: Database, a: Access) => async (r: { data: { id: string }; replayed: boolean }) => ({
    data: await getTimeEntry(db, a, r.data.id),
    replayed: r.replayed,
  });
export function createTimeEntry(
  db: Database,
  a: Access,
  key: string,
  input: z.infer<typeof timeEntryInputSchema>,
) {
  return financialOperation(
    db,
    a,
    key,
    'volunteer-time:create',
    input,
    'volunteers:assign',
    async (tx) => {
      const current = await currentAccess(tx, a);
      const engagement = await engagementRow(tx, current, input.engagementId, true);
      await assignmentScope(tx, current, input.assignmentId, engagement.id);
      if (
        input.actualStart.slice(0, 10) < engagement.startedOn ||
        (engagement.endedOn && input.actualStart.slice(0, 10) > engagement.endedOn)
      )
        throw new HttpError(
          409,
          'TIME_OUTSIDE_ENGAGEMENT',
          'Die Zeit liegt außerhalb der Tätigkeitsdauer.',
        );
      await assertTimeFree(tx, current, engagement.id, input.actualStart, input.actualEnd, null);
      const { submit, ...values } = input;
      const [row] = await tx
        .insert(te)
        .values({
          ...values,
          actualStart: new Date(input.actualStart),
          actualEnd: new Date(input.actualEnd),
          minutes: netMinutes(input.actualStart, input.actualEnd, input.breakMinutes),
          status: submit ? 'submitted' : 'draft',
          organizationId: a.organizationId,
          createdBy: a.userId,
        })
        .returning({ id: te.id });
      await audit(tx, a, 'create', 'volunteer_time_entry', row!.id, Object.keys(values));
      return { id: row!.id };
    },
  ).then(timeResult(db, a));
}
// Attendance only proposes a draft; minutes count after explicit confirmation.
export function draftFromAttendance(db: Database, a: Access, key: string, assignmentId: string) {
  return financialOperation(
    db,
    a,
    key,
    `volunteer-time:attendance:${assignmentId}`,
    {},
    'volunteers:assign',
    async (tx) => {
      const current = await currentAccess(tx, a);
      const [assignment] = await tx
        .select()
        .from(va)
        .where(and(eq(va.organizationId, a.organizationId), eq(va.id, assignmentId)));
      if (!assignment?.eventOccurrenceId)
        throw new HttpError(404, 'NOT_FOUND', 'Einsatz nicht gefunden.');
      await assertEventScope(tx, current, assignment.eventOccurrenceId);
      const engagement = await engagementRow(tx, current, assignment.engagementId, true);
      const [attendance] = await tx
        .select({ status: s.eventAttendances.status })
        .from(s.eventRegistrations)
        .innerJoin(
          s.eventAttendances,
          and(
            eq(s.eventAttendances.organizationId, s.eventRegistrations.organizationId),
            eq(s.eventAttendances.registrationId, s.eventRegistrations.id),
          ),
        )
        .where(
          and(
            eq(s.eventRegistrations.organizationId, a.organizationId),
            eq(s.eventRegistrations.eventOccurrenceId, assignment.eventOccurrenceId),
            eq(s.eventRegistrations.personId, engagement.personId),
          ),
        );
      if (attendance?.status !== 'present')
        throw new HttpError(
          409,
          'ATTENDANCE_NOT_PRESENT',
          'Für diesen Einsatz ist keine Anwesenheit erfasst.',
        );
      const [existing] = await tx
        .select({ id: te.id })
        .from(te)
        .where(
          and(
            eq(te.organizationId, a.organizationId),
            eq(te.assignmentId, assignmentId),
            eq(te.source, 'attendance'),
            sql`${te.status}<>'rejected'`,
          ),
        );
      if (existing)
        throw new HttpError(
          409,
          'TIME_DRAFT_EXISTS',
          'Für diesen Einsatz besteht bereits ein Entwurf.',
        );
      const start = assignment.plannedStart.toISOString(),
        end = assignment.plannedEnd.toISOString();
      await assertTimeFree(tx, current, engagement.id, start, end, null);
      const [row] = await tx
        .insert(te)
        .values({
          organizationId: a.organizationId,
          engagementId: engagement.id,
          assignmentId,
          actualStart: assignment.plannedStart,
          actualEnd: assignment.plannedEnd,
          breakMinutes: 0,
          minutes: netMinutes(start, end, 0),
          description: assignment.task,
          project: assignment.project,
          status: 'draft',
          source: 'attendance',
          createdBy: a.userId,
        })
        .returning({ id: te.id });
      await audit(tx, a, 'draft_from_attendance', 'volunteer_time_entry', row!.id, [
        'assignmentId',
      ]);
      return { id: row!.id };
    },
  ).then(timeResult(db, a));
}
async function lockedEntry(tx: Transaction, a: Access, id: string, version: number) {
  const [row] = await tx
    .select()
    .from(te)
    .where(and(eq(te.organizationId, a.organizationId), eq(te.id, id)))
    .for('update');
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Zeiteintrag nicht gefunden.');
  await assignmentScope(tx, a, row.assignmentId, row.engagementId);
  if (row.version !== version)
    throw new HttpError(409, 'STALE_VERSION', 'Der Zeiteintrag wurde zwischenzeitlich geändert.');
  return row;
}
const previousValues = (row: typeof te.$inferSelect) => ({
  actualStart: row.actualStart.toISOString(),
  actualEnd: row.actualEnd.toISOString(),
  breakMinutes: row.breakMinutes,
  minutes: row.minutes,
  description: row.description,
  project: row.project,
  status: row.status,
});
async function writeHistory(
  tx: Transaction,
  a: Access,
  row: typeof te.$inferSelect,
  action: string,
  reason: string,
) {
  await tx.insert(s.volunteerTimeEntryHistory).values({
    organizationId: a.organizationId,
    timeEntryId: row.id,
    version: row.version,
    action,
    reason,
    previous: previousValues(row),
    actorUserId: a.userId,
  });
}
export function correctTimeEntry(
  db: Database,
  a: Access,
  key: string,
  id: string,
  input: z.infer<typeof timeEntryCorrectionSchema>,
) {
  return financialOperation(
    db,
    a,
    key,
    `volunteer-time:correct:${id}`,
    input,
    'volunteers:assign',
    async (tx) => {
      const current = await currentAccess(tx, a);
      const row = await lockedEntry(tx, current, id, input.version);
      if (row.status === 'rejected')
        throw new HttpError(409, 'TIME_REJECTED', 'Abgelehnte Einträge werden neu erfasst.');
      // Confirmed time can only be corrected by someone allowed to confirm; it then needs a new confirmation.
      if (row.status === 'confirmed' && !can(current.role, 'volunteer_hours:confirm'))
        throw new HttpError(
          403,
          'FORBIDDEN',
          'Bestätigte Stunden dürfen nur Bestätigungsberechtigte korrigieren.',
        );
      const start = input.actualStart ?? row.actualStart.toISOString(),
        end = input.actualEnd ?? row.actualEnd.toISOString(),
        pause = input.breakMinutes ?? row.breakMinutes,
        minutes = netMinutes(start, end, pause);
      if (
        Date.parse(end) <= Date.parse(start) ||
        minutes <= 0 ||
        Date.parse(end) - Date.parse(start) > 86400000
      )
        throw new HttpError(422, 'VALIDATION_ERROR', 'Bitte prüfen Sie Beginn, Ende und Pause.');
      await assertTimeFree(tx, current, row.engagementId, start, end, id);
      await writeHistory(tx, current, row, 'correction', input.reason);
      await tx
        .update(te)
        .set({
          actualStart: new Date(start),
          actualEnd: new Date(end),
          breakMinutes: pause,
          minutes,
          description: input.description ?? row.description,
          project: input.project ?? row.project,
          status: row.status === 'confirmed' ? 'submitted' : row.status,
          confirmedBy: null,
          confirmedAt: null,
          version: row.version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(te.organizationId, a.organizationId), eq(te.id, id)));
      await audit(
        tx,
        a,
        'correct',
        'volunteer_time_entry',
        id,
        Object.keys(input).filter((k) => k !== 'version'),
      );
      return { id };
    },
  ).then(timeResult(db, a));
}
export function decideTimeEntry(
  db: Database,
  a: Access,
  key: string,
  id: string,
  input: z.infer<typeof timeEntryDecisionSchema>,
) {
  const permission = input.decision === 'submit' ? 'volunteers:assign' : 'volunteer_hours:confirm';
  return financialOperation(
    db,
    a,
    key,
    `volunteer-time:${input.decision}:${id}`,
    input,
    permission,
    async (tx) => {
      const current = await currentAccess(tx, a);
      const row = await lockedEntry(tx, current, id, input.version);
      const allowed = {
        submit: ['draft'],
        confirm: ['draft', 'submitted'],
        reject: ['draft', 'submitted'],
      }[input.decision];
      if (!allowed.includes(row.status))
        throw new HttpError(409, 'TIME_STATUS', 'Dieser Statuswechsel ist nicht möglich.');
      if (input.decision === 'reject' && !input.reason)
        throw new HttpError(422, 'VALIDATION_ERROR', 'Bitte eine Begründung angeben.');
      if (input.decision === 'confirm') {
        const engagement = await engagementRow(tx, current, row.engagementId);
        // Nobody confirms their own volunteer hours.
        if ((await ownPerson(tx, current)) === engagement.personId)
          throw new HttpError(
            403,
            'TIME_SELF_CONFIRM',
            'Eigene Stunden können nicht selbst bestätigt werden.',
          );
      }
      await writeHistory(tx, current, row, input.decision, input.reason);
      const status = ({ submit: 'submitted', confirm: 'confirmed', reject: 'rejected' } as const)[
        input.decision
      ];
      await tx
        .update(te)
        .set({
          status,
          confirmedBy: status === 'confirmed' ? a.userId : null,
          confirmedAt: status === 'confirmed' ? new Date() : null,
          version: row.version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(te.organizationId, a.organizationId), eq(te.id, id)));
      await audit(tx, a, input.decision, 'volunteer_time_entry', id, ['status']);
      return { id };
    },
  ).then(timeResult(db, a));
}
const exportLabels = {
  de: {
    title: 'Freiwilligenstunden',
    name: 'Freiwillige Person',
    start: 'Beginn',
    end: 'Ende',
    pause: 'Pause (Min.)',
    hours: 'Stunden',
    status: 'Status',
    project: 'Projekt',
    task: 'Tätigkeit',
    confirmed: 'Bestätigt durch',
    total: 'Summe bestätigter Stunden',
    draft: 'Entwurf',
    submitted: 'Eingereicht',
    confirmed_status: 'Bestätigt',
    rejected: 'Abgelehnt',
    note: 'Interne Stundenaufstellung. Nur bestätigte Einträge zählen als geleistete Stunden.',
  },
  it: {
    title: 'Ore di volontariato',
    name: 'Volontario/a',
    start: 'Inizio',
    end: 'Fine',
    pause: 'Pausa (min.)',
    hours: 'Ore',
    status: 'Stato',
    project: 'Progetto',
    task: 'Attività',
    confirmed: 'Confermato da',
    total: 'Totale ore confermate',
    draft: 'Bozza',
    submitted: 'Inviato',
    confirmed_status: 'Confermato',
    rejected: 'Respinto',
    note: 'Prospetto interno delle ore. Contano come ore prestate solo le voci confermate.',
  },
};
export async function exportTimeEntries(
  db: Database,
  a: Access,
  q: z.infer<typeof timeExportQuerySchema>,
) {
  return readSnapshot(db, async (tx) => {
    const t = exportLabels[q.language];
    const rows = await timeProjection(tx)
      .where(timeWhere(a, q))
      .orderBy(asc(te.actualStart), asc(te.id))
      .limit(5001);
    if (rows.length > 5000)
      throw new HttpError(422, 'EXPORT_TOO_LARGE', 'Bitte den Zeitraum eingrenzen.');
    const status = (v: string) => (v === 'confirmed' ? t.confirmed_status : t[v as 'draft']);
    const lines = rows.map((r) => [
      r.volunteerName,
      r.actualStart.toISOString(),
      r.actualEnd.toISOString(),
      String(r.breakMinutes),
      formatMinutes(r.minutes),
      status(r.status),
      r.project,
      r.description,
      r.confirmedByName ?? '',
    ]);
    const total = rows.reduce((sum, r) => (r.status === 'confirmed' ? sum + r.minutes : sum), 0);
    if (q.format === 'csv')
      return (
        '﻿' +
        [
          [t.name, t.start, t.end, t.pause, t.hours, t.status, t.project, t.task, t.confirmed],
          ...lines,
          [t.total, '', '', '', formatMinutes(total), '', '', '', ''],
        ]
          .map((row) => row.map(csvCell).join(';'))
          .join('\r\n')
      );
    return renderPdf(
      t.title,
      await organizationName(tx, a.organizationId),
      [
        `${t.total}: ${formatMinutes(total)}`,
        `${t.name} | ${t.start} | ${t.hours} | ${t.status} | ${t.project}`,
        ...rows.map(
          (r) =>
            `${r.volunteerName} | ${r.actualStart.toISOString().slice(0, 16).replace('T', ' ')} | ${formatMinutes(r.minutes)} | ${status(r.status)} | ${r.project}`,
        ),
      ],
      q.language,
      t.note,
    );
  });
}
