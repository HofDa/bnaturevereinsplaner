import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { schema as s, type Database } from '@bnature/db';
import { netMinutes, type OwnVolunteering } from '@bnature/contracts';
import type { z } from 'zod';
import type { ownTimeEntryInputSchema } from '@bnature/contracts';
import { HttpError, type Access } from '../../middleware/access';
import { audit } from '../../services/audit';
import { financialOperation, readSnapshot } from '../finance/operations';
import { businessDate } from '../finance/service';
import { ownPerson } from '../events';
import { ve, engagementRow } from './common';

const va = s.volunteerAssignments,
  te = s.volunteerTimeEntries,
  ev = s.eventOccurrences;

/** The signed-in account's own engagements, assignments and hours (via its linked person). */
export function ownVolunteering(db: Database, a: Access): Promise<OwnVolunteering> {
  return readSnapshot(db, async (tx) => {
    const empty = {
      engagements: [],
      assignments: [],
      timeEntries: [],
      confirmedMinutesThisYear: 0,
      pendingMinutes: 0,
    };
    const personId = await ownPerson(tx, a);
    if (!personId) return empty;
    const engagements = await tx
      .select()
      .from(ve)
      .where(and(eq(ve.organizationId, a.organizationId), eq(ve.personId, personId)))
      .orderBy(desc(ve.startedOn));
    if (!engagements.length) return empty;
    const ids = engagements.map((e) => e.id);
    const today = await businessDate(tx, a.organizationId);
    const assignments = await tx
      .select({ row: va, eventTitle: ev.titleI18n })
      .from(va)
      .leftJoin(ev, and(eq(ev.organizationId, va.organizationId), eq(ev.id, va.eventOccurrenceId)))
      .where(
        and(
          eq(va.organizationId, a.organizationId),
          inArray(va.engagementId, ids),
          sql`${va.status}<>'cancelled'`,
          gte(va.plannedEnd, new Date(Date.now() - 30 * 86_400_000)),
        ),
      )
      .orderBy(va.plannedStart)
      .limit(50);
    const entries = await tx
      .select()
      .from(te)
      .where(and(eq(te.organizationId, a.organizationId), inArray(te.engagementId, ids)))
      .orderBy(desc(te.actualStart))
      .limit(50);
    const [totals] = await tx
      .select({
        confirmed: sql<number>`coalesce(sum(${te.minutes}) filter (where ${te.status}='confirmed' and ${te.actualStart}>=${`${today.slice(0, 4)}-01-01`}::date),0)::int`,
        pending: sql<number>`coalesce(sum(${te.minutes}) filter (where ${te.status} in ('draft','submitted')),0)::int`,
      })
      .from(te)
      .where(and(eq(te.organizationId, a.organizationId), inArray(te.engagementId, ids)));
    return {
      engagements: engagements.map((e) => ({
        id: e.id,
        status: e.status,
        startedOn: e.startedOn,
        endedOn: e.endedOn,
        activity: e.activity,
      })),
      assignments: assignments.map(({ row, eventTitle }) => ({
        id: row.id,
        engagementId: row.engagementId,
        task: row.task,
        plannedStart: row.plannedStart.toISOString(),
        plannedEnd: row.plannedEnd.toISOString(),
        status: row.status,
        eventTitle: eventTitle ?? null,
      })),
      timeEntries: entries.map((row) => ({
        id: row.id,
        engagementId: row.engagementId,
        assignmentId: row.assignmentId,
        actualStart: row.actualStart.toISOString(),
        actualEnd: row.actualEnd.toISOString(),
        minutes: row.minutes,
        description: row.description,
        status: row.status,
      })),
      confirmedMinutesThisYear: totals?.confirmed ?? 0,
      pendingMinutes: totals?.pending ?? 0,
    };
  });
}

/**
 * A volunteer reports their own hours. Only for their own engagement (and, optionally, their
 * own assignment); always `submitted`, so the minutes count only after the club confirms them.
 */
export function submitOwnTimeEntry(
  db: Database,
  a: Access,
  key: string,
  input: z.infer<typeof ownTimeEntryInputSchema>,
) {
  return financialOperation(
    db,
    a,
    key,
    'volunteer-time:self',
    input,
    'organization:read',
    async (tx) => {
      const personId = await ownPerson(tx, a);
      const engagement = await engagementRow(tx, a, input.engagementId, true);
      if (!personId || engagement.personId !== personId)
        throw new HttpError(404, 'NOT_FOUND', 'Freiwilligeneinsatz nicht gefunden.');
      const day = input.actualStart.slice(0, 10);
      if (day < engagement.startedOn || (engagement.endedOn && day > engagement.endedOn))
        throw new HttpError(
          409,
          'TIME_OUTSIDE_ENGAGEMENT',
          'Die Zeit liegt außerhalb der Tätigkeitsdauer.',
        );
      if (new Date(input.actualEnd).getTime() > Date.now() + 60_000)
        throw new HttpError(
          422,
          'TIME_IN_FUTURE',
          'Stunden können erst nachträglich gemeldet werden.',
        );
      if (input.assignmentId) {
        const [assignment] = await tx
          .select({ engagementId: va.engagementId })
          .from(va)
          .where(and(eq(va.organizationId, a.organizationId), eq(va.id, input.assignmentId)));
        if (!assignment || assignment.engagementId !== engagement.id)
          throw new HttpError(404, 'NOT_FOUND', 'Einsatz nicht gefunden.');
      }
      const [clash] = await tx
        .select({ id: te.id })
        .from(te)
        .where(
          and(
            eq(te.organizationId, a.organizationId),
            eq(te.engagementId, engagement.id),
            sql`${te.status}<>'rejected'`,
            sql`tstzrange(${te.actualStart},${te.actualEnd}) && tstzrange(${input.actualStart}::timestamptz,${input.actualEnd}::timestamptz)`,
          ),
        );
      if (clash)
        throw new HttpError(409, 'TIME_OVERLAP', 'Für diesen Zeitraum ist bereits Zeit erfasst.');
      const [row] = await tx
        .insert(te)
        .values({
          organizationId: a.organizationId,
          engagementId: engagement.id,
          assignmentId: input.assignmentId,
          actualStart: new Date(input.actualStart),
          actualEnd: new Date(input.actualEnd),
          breakMinutes: input.breakMinutes,
          minutes: netMinutes(input.actualStart, input.actualEnd, input.breakMinutes),
          description: input.description,
          status: 'submitted',
          source: 'manual',
          createdBy: a.userId,
        })
        .returning({ id: te.id });
      await audit(tx, a, 'create', 'volunteer_time_entry', row!.id, ['self']);
      return { id: row!.id };
    },
  );
}
