import { and, eq, or, sql, ilike, asc, count, desc, getTableColumns } from 'drizzle-orm';
import { schema as s, type Database, type Executor, type Transaction } from '@bnature/db';
import {
  can,
  eventResponseSchema,
  eventCategoryResponseSchema,
  seriesResponseSchema,
  eventInputSchema,
  eventTimes,
  eventLocal,
  expandSeries,
  type EventInput,
  type EventPatch,
  type EventQuery,
  type EventOccurrence,
  type EventSeries,
} from '@bnature/contracts';
import { HttpError, type Access } from '../middleware/access';
import { audit } from '../services/audit';
import { wire } from './responses';
import { escapeLike } from './members';
import { eventWrite } from './events-operations';
import { readSnapshot } from './finance/operations';
import { promoteWaitlist } from './event-registrations';
const e = s.eventOccurrences;
export const managesEvent = (a: Access, row: { createdBy: string; organizerId: string }) =>
  can(a.role, 'events:write') &&
  (['admin', 'board'].includes(a.role) ||
    row.organizerId === a.userId ||
    row.createdBy === a.userId);
export async function ownPerson(db: Executor, a: Access) {
  const [row] = await db
    .select()
    .from(s.personUserLinks)
    .where(
      and(
        eq(s.personUserLinks.organizationId, a.organizationId),
        eq(s.personUserLinks.userId, a.userId),
      ),
    );
  return row?.personId;
}
export async function eventRow(db: Executor, a: Access, id: string, manage = false) {
  const [row] = await db
    .select()
    .from(e)
    .where(and(eq(e.organizationId, a.organizationId), eq(e.id, id)));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Veranstaltung nicht gefunden.');
  if (manage) {
    if (!managesEvent(a, row))
      throw new HttpError(403, 'FORBIDDEN', 'Keine Veranstaltungsleitung.');
  } else if (!managesEvent(a, row) && (row.visibility === 'internal' || row.status === 'draft'))
    throw new HttpError(404, 'NOT_FOUND', 'Veranstaltung nicht gefunden.');
  return row;
}
function eventProjection(db: Executor, a: Access) {
  return db
    .select({
      ...getTableColumns(e),
      categoryNameI18n: s.eventCategories.nameI18n,
      organizerName: s.user.name,
      registeredCount: sql<number>`(select count(*)::int from event_registrations r where r.organization_id=${e.organizationId} and r.event_occurrence_id=${e.id} and r.status='registered')`,
      waitlistedCount: sql<number>`(select count(*)::int from event_registrations r where r.organization_id=${e.organizationId} and r.event_occurrence_id=${e.id} and r.status='waitlisted')`,
      myRegistrationStatus: sql<
        'registered' | 'waitlisted' | 'cancelled' | null
      >`(select r.status from event_registrations r join person_user_links pl on pl.organization_id=r.organization_id and pl.person_id=r.person_id where r.organization_id=${e.organizationId} and r.event_occurrence_id=${e.id} and pl.user_id=${a.userId} limit 1)`,
    })
    .from(e)
    .innerJoin(
      s.eventCategories,
      and(
        eq(s.eventCategories.organizationId, e.organizationId),
        eq(s.eventCategories.id, e.categoryId),
      ),
    )
    .innerJoin(s.user, eq(s.user.id, e.organizerId));
}
async function describeEvent(
  db: Executor,
  a: Access,
  row: typeof e.$inferSelect,
): Promise<EventOccurrence> {
  const [projection] = await eventProjection(db, a).where(
    and(eq(e.organizationId, a.organizationId), eq(e.id, row.id)),
  );
  return eventResponseSchema.parse({ ...wire(projection), canManage: managesEvent(a, row) });
}
export async function getEvent(db: Executor, a: Access, id: string) {
  return describeEvent(db, a, await eventRow(db, a, id));
}
export async function listEvents(db: Executor, a: Access, q: EventQuery) {
  return readSnapshot(db, async (tx) => {
    const staff = ['admin', 'board'].includes(a.role),
      person = await ownPerson(tx, a);
    const where = and(
      eq(e.organizationId, a.organizationId),
      staff
        ? undefined
        : or(
            and(sql`${e.status}<>'draft'`, sql`${e.visibility}<>'internal'`),
            can(a.role, 'events:write')
              ? or(eq(e.organizerId, a.userId), eq(e.createdBy, a.userId))
              : undefined,
          ),
      q.from ? sql`${e.endAt}>${q.from}::timestamptz` : undefined,
      q.to ? sql`${e.startAt}<${q.to}::timestamptz` : undefined,
      q.categoryId ? eq(e.categoryId, q.categoryId) : undefined,
      q.status ? eq(e.status, q.status) : undefined,
      q.project ? eq(e.project, q.project) : undefined,
      q.search
        ? or(
            ilike(sql`${e.titleI18n}->>'de'`, `%${escapeLike(q.search)}%`),
            ilike(sql`${e.titleI18n}->>'it'`, `%${escapeLike(q.search)}%`),
            ilike(e.location, `%${escapeLike(q.search)}%`),
          )
        : undefined,
      q.mine === 'true'
        ? or(
            eq(e.organizerId, a.userId),
            eq(e.createdBy, a.userId),
            person
              ? sql`exists(select 1 from event_registrations r where r.organization_id=${e.organizationId} and r.event_occurrence_id=${e.id} and r.person_id=${person} and r.status<>'cancelled')`
              : undefined,
          )
        : undefined,
    );
    const rows = await eventProjection(tx, a)
      .where(where)
      .orderBy(asc(e.startAt), asc(e.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [n] = await tx.select({ n: count() }).from(e).where(where);
    const items = rows.map((row) =>
      eventResponseSchema.parse({ ...wire(row), canManage: managesEvent(a, row) }),
    );
    return { items, total: n!.n, page: q.page, pageSize: q.pageSize };
  });
}
export async function listEventCategories(db: Executor, a: Access) {
  const rows = await db
    .select()
    .from(s.eventCategories)
    .where(eq(s.eventCategories.organizationId, a.organizationId))
    .orderBy(s.eventCategories.createdAt, s.eventCategories.id);
  return { items: rows.map((r) => eventCategoryResponseSchema.parse(wire(r))) };
}
const starterNames = [
  ['assembly', 'Mitgliederversammlung', 'Assemblea dei soci'],
  ['board', 'Vorstandssitzung', 'Riunione del direttivo'],
  ['excursion', 'Exkursion', 'Escursione'],
  ['workshop', 'Workshop', 'Laboratorio'],
  ['volunteer', 'Freiwilligeneinsatz', 'Attività di volontariato'],
  ['survey', 'Wissenschaftliche Erhebung', 'Rilevamento scientifico'],
  ['public', 'Öffentliches Event', 'Evento pubblico'],
  ['other', 'Sonstige Veranstaltung', 'Altro evento'],
];
export function initializeEventCategories(db: Database, a: Access, key: string) {
  return eventWrite(
    db,
    a,
    key,
    'event-categories:initialize',
    {},
    'events:categories',
    async (tx, current) => {
      for (const [starterKey, de, it] of starterNames)
        await tx
          .insert(s.eventCategories)
          .values({ organizationId: a.organizationId, starterKey, nameI18n: { de: de!, it: it! } })
          .onConflictDoNothing();
      await audit(tx, current, 'initialize', 'event_category', a.organizationId, ['categories']);
      return listEventCategories(tx, current);
    },
  );
}
export function createEventCategory(
  db: Database,
  a: Access,
  key: string,
  input: { nameI18n: { de: string; it: string }; active: boolean },
) {
  return eventWrite(
    db,
    a,
    key,
    'event-categories:create',
    input,
    'events:categories',
    async (tx, current) => {
      const [row] = await tx
        .insert(s.eventCategories)
        .values({ ...input, organizationId: a.organizationId })
        .returning();
      await audit(tx, current, 'create', 'event_category', row!.id, Object.keys(input));
      return eventCategoryResponseSchema.parse(wire(row));
    },
  );
}
export function patchEventCategory(
  db: Database,
  a: Access,
  key: string,
  id: string,
  input: { nameI18n?: { de: string; it: string }; active?: boolean; version: number },
) {
  return eventWrite(
    db,
    a,
    key,
    `event-categories:patch:${id}`,
    input,
    'events:categories',
    async (tx, current) => {
      const [row] = await tx
        .select()
        .from(s.eventCategories)
        .where(
          and(eq(s.eventCategories.organizationId, a.organizationId), eq(s.eventCategories.id, id)),
        );
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Kategorie nicht gefunden.');
      if (row.version !== input.version)
        throw new HttpError(409, 'STALE_VERSION', 'Version veraltet.');
      const [updated] = await tx
        .update(s.eventCategories)
        .set({ ...input, version: input.version + 1, updatedAt: new Date() })
        .where(eq(s.eventCategories.id, id))
        .returning();
      await audit(tx, current, 'update', 'event_category', id, Object.keys(input));
      return eventCategoryResponseSchema.parse(wire(updated));
    },
  );
}
export async function validateEvent(tx: Executor, a: Access, input: EventInput) {
  let times: ReturnType<typeof eventTimes>;
  try {
    times = eventTimes(input);
  } catch (error) {
    throw new HttpError(
      422,
      error instanceof Error ? error.message : 'EVENT_INVALID_TIME',
      'Ungültige Ortszeit oder Zeitspanne.',
    );
  }
  const [category] = await tx
    .select()
    .from(s.eventCategories)
    .where(
      and(
        eq(s.eventCategories.organizationId, a.organizationId),
        eq(s.eventCategories.id, input.categoryId),
      ),
    );
  if (!category) throw new HttpError(404, 'NOT_FOUND', 'Kategorie nicht gefunden.');
  if (!category.active) throw new HttpError(409, 'EVENT_CATEGORY_INACTIVE', 'Kategorie inaktiv.');
  const organizerId = input.organizerId ?? a.userId;
  const [organizer] = await tx
    .select()
    .from(s.organizationUserRoles)
    .where(
      and(
        eq(s.organizationUserRoles.organizationId, a.organizationId),
        eq(s.organizationUserRoles.userId, organizerId),
      ),
    );
  if (!organizer) throw new HttpError(404, 'NOT_FOUND', 'Verantwortliche Person nicht gefunden.');
  if (!can(organizer.role, 'events:write'))
    throw new HttpError(
      422,
      'EVENT_ORGANIZER_INVALID',
      'Verantwortliche Person benötigt Veranstaltungsrechte.',
    );
  if ((input.latitude === null) !== (input.longitude === null))
    throw new HttpError(422, 'EVENT_COORDINATES', 'Beide Koordinaten angeben.');
  if (
    input.registrationDeadline &&
    Date.parse(input.registrationDeadline) > Date.parse(times.startAt)
  )
    throw new HttpError(422, 'EVENT_DEADLINE', 'Anmeldefrist nach Veranstaltungsbeginn.');
  const { startLocal: _, endLocal: __, ...rest } = input;
  void _;
  void __;
  return {
    ...rest,
    organizerId,
    startAt: new Date(times.startAt),
    endAt: new Date(times.endAt),
    registrationDeadline: input.registrationDeadline ? new Date(input.registrationDeadline) : null,
  };
}
export function createEvent(db: Database, a: Access, key: string, input: EventInput) {
  return eventWrite(db, a, key, 'events:create', input, 'events:write', async (tx, current) => {
    const values = await validateEvent(tx, current, input);
    const [row] = await tx
      .insert(e)
      .values({ ...values, organizationId: a.organizationId, createdBy: a.userId })
      .returning();
    await audit(tx, current, 'create', 'event_occurrence', row!.id, Object.keys(input));
    return getEvent(tx, current, row!.id);
  });
}
// Parse a database projection through the strict input contract without leaking identity fields.
function inputOf(row: typeof e.$inferSelect): EventInput {
  return {
    titleI18n: row.titleI18n,
    descriptionI18n: row.descriptionI18n,
    categoryId: row.categoryId,
    startLocal: eventLocal(row.startAt.toISOString(), row.timezone),
    endLocal: eventLocal(row.endAt.toISOString(), row.timezone),
    timezone: row.timezone,
    location: row.location,
    latitude: row.latitude,
    longitude: row.longitude,
    organizerId: row.organizerId,
    project: row.project,
    status: row.status,
    visibility: row.visibility,
    registrationRequired: row.registrationRequired,
    capacity: row.capacity,
    registrationDeadline: row.registrationDeadline?.toISOString() ?? null,
    waitlistEnabled: row.waitlistEnabled,
  };
}
export async function patchOccurrence(
  tx: Transaction,
  a: Access,
  id: string,
  input: EventPatch,
  exception = true,
) {
  const row = await eventRow(tx, a, id, true);
  if (row.version !== input.version) throw new HttpError(409, 'STALE_VERSION', 'Version veraltet.');
  if (
    (row.status === 'cancelled' || row.status === 'completed') &&
    input.status &&
    input.status !== row.status
  )
    throw new HttpError(409, 'EVENT_FINAL', 'Status ist endgültig.');
  if (input.status === 'cancelled')
    throw new HttpError(422, 'EVENT_USE_CANCEL', 'Absageaktion verwenden.');
  const { version, ...patch } = input,
    merged = eventInputSchema.parse({ ...inputOf(row), ...patch }),
    values = await validateEvent(tx, a, merged);
  const [registered] = await tx
    .select({ n: count() })
    .from(s.eventRegistrations)
    .where(
      and(
        eq(s.eventRegistrations.organizationId, a.organizationId),
        eq(s.eventRegistrations.eventOccurrenceId, id),
        eq(s.eventRegistrations.status, 'registered'),
      ),
    );
  if (merged.capacity !== null && registered!.n > merged.capacity)
    throw new HttpError(
      409,
      'EVENT_CAPACITY_BELOW_REGISTRATIONS',
      'Kapazität unter bestätigten Anmeldungen.',
    );
  if (row.status !== 'draft' && merged.status === 'draft' && registered!.n > 0)
    throw new HttpError(409, 'EVENT_HAS_REGISTRATIONS', 'Veranstaltung hat Anmeldungen.');
  await tx
    .update(e)
    .set({ ...values, version: version + 1, updatedAt: new Date() })
    .where(and(eq(e.organizationId, a.organizationId), eq(e.id, id)));
  if (
    (merged.capacity === null || (row.capacity !== null && merged.capacity > row.capacity)) &&
    merged.status === 'published'
  )
    await promoteWaitlist(tx, a, id);
  if (exception && row.seriesId)
    await tx.insert(s.eventOccurrenceExceptions).values({
      organizationId: a.organizationId,
      seriesId: row.seriesId,
      occurrenceId: id,
      originalStartAt: row.originalStartAt ?? row.startAt,
      exceptionType: 'override',
      overrideData: patch,
      createdBy: a.userId,
    });
  await audit(tx, a, 'update', 'event_occurrence', id, Object.keys(patch));
  return getEvent(tx, a, id);
}
export function patchEvent(db: Database, a: Access, key: string, id: string, input: EventPatch) {
  return eventWrite(db, a, key, `events:patch:${id}`, input, 'events:write', (tx, current) =>
    patchOccurrence(tx, current, id, input),
  );
}
export async function cancelOccurrence(
  tx: Transaction,
  a: Access,
  id: string,
  version: number,
  reason: string,
  exception = true,
) {
  const row = await eventRow(tx, a, id, true);
  if (row.version !== version) throw new HttpError(409, 'STALE_VERSION', 'Version veraltet.');
  if (row.status === 'completed') throw new HttpError(409, 'EVENT_FINAL', 'Bereits abgeschlossen.');
  if (row.status === 'cancelled') return getEvent(tx, a, id);
  await tx
    .update(e)
    .set({
      status: 'cancelled',
      cancellationReason: reason,
      version: version + 1,
      updatedAt: new Date(),
    })
    .where(eq(e.id, id));
  await tx
    .update(s.eventRegistrations)
    .set({
      status: 'cancelled',
      cancelledAt: new Date(),
      version: sql`${s.eventRegistrations.version}+1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(s.eventRegistrations.organizationId, a.organizationId),
        eq(s.eventRegistrations.eventOccurrenceId, id),
        sql`${s.eventRegistrations.status}<>'cancelled'`,
      ),
    );
  if (exception && row.seriesId)
    await tx.insert(s.eventOccurrenceExceptions).values({
      organizationId: a.organizationId,
      seriesId: row.seriesId,
      occurrenceId: id,
      originalStartAt: row.originalStartAt ?? row.startAt,
      exceptionType: 'skip',
      overrideData: { reason },
      createdBy: a.userId,
    });
  await audit(tx, a, 'cancel', 'event_occurrence', id, ['status', 'reason', 'registrations']);
  return getEvent(tx, a, id);
}
export function cancelEvent(
  db: Database,
  a: Access,
  key: string,
  id: string,
  input: { version: number; reason: string },
) {
  return eventWrite(db, a, key, `events:cancel:${id}`, input, 'events:write', (tx, current) =>
    cancelOccurrence(tx, current, id, input.version, input.reason),
  );
}
async function describeSeries(
  db: Executor,
  row: typeof s.eventSeries.$inferSelect,
): Promise<EventSeries> {
  const [n] = await db
    .select({ n: count() })
    .from(e)
    .where(and(eq(e.organizationId, row.organizationId), eq(e.seriesId, row.id)));
  return seriesResponseSchema.parse({ ...wire(row), occurrenceCount: n!.n });
}
export async function listSeries(db: Executor, a: Access) {
  const rows = await db
    .select()
    .from(s.eventSeries)
    .where(
      and(
        eq(s.eventSeries.organizationId, a.organizationId),
        ['admin', 'board'].includes(a.role) ? undefined : eq(s.eventSeries.createdBy, a.userId),
      ),
    )
    .orderBy(desc(s.eventSeries.createdAt));
  const items: EventSeries[] = [];
  for (const row of rows) items.push(await describeSeries(db, row));
  return { items };
}
export function createSeries(
  db: Database,
  a: Access,
  key: string,
  input: { event: EventInput; recurrenceRule: string },
) {
  return eventWrite(
    db,
    a,
    key,
    'event-series:create',
    input,
    'events:write',
    async (tx, current) => {
      await validateEvent(tx, current, input.event);
      let dates: ReturnType<typeof expandSeries>;
      try {
        dates = expandSeries(input.event, input.recurrenceRule);
      } catch (error) {
        throw new HttpError(
          422,
          error instanceof Error ? error.message : 'EVENT_INVALID_RECURRENCE',
          'Ungültige Serie.',
        );
      }
      const [series] = await tx
        .insert(s.eventSeries)
        .values({
          organizationId: a.organizationId,
          recurrenceRule: input.recurrenceRule,
          timezone: input.event.timezone,
          startLocal: input.event.startLocal,
          endLocal: input.event.endLocal,
          template: input.event,
          status: input.event.status,
          createdBy: a.userId,
        })
        .returning();
      for (const date of dates) {
        const values = await validateEvent(tx, current, { ...input.event, ...date });
        await tx.insert(e).values({
          ...values,
          organizationId: a.organizationId,
          seriesId: series!.id,
          originalStartAt: values.startAt,
          createdBy: a.userId,
        });
      }
      await audit(tx, current, 'create', 'event_series', series!.id, [
        'recurrenceRule',
        'occurrences',
      ]);
      return describeSeries(tx, series!);
    },
  );
}
export function patchSeries(
  db: Database,
  a: Access,
  key: string,
  id: string,
  input: { event?: Partial<EventInput>; recurrenceRule?: string; version: number; reason?: string },
) {
  return eventWrite(
    db,
    a,
    key,
    `event-series:patch:${id}`,
    input,
    'events:write',
    async (tx, current) => {
      const [series] = await tx
        .select()
        .from(s.eventSeries)
        .where(and(eq(s.eventSeries.organizationId, a.organizationId), eq(s.eventSeries.id, id)));
      if (!series) throw new HttpError(404, 'NOT_FOUND', 'Serie nicht gefunden.');
      if (!['admin', 'board'].includes(current.role) && series.createdBy !== a.userId)
        throw new HttpError(403, 'FORBIDDEN', 'Keine Berechtigung.');
      if (series.version !== input.version)
        throw new HttpError(409, 'STALE_VERSION', 'Version veraltet.');
      const template = eventInputSchema.parse({ ...series.template, ...input.event }),
        rule = input.recurrenceRule ?? series.recurrenceRule;
      if (template.status !== 'cancelled') await validateEvent(tx, current, template);
      let dates: ReturnType<typeof expandSeries>;
      try {
        dates = expandSeries(template, rule);
      } catch (error) {
        throw new HttpError(
          422,
          error instanceof Error ? error.message : 'EVENT_INVALID_RECURRENCE',
          'Ungültige Serie.',
        );
      }
      const now = new Date(),
        rows = await tx
          .select()
          .from(e)
          .where(and(eq(e.organizationId, a.organizationId), eq(e.seriesId, id)))
          .orderBy(asc(e.startAt));
      const exceptions = await tx
          .select({ id: s.eventOccurrenceExceptions.occurrenceId })
          .from(s.eventOccurrenceExceptions)
          .where(
            and(
              eq(s.eventOccurrenceExceptions.organizationId, a.organizationId),
              eq(s.eventOccurrenceExceptions.seriesId, id),
            ),
          ),
        excluded = new Set(exceptions.map((x) => x.id));
      if (['cancelled', 'completed'].includes(series.status) && template.status !== series.status)
        throw new HttpError(409, 'EVENT_FINAL', 'Serie ist abgeschlossen.');
      const future = rows.filter(
        (r) =>
          r.startAt > now &&
          !['completed', 'cancelled'].includes(r.status) &&
          (template.status === 'cancelled' || !excluded.has(r.id)),
      );
      if (
        rule !== series.recurrenceRule ||
        template.startLocal !== series.startLocal ||
        template.endLocal !== series.endLocal ||
        template.timezone !== series.timezone
      ) {
        // Preserve occurrence identities when registrations exist: structural rescheduling must be explicit per instance.
        const [registered] = await tx
          .select({ n: count() })
          .from(s.eventRegistrations)
          .where(
            and(
              eq(s.eventRegistrations.organizationId, a.organizationId),
              sql`${s.eventRegistrations.eventOccurrenceId} in (select id from event_occurrences where organization_id=${a.organizationId} and series_id=${id} and start_at>now())`,
              sql`${s.eventRegistrations.status}<>'cancelled'`,
            ),
          );
        if (registered!.n)
          throw new HttpError(
            409,
            'EVENT_SERIES_HAS_REGISTRATIONS',
            'Angemeldete Instanzen einzeln verschieben.',
          );
        const futureDates = dates
          .map((date) => ({ ...date, instant: new Date(date.startAt).toISOString() }))
          .filter((date) => new Date(date.startAt) > now);
        const keep = new Set(futureDates.map((date) => date.instant));
        const protectedDates = new Set(
          rows
            .filter((r) => !future.includes(r))
            .map((r) => (r.originalStartAt ?? r.startAt).toISOString()),
        );
        for (const row of future)
          if (!keep.has((row.originalStartAt ?? row.startAt).toISOString()))
            await cancelOccurrence(tx, current, row.id, row.version, 'Serienänderung', false);
        for (const date of futureDates) {
          if (protectedDates.has(date.instant)) continue;
          const values = await validateEvent(tx, current, { ...template, ...date });
          const existing = future.find(
            (r) => (r.originalStartAt ?? r.startAt).toISOString() === date.instant,
          );
          if (existing)
            await tx
              .update(e)
              .set({ ...values, version: existing.version + 1, updatedAt: new Date() })
              .where(eq(e.id, existing.id));
          else
            await tx.insert(e).values({
              ...values,
              organizationId: a.organizationId,
              seriesId: id,
              originalStartAt: values.startAt,
              createdBy: a.userId,
            });
        }
      } else
        for (const row of future) {
          const { startLocal: _, endLocal: __, ...patch } = input.event ?? {};
          void _;
          void __;
          if (patch.status === 'cancelled')
            await cancelOccurrence(
              tx,
              current,
              row.id,
              row.version,
              input.reason ?? 'Serie abgesagt',
              false,
            );
          else
            await patchOccurrence(tx, current, row.id, { ...patch, version: row.version }, false);
        }
      const [updated] = await tx
        .update(s.eventSeries)
        .set({
          template,
          recurrenceRule: rule,
          timezone: template.timezone,
          startLocal: template.startLocal,
          endLocal: template.endLocal,
          status: template.status,
          cancellationReason:
            template.status === 'cancelled'
              ? (input.reason ?? 'Serie abgesagt')
              : series.cancellationReason,
          version: input.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(s.eventSeries.id, id))
        .returning();
      await audit(tx, current, 'update', 'event_series', id, ['futureOccurrences']);
      return describeSeries(tx, updated!);
    },
  );
}
export async function eventPeople(db: Executor, a: Access, search: string) {
  if (!can(a.role, 'events:write')) throw new HttpError(403, 'FORBIDDEN', 'Keine Berechtigung.');
  const rows = await db
    .select({
      id: s.persons.id,
      displayName: sql<string>`${s.persons.firstName}||' '||${s.persons.lastName}`,
      member: sql<boolean>`exists(select 1 from memberships m where m.organization_id=${s.persons.organizationId} and m.person_id=${s.persons.id})`,
    })
    .from(s.persons)
    .where(
      and(
        eq(s.persons.organizationId, a.organizationId),
        search
          ? or(
              ilike(s.persons.firstName, `%${escapeLike(search)}%`),
              ilike(s.persons.lastName, `%${escapeLike(search)}%`),
            )
          : undefined,
      ),
    )
    .orderBy(s.persons.lastName, s.persons.firstName, s.persons.id)
    .limit(100);
  return { items: rows };
}
export async function eventOrganizers(db: Executor, a: Access) {
  const rows = await db
    .select({ id: s.user.id, name: s.user.name, role: s.organizationUserRoles.role })
    .from(s.organizationUserRoles)
    .innerJoin(s.user, eq(s.user.id, s.organizationUserRoles.userId))
    .where(eq(s.organizationUserRoles.organizationId, a.organizationId));
  return {
    items: rows.filter((r) => can(r.role, 'events:write')).map(({ id, name }) => ({ id, name })),
  };
}
