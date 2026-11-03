import { and, eq, sql, asc, getTableColumns } from 'drizzle-orm';
import { schema as s, type Database, type Executor, type Transaction } from '@bnature/db';
import {
  can,
  attendanceRecordSchema,
  attendanceSnapshotSchema,
  attendanceResultSchema,
  attendanceHistorySchema,
  type AttendanceOperation,
  type AttendanceResult,
  type AttendanceRecord,
} from '@bnature/contracts';
import { HttpError, currentAccess as baseCurrentAccess, type Access } from '../middleware/access';
import { eventRow } from './events';
import { eventHash } from './events-operations';
import { audit } from '../services/audit';
import { wire } from './responses';
import { readSnapshot } from './finance/operations';
function attendanceProjection(db: Executor) {
  return db
    .select({
      registrationId: s.eventRegistrations.id,
      personId: s.eventRegistrations.personId,
      displayName: sql<string>`${s.persons.firstName}||' '||${s.persons.lastName}`,
      registrationStatus: s.eventRegistrations.status,
      status: s.eventAttendances.status,
      version: s.eventAttendances.version,
      checkedInAt: s.eventAttendances.checkedInAt,
      recordedBy: s.eventAttendances.recordedBy,
      recordedByName: s.user.name,
      updatedAt: s.eventAttendances.updatedAt,
    })
    .from(s.eventRegistrations)
    .innerJoin(
      s.persons,
      and(
        eq(s.persons.organizationId, s.eventRegistrations.organizationId),
        eq(s.persons.id, s.eventRegistrations.personId),
      ),
    )
    .innerJoin(
      s.eventAttendances,
      and(
        eq(s.eventAttendances.organizationId, s.eventRegistrations.organizationId),
        eq(s.eventAttendances.registrationId, s.eventRegistrations.id),
      ),
    )
    .leftJoin(s.user, eq(s.user.id, s.eventAttendances.recordedBy));
}
async function record(
  db: Executor,
  a: Access,
  eventId: string,
  registrationId: string,
): Promise<AttendanceRecord> {
  const [row] = await attendanceProjection(db).where(
    and(
      eq(s.eventRegistrations.organizationId, a.organizationId),
      eq(s.eventRegistrations.eventOccurrenceId, eventId),
      eq(s.eventRegistrations.id, registrationId),
    ),
  );
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Anmeldung nicht gefunden.');
  return attendanceRecordSchema.parse(wire(row));
}
export async function attendanceList(db: Executor, a: Access, eventId: string) {
  return readSnapshot(db, async (tx) => {
    await eventRow(tx, a, eventId, true);
    const rows = await attendanceProjection(tx)
      .where(
        and(
          eq(s.eventRegistrations.organizationId, a.organizationId),
          eq(s.eventRegistrations.eventOccurrenceId, eventId),
        ),
      )
      .orderBy(asc(s.persons.lastName), asc(s.persons.firstName), asc(s.eventRegistrations.id));
    return { items: rows.map((row) => attendanceRecordSchema.parse(wire(row))) };
  });
}
export async function prepareAttendance(db: Database, a: Access, eventId: string) {
  return readSnapshot(db, async (tx) => {
    const event = await eventRow(tx, a, eventId, true);
    if (event.status === 'draft' || event.status === 'cancelled')
      throw new HttpError(
        409,
        'EVENT_OFFLINE_UNAVAILABLE',
        'Veranstaltung nicht für Offline-Erfassung freigegeben.',
      );
    const { items } = await attendanceList(tx, a, eventId);
    return attendanceSnapshotSchema.parse({
      organizationId: a.organizationId,
      eventOccurrenceId: event.id,
      titleI18n: event.titleI18n,
      startAt: event.startAt.toISOString(),
      endAt: event.endAt.toISOString(),
      timezone: event.timezone,
      eventVersion: event.version,
      preparedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      participants: items
        .filter((r) => r.registrationStatus === 'registered')
        .map(({ personId: _, recordedBy: __, updatedAt: ___, ...rest }) => {
          void _;
          void __;
          void ___;
          return rest;
        }),
    });
  });
}
export async function attendanceHistory(
  db: Executor,
  a: Access,
  eventId: string,
  registrationId: string,
) {
  await eventRow(db, a, eventId, true);
  await record(db, a, eventId, registrationId);
  const rows = await db
    .select({ ...getTableColumns(s.attendanceHistory), recordedByName: s.user.name })
    .from(s.attendanceHistory)
    .leftJoin(s.user, eq(s.user.id, s.attendanceHistory.recordedBy))
    .where(
      and(
        eq(s.attendanceHistory.organizationId, a.organizationId),
        eq(s.attendanceHistory.registrationId, registrationId),
      ),
    )
    .orderBy(s.attendanceHistory.version);
  return { items: rows.map((r) => attendanceHistorySchema.parse(wire(r))) };
}
async function currentAccess(tx: Transaction, a: Access) {
  await tx
    .select({ id: s.organizations.id })
    .from(s.organizations)
    .where(eq(s.organizations.id, a.organizationId))
    .for('no key update');
  const current = await baseCurrentAccess(tx, a, 'Anwesenheitsrecht entzogen.');
  if (!can(current.role, 'attendance:write'))
    throw new HttpError(403, 'FORBIDDEN', 'Anwesenheitsrecht entzogen.');
  return current;
}
export async function attendanceOperation(
  db: Database,
  a: Access,
  input: AttendanceOperation,
): Promise<AttendanceResult> {
  if (input.organizationId !== a.organizationId)
    throw new HttpError(403, 'FORBIDDEN', 'Falsche Organisation.');
  return db.transaction(async (tx) => {
    const current = await currentAccess(tx, a),
      event = await eventRow(tx, current, input.eventOccurrenceId, true);
    const hash = eventHash({ ...input, actor: a.userId }),
      [previous] = await tx
        .select()
        .from(s.attendanceOperations)
        .where(
          and(
            eq(s.attendanceOperations.organizationId, a.organizationId),
            eq(s.attendanceOperations.operationId, input.operationId),
          ),
        );
    if (previous) {
      if (previous.actorUserId !== a.userId || previous.requestHash !== hash)
        throw new HttpError(409, 'IDEMPOTENCY_MISMATCH', 'Operation bereits anders verwendet.');
      return attendanceResultSchema.parse({ ...previous.result, replayed: true });
    }
    const original = await record(tx, current, event.id, input.registrationId);
    let result: AttendanceResult;
    if (
      event.status === 'cancelled' ||
      event.status === 'draft' ||
      original.registrationStatus !== 'registered'
    )
      result = {
        operationId: input.operationId,
        status: 'rejected',
        code: 'EVENT_ATTENDANCE_UNAVAILABLE',
        record: original,
        replayed: false,
      };
    else if (original.version !== input.expectedVersion)
      result = {
        operationId: input.operationId,
        status: 'conflict',
        code: 'ATTENDANCE_VERSION_CONFLICT',
        record: original,
        replayed: false,
      };
    else
      result = {
        operationId: input.operationId,
        status: 'applied',
        replayed: false,
        record: {
          ...original,
          status: input.requestedStatus,
          version: original.version + 1,
          checkedInAt: input.requestedStatus === 'present' ? new Date().toISOString() : null,
          recordedBy: a.userId,
          recordedByName: a.user.name,
          updatedAt: new Date().toISOString(),
        },
      };
    await tx.insert(s.attendanceOperations).values({
      organizationId: a.organizationId,
      operationId: input.operationId,
      actorUserId: a.userId,
      eventOccurrenceId: event.id,
      registrationId: input.registrationId,
      requestedStatus: input.requestedStatus,
      expectedVersion: input.expectedVersion,
      clientCreatedAt: new Date(input.clientCreatedAt),
      requestHash: hash,
      result,
    });
    if (result.status === 'applied') {
      const next = result.record!;
      await tx
        .update(s.eventAttendances)
        .set({
          status: next.status,
          version: next.version,
          checkedInAt: next.checkedInAt ? new Date(next.checkedInAt) : null,
          recordedBy: a.userId,
          updatedAt: new Date(next.updatedAt),
        })
        .where(
          and(
            eq(s.eventAttendances.organizationId, a.organizationId),
            eq(s.eventAttendances.registrationId, input.registrationId),
          ),
        );
      await tx.insert(s.attendanceHistory).values({
        organizationId: a.organizationId,
        registrationId: input.registrationId,
        operationId: input.operationId,
        previousStatus: original.status,
        status: next.status,
        version: next.version,
        recordedBy: a.userId,
        clientCreatedAt: new Date(input.clientCreatedAt),
      });
      await audit(tx, current, 'attendance', 'event_registration', input.registrationId, [
        'status',
        'version',
      ]);
    }
    return attendanceResultSchema.parse(result);
  });
}
// Each operation commits independently. A conflict or invalid item cannot roll back confirmed siblings.
export async function syncAttendance(db: Database, a: Access, operations: AttendanceOperation[]) {
  const results: AttendanceResult[] = [];
  for (const op of operations) {
    try {
      results.push(await attendanceOperation(db, a, op));
    } catch (error) {
      if (error instanceof HttpError)
        results.push({
          operationId: op.operationId,
          status: 'rejected',
          replayed: false,
          code: error.code,
        });
      else throw error;
    }
  }
  return { results };
}
