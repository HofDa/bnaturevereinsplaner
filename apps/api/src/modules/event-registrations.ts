import { and, eq, sql, count, asc } from 'drizzle-orm';
import { schema as s, type Database, type Executor, type Transaction } from '@bnature/db';
import {
  registrationResponseSchema,
  type EventRegistration,
  type registrationInputSchema,
  type registrationPatchSchema,
} from '@bnature/contracts';
import type { z } from 'zod';
import { HttpError, type Access } from '../middleware/access';
import { eventRow, managesEvent, ownPerson } from './events';
import { eventWrite } from './events-operations';
import { audit } from '../services/audit';
import { wire } from './responses';
const r = s.eventRegistrations;
export async function registrationRow(db: Executor, a: Access, id: string) {
  const [row] = await db
    .select()
    .from(r)
    .where(and(eq(r.organizationId, a.organizationId), eq(r.id, id)));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Anmeldung nicht gefunden.');
  return row;
}
async function describeRegistration(
  db: Executor,
  row: typeof r.$inferSelect,
): Promise<EventRegistration> {
  const [person] = await db
    .select({ firstName: s.persons.firstName, lastName: s.persons.lastName })
    .from(s.persons)
    .where(and(eq(s.persons.organizationId, row.organizationId), eq(s.persons.id, row.personId)));
  const [position] =
    row.status === 'waitlisted'
      ? await db
          .select({ n: count() })
          .from(r)
          .where(
            and(
              eq(r.organizationId, row.organizationId),
              eq(r.eventOccurrenceId, row.eventOccurrenceId),
              eq(r.status, 'waitlisted'),
              sql`(${r.registeredAt},${r.id}) <= (select r2.registered_at,r2.id from event_registrations r2 where r2.organization_id=${row.organizationId} and r2.id=${row.id})`,
            ),
          )
      : [];
  return registrationResponseSchema.parse({
    ...wire(row),
    displayName: `${person!.firstName} ${person!.lastName}`,
    waitlistPosition: row.status === 'waitlisted' ? position!.n : null,
  });
}
export async function listRegistrations(db: Executor, a: Access, eventId: string) {
  const event = await eventRow(db, a, eventId),
    person = await ownPerson(db, a);
  const rows = await db
    .select()
    .from(r)
    .where(
      and(
        eq(r.organizationId, a.organizationId),
        eq(r.eventOccurrenceId, eventId),
        managesEvent(a, event) ? undefined : person ? eq(r.personId, person) : sql`false`,
      ),
    )
    .orderBy(asc(r.registeredAt), asc(r.id));
  const items: EventRegistration[] = [];
  for (const row of rows) items.push(await describeRegistration(db, row));
  return { items };
}
export async function promoteWaitlist(tx: Transaction, a: Access, eventId: string, manual = false) {
  const event = await eventRow(tx, a, eventId, true);
  if (
    event.status !== 'published' ||
    (!manual &&
      ((event.registrationDeadline && event.registrationDeadline <= new Date()) ||
        event.startAt <= new Date()))
  )
    return;
  let [totals] = await tx
    .select({ n: count() })
    .from(r)
    .where(
      and(
        eq(r.organizationId, a.organizationId),
        eq(r.eventOccurrenceId, eventId),
        eq(r.status, 'registered'),
      ),
    );
  const waiting = await tx
    .select()
    .from(r)
    .where(
      and(
        eq(r.organizationId, a.organizationId),
        eq(r.eventOccurrenceId, eventId),
        eq(r.status, 'waitlisted'),
      ),
    )
    .orderBy(asc(r.registeredAt), asc(r.id));
  for (const row of waiting) {
    if (event.capacity !== null && totals!.n >= event.capacity) break;
    await tx
      .update(r)
      .set({ status: 'registered', version: row.version + 1, updatedAt: new Date() })
      .where(eq(r.id, row.id));
    await audit(tx, a, 'promote', 'event_registration', row.id, ['status']);
    totals = { n: totals!.n + 1 };
  }
}
export function createRegistration(
  db: Database,
  a: Access,
  key: string,
  eventId: string,
  input: z.infer<typeof registrationInputSchema>,
) {
  return eventWrite(
    db,
    a,
    key,
    `event-registrations:create:${eventId}`,
    input,
    'events:register',
    async (tx, current) => {
      const event = await eventRow(tx, current, eventId),
        manager = managesEvent(current, event);
      if (event.status !== 'published')
        throw new HttpError(409, 'EVENT_NOT_PUBLISHED', 'Veranstaltung ist nicht veröffentlicht.');
      const late =
        event.startAt <= new Date() ||
        (event.registrationDeadline && event.registrationDeadline <= new Date());
      if (late && !(manager && input.overrideDeadline))
        throw new HttpError(409, 'EVENT_REGISTRATION_CLOSED', 'Anmeldefrist ist abgelaufen.');
      let personId = input.personId;
      if (input.guest) {
        if (!manager)
          throw new HttpError(403, 'FORBIDDEN', 'Gäste nur durch Veranstaltungsleitung.');
        const [person] = await tx
          .insert(s.persons)
          .values({ ...input.guest, organizationId: a.organizationId })
          .returning({ id: s.persons.id });
        personId = person!.id;
      } else if (!manager) {
        const own = await ownPerson(tx, current);
        if (!own || (personId && personId !== own))
          throw new HttpError(403, 'FORBIDDEN', 'Nur eigene Anmeldung.');
        personId = own;
      }
      if (!personId) throw new HttpError(422, 'EVENT_PERSON_REQUIRED', 'Person auswählen.');
      const [person] = await tx
        .select({ id: s.persons.id })
        .from(s.persons)
        .where(and(eq(s.persons.organizationId, a.organizationId), eq(s.persons.id, personId)));
      if (!person) throw new HttpError(404, 'NOT_FOUND', 'Person nicht gefunden.');
      if (!manager && event.visibility === 'members') {
        const [membership] = await tx
          .select()
          .from(s.memberships)
          .where(
            and(
              eq(s.memberships.organizationId, a.organizationId),
              eq(s.memberships.personId, personId),
              eq(s.memberships.status, 'active'),
            ),
          );
        if (!membership) throw new HttpError(403, 'EVENT_MEMBERS_ONLY', 'Nur aktive Mitglieder.');
      }
      const [existing] = await tx
        .select()
        .from(r)
        .where(
          and(
            eq(r.organizationId, a.organizationId),
            eq(r.eventOccurrenceId, eventId),
            eq(r.personId, personId),
          ),
        );
      if (existing && existing.status !== 'cancelled')
        throw new HttpError(409, 'EVENT_ALREADY_REGISTERED', 'Person bereits angemeldet.');
      const [n] = await tx
        .select({ n: count() })
        .from(r)
        .where(
          and(
            eq(r.organizationId, a.organizationId),
            eq(r.eventOccurrenceId, eventId),
            eq(r.status, 'registered'),
          ),
        );
      const full = event.capacity !== null && n!.n >= event.capacity;
      if (full && !event.waitlistEnabled)
        throw new HttpError(409, 'EVENT_FULL', 'Keine Plätze verfügbar.');
      const status = full ? 'waitlisted' : 'registered';
      const [row] = existing
        ? await tx
            .update(r)
            .set({
              status,
              registeredAt: new Date(),
              cancelledAt: null,
              version: existing.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(r.id, existing.id))
            .returning()
        : await tx
            .insert(r)
            .values({
              organizationId: a.organizationId,
              eventOccurrenceId: eventId,
              personId,
              status,
              createdBy: a.userId,
            })
            .returning();
      await tx
        .insert(s.eventAttendances)
        .values({
          organizationId: a.organizationId,
          eventOccurrenceId: eventId,
          registrationId: row!.id,
        })
        .onConflictDoNothing();
      await audit(tx, current, 'register', 'event_registration', row!.id, ['status', 'personId']);
      return describeRegistration(tx, row!);
    },
  );
}
export async function changeRegistration(
  tx: Transaction,
  a: Access,
  id: string,
  input: z.infer<typeof registrationPatchSchema>,
) {
  const row = await registrationRow(tx, a, id),
    event = await eventRow(tx, a, row.eventOccurrenceId),
    manager = managesEvent(a, event),
    own = await ownPerson(tx, a);
  if (!manager && (row.personId !== own || input.status !== 'cancelled'))
    throw new HttpError(403, 'FORBIDDEN', 'Keine Berechtigung.');
  if (row.version !== input.version) throw new HttpError(409, 'STALE_VERSION', 'Version veraltet.');
  if (input.status !== row.status && input.status !== 'cancelled' && event.status !== 'published')
    throw new HttpError(409, 'EVENT_NOT_PUBLISHED', 'Veranstaltung nicht offen.');
  if (row.status === 'cancelled' && input.status !== 'cancelled')
    throw new HttpError(409, 'EVENT_REGISTER_AGAIN', 'Anmeldung erneut anlegen.');
  if (input.status === 'waitlisted' && row.status !== 'waitlisted')
    throw new HttpError(
      409,
      'EVENT_WAITLIST_AUTOMATIC',
      'Wartelistenplätze werden bei der Anmeldung automatisch vergeben.',
    );
  if (input.status === 'waitlisted' && !event.waitlistEnabled)
    throw new HttpError(409, 'EVENT_NO_WAITLIST', 'Keine Warteliste.');
  if (input.status === 'registered' && row.status === 'waitlisted') {
    const [first] = await tx
      .select({ id: r.id })
      .from(r)
      .where(
        and(
          eq(r.organizationId, a.organizationId),
          eq(r.eventOccurrenceId, event.id),
          eq(r.status, 'waitlisted'),
        ),
      )
      .orderBy(asc(r.registeredAt), asc(r.id))
      .limit(1);
    if (first?.id !== id)
      throw new HttpError(409, 'EVENT_WAITLIST_ORDER', 'Frühere Wartelistenplätze zuerst.');
  }
  const [updated] = await tx
    .update(r)
    .set({
      status: input.status,
      cancelledAt: input.status === 'cancelled' ? new Date() : null,
      version: input.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(r.id, id))
    .returning();
  await audit(
    tx,
    a,
    input.status === 'cancelled' ? 'unregister' : 'update',
    'event_registration',
    id,
    ['status'],
  );
  // An owner cancelling does not need management privileges to trigger the deterministic queue rule.
  if (row.status === 'registered' && input.status !== 'registered')
    await promoteAfterCancellation(tx, a, event);
  return describeRegistration(tx, updated!);
}
async function promoteAfterCancellation(
  tx: Transaction,
  a: Access,
  event: typeof s.eventOccurrences.$inferSelect,
) {
  if (
    event.status !== 'published' ||
    event.startAt <= new Date() ||
    (event.registrationDeadline && event.registrationDeadline <= new Date())
  )
    return;
  const [n] = await tx
    .select({ n: count() })
    .from(r)
    .where(
      and(
        eq(r.organizationId, a.organizationId),
        eq(r.eventOccurrenceId, event.id),
        eq(r.status, 'registered'),
      ),
    );
  if (event.capacity !== null && n!.n >= event.capacity) return;
  const [next] = await tx
    .select()
    .from(r)
    .where(
      and(
        eq(r.organizationId, a.organizationId),
        eq(r.eventOccurrenceId, event.id),
        eq(r.status, 'waitlisted'),
      ),
    )
    .orderBy(asc(r.registeredAt), asc(r.id))
    .limit(1);
  if (next) {
    await tx
      .update(r)
      .set({ status: 'registered', version: next.version + 1, updatedAt: new Date() })
      .where(eq(r.id, next.id));
    await audit(tx, a, 'promote', 'event_registration', next.id, ['status']);
  }
}
export function patchRegistration(
  db: Database,
  a: Access,
  key: string,
  id: string,
  input: z.infer<typeof registrationPatchSchema>,
) {
  return eventWrite(
    db,
    a,
    key,
    `event-registrations:patch:${id}`,
    input,
    'events:register',
    (tx, current) => changeRegistration(tx, current, id, input),
  );
}
export function deleteRegistration(
  db: Database,
  a: Access,
  key: string,
  id: string,
  version: number,
) {
  return patchRegistration(db, a, key, id, { version, status: 'cancelled' });
}
