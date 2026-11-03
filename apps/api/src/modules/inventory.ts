import { csvCell } from '@bnature/contracts';
import {
  and,
  eq,
  sql,
  asc,
  desc,
  count,
  ilike,
  or,
  isNull,
  isNotNull,
  lt,
  type SQL,
} from 'drizzle-orm';
import { schema as s, type Database, type Executor } from '@bnature/db';
import {
  inventoryItemSchema,
  inventoryLoanSchema,
  type InventoryItem,
  type InventoryItemInput,
  type InventoryItemQuery,
  type InventoryLoanInput,
  type InventoryLoanQuery,
  type inventoryItemPatchSchema,
  type inventoryRetireSchema,
  type inventoryLoanReturnSchema,
  type inventoryLoanExtendSchema,
} from '@bnature/contracts';
import type { z } from 'zod';
import { HttpError, type Access } from '../middleware/access';
import { audit } from '../services/audit';
import { financialOperation, readSnapshot } from './finance/operations';
import { businessDate } from './finance/service';
import { ownPerson } from './events';
import { escapeLike } from './members';
import { wire } from './responses';

const ii = s.inventoryItems,
  il = s.inventoryLoans;
// Single-table selects render columns unqualified, so correlated subqueries name the table.
const lentSql = sql<number>`(select coalesce(sum(l.quantity),0)::int from inventory_loans l where l.organization_id="inventory_items"."organization_id" and l.item_id="inventory_items"."id" and l.returned_on is null)`;
const overdueSql = (today: string) =>
  sql<number>`(select count(*)::int from inventory_loans l where l.organization_id="inventory_items"."organization_id" and l.item_id="inventory_items"."id" and l.returned_on is null and l.due_on < ${today})`;
const itemColumns = (today: string) => ({
  id: ii.id,
  inventoryNumber: ii.inventoryNumber,
  name: ii.name,
  category: ii.category,
  description: ii.description,
  location: ii.location,
  condition: ii.condition,
  quantity: ii.quantity,
  purchasedOn: ii.purchasedOn,
  valueCents: ii.valueCents,
  notes: ii.notes,
  status: ii.status,
  retiredOn: ii.retiredOn,
  retiredReason: ii.retiredReason,
  version: ii.version,
  createdAt: ii.createdAt,
  updatedAt: ii.updatedAt,
  lentQuantity: lentSql,
  overdueLoans: overdueSql(today),
});
const presentItem = (row: Record<string, unknown> & { quantity: number; lentQuantity: number }) =>
  inventoryItemSchema.parse({
    ...wire(row),
    availableQuantity: row.quantity - row.lentQuantity,
  });

export async function getItem(db: Executor, a: Access, id: string): Promise<InventoryItem> {
  const today = await businessDate(db, a.organizationId);
  const [row] = await db
    .select(itemColumns(today))
    .from(ii)
    .where(and(eq(ii.organizationId, a.organizationId), eq(ii.id, id)));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Gegenstand nicht gefunden.');
  return presentItem(row);
}
function itemFilter(a: Access, q: Omit<InventoryItemQuery, 'page' | 'pageSize'>, today: string) {
  const search = `%${escapeLike(q.search)}%`;
  const conditions: (SQL | undefined)[] = [
    eq(ii.organizationId, a.organizationId),
    q.status === 'all' ? undefined : eq(ii.status, q.status),
    q.category ? eq(ii.category, q.category) : undefined,
    q.condition ? eq(ii.condition, q.condition) : undefined,
    q.search
      ? or(
          ilike(ii.name, search),
          ilike(ii.inventoryNumber, search),
          ilike(ii.location, search),
          ilike(ii.description, search),
        )
      : undefined,
    q.availability === 'available' ? sql`${lentSql} < ${ii.quantity}` : undefined,
    q.availability === 'lent' ? sql`${lentSql} > 0` : undefined,
    q.availability === 'overdue' ? sql`${overdueSql(today)} > 0` : undefined,
  ];
  return and(...conditions);
}
export async function listItems(db: Database, a: Access, q: InventoryItemQuery) {
  return readSnapshot(db, async (tx) => {
    const today = await businessDate(tx, a.organizationId);
    const where = itemFilter(a, q, today);
    const rows = await tx
      .select(itemColumns(today))
      .from(ii)
      .where(where)
      .orderBy(asc(ii.name), asc(ii.inventoryNumber), asc(ii.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [total] = await tx.select({ n: count() }).from(ii).where(where);
    return {
      items: rows.map(presentItem),
      total: total?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  });
}
export async function inventorySummary(db: Database, a: Access) {
  return readSnapshot(db, async (tx) => {
    const today = await businessDate(tx, a.organizationId);
    const [totals] = await tx
      .select({
        items: sql<number>`count(*)::int`,
        pieces: sql<number>`coalesce(sum(${ii.quantity}),0)::int`,
        valueCents: sql<number>`coalesce(sum(${ii.valueCents}::bigint * ${ii.quantity}),0)::bigint`,
        needsAttention: sql<number>`count(*) filter (where ${ii.condition} in ('damaged','defective'))::int`,
      })
      .from(ii)
      .where(and(eq(ii.organizationId, a.organizationId), eq(ii.status, 'active')));
    const [loans] = await tx
      .select({
        openLoans: sql<number>`count(*)::int`,
        lentPieces: sql<number>`coalesce(sum(${il.quantity}),0)::int`,
        overdueLoans: sql<number>`count(*) filter (where ${il.dueOn} < ${today})::int`,
      })
      .from(il)
      .where(and(eq(il.organizationId, a.organizationId), isNull(il.returnedOn)));
    const categories = await tx
      .selectDistinct({ category: ii.category })
      .from(ii)
      .where(and(eq(ii.organizationId, a.organizationId), sql`${ii.category} <> ''`))
      .orderBy(asc(ii.category));
    return {
      items: totals?.items ?? 0,
      pieces: totals?.pieces ?? 0,
      valueCents: Number(totals?.valueCents ?? 0),
      needsAttention: totals?.needsAttention ?? 0,
      openLoans: loans?.openLoans ?? 0,
      lentPieces: loans?.lentPieces ?? 0,
      overdueLoans: loans?.overdueLoans ?? 0,
      categories: categories.map((c) => c.category),
    };
  });
}
const itemResult =
  (db: Database, a: Access) => async (r: { data: { id: string }; replayed: boolean }) => ({
    data: await getItem(db, a, r.data.id),
    replayed: r.replayed,
  });
export function createItem(db: Database, a: Access, key: string, input: InventoryItemInput) {
  return financialOperation(
    db,
    a,
    key,
    'inventory:create',
    input,
    'inventory:write',
    async (tx) => {
      const [row] = await tx
        .insert(ii)
        .values({ ...input, organizationId: a.organizationId, createdBy: a.userId })
        .returning({ id: ii.id });
      await audit(tx, a, 'create', 'inventory_item', row!.id, Object.keys(input));
      return { id: row!.id };
    },
  ).then(itemResult(db, a));
}
async function lockedItem(tx: Executor, a: Access, id: string, version: number) {
  const [row] = await tx
    .select()
    .from(ii)
    .where(and(eq(ii.organizationId, a.organizationId), eq(ii.id, id)))
    .for('update');
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Gegenstand nicht gefunden.');
  if (row.version !== version)
    throw new HttpError(409, 'STALE_VERSION', 'Der Gegenstand wurde zwischenzeitlich geändert.');
  return row;
}
async function lentPieces(tx: Executor, a: Access, itemId: string) {
  const [row] = await tx
    .select({ n: sql<number>`coalesce(sum(${il.quantity}),0)::int` })
    .from(il)
    .where(
      and(eq(il.organizationId, a.organizationId), eq(il.itemId, itemId), isNull(il.returnedOn)),
    );
  return row?.n ?? 0;
}
export function updateItem(
  db: Database,
  a: Access,
  key: string,
  id: string,
  input: z.infer<typeof inventoryItemPatchSchema>,
) {
  return financialOperation(
    db,
    a,
    key,
    `inventory:update:${id}`,
    input,
    'inventory:write',
    async (tx) => {
      const row = await lockedItem(tx, a, id, input.version);
      if (row.status === 'retired')
        throw new HttpError(409, 'INVENTORY_RETIRED', 'Ausgemusterte Gegenstände sind gesperrt.');
      const { version, ...patch } = input;
      // Clear message before the database trigger rejects the change.
      if (patch.quantity !== undefined && patch.quantity < (await lentPieces(tx, a, id)))
        throw new HttpError(
          409,
          'INVENTORY_QUANTITY_LENT',
          'Der Bestand kann nicht unter die verliehene Stückzahl sinken.',
        );
      await tx
        .update(ii)
        .set({ ...patch, version: version + 1, updatedAt: new Date() })
        .where(and(eq(ii.organizationId, a.organizationId), eq(ii.id, id)));
      await audit(tx, a, 'update', 'inventory_item', id, Object.keys(patch));
      return { id };
    },
  ).then(itemResult(db, a));
}
export function retireItem(
  db: Database,
  a: Access,
  key: string,
  id: string,
  input: z.infer<typeof inventoryRetireSchema>,
) {
  return financialOperation(
    db,
    a,
    key,
    `inventory:retire:${id}`,
    input,
    'inventory:write',
    async (tx) => {
      const row = await lockedItem(tx, a, id, input.version);
      if (row.status === 'retired')
        throw new HttpError(409, 'INVENTORY_RETIRED', 'Der Gegenstand ist bereits ausgemustert.');
      if (await lentPieces(tx, a, id))
        throw new HttpError(
          409,
          'INVENTORY_OPEN_LOANS',
          'Vor dem Ausmustern müssen alle Ausleihen zurückgegeben sein.',
        );
      await tx
        .update(ii)
        .set({
          status: 'retired',
          retiredOn: input.retiredOn,
          retiredReason: input.reason,
          version: input.version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(ii.organizationId, a.organizationId), eq(ii.id, id)));
      await audit(tx, a, 'retire', 'inventory_item', id, ['status', 'retiredOn', 'retiredReason']);
      return { id };
    },
  ).then(itemResult(db, a));
}

const loanColumns = {
  id: il.id,
  itemId: il.itemId,
  itemName: ii.name,
  inventoryNumber: ii.inventoryNumber,
  personId: il.personId,
  borrowerName: sql<string>`${s.persons.firstName}||' '||${s.persons.lastName}`,
  borrowerEmail: s.persons.email,
  borrowerIsMember: sql<boolean>`exists(select 1 from memberships m where m.organization_id=${il.organizationId} and m.person_id=${il.personId} and m.status='active')`,
  quantity: il.quantity,
  issuedOn: il.issuedOn,
  dueOn: il.dueOn,
  issueCondition: il.issueCondition,
  notes: il.notes,
  returnedOn: il.returnedOn,
  returnCondition: il.returnCondition,
  returnNotes: il.returnNotes,
  version: il.version,
  createdAt: il.createdAt,
};
function loanQuery(db: Executor) {
  return db
    .select(loanColumns)
    .from(il)
    .innerJoin(ii, and(eq(ii.organizationId, il.organizationId), eq(ii.id, il.itemId)))
    .innerJoin(
      s.persons,
      and(eq(s.persons.organizationId, il.organizationId), eq(s.persons.id, il.personId)),
    );
}
type LoanRow = Awaited<ReturnType<ReturnType<typeof loanQuery>['execute']>>[number];
const presentLoan = (row: LoanRow, today: string) => {
  const open = !row.returnedOn;
  const late = open && row.dueOn < today;
  return inventoryLoanSchema.parse({
    ...wire(row),
    overdue: late,
    daysOverdue: late ? Math.round((Date.parse(today) - Date.parse(row.dueOn)) / 86_400_000) : 0,
  });
};
export async function getLoan(db: Executor, a: Access, id: string) {
  const today = await businessDate(db, a.organizationId);
  const [row] = await loanQuery(db).where(
    and(eq(il.organizationId, a.organizationId), eq(il.id, id)),
  );
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Ausleihe nicht gefunden.');
  return presentLoan(row, today);
}
export async function listLoans(db: Database, a: Access, q: InventoryLoanQuery, own?: string) {
  return readSnapshot(db, async (tx) => {
    const today = await businessDate(tx, a.organizationId);
    const search = `%${escapeLike(q.search)}%`;
    const where = and(
      eq(il.organizationId, a.organizationId),
      q.state === 'open' ? isNull(il.returnedOn) : undefined,
      q.state === 'overdue' ? and(isNull(il.returnedOn), lt(il.dueOn, today)) : undefined,
      q.state === 'returned' ? isNotNull(il.returnedOn) : undefined,
      q.itemId ? eq(il.itemId, q.itemId) : undefined,
      own ? eq(il.personId, own) : q.personId ? eq(il.personId, q.personId) : undefined,
      q.search
        ? or(
            ilike(ii.name, search),
            ilike(ii.inventoryNumber, search),
            ilike(sql`${s.persons.firstName} || ' ' || ${s.persons.lastName}`, search),
          )
        : undefined,
    );
    const rows = await loanQuery(tx)
      .where(where)
      .orderBy(
        q.state === 'returned' ? desc(il.returnedOn) : asc(il.dueOn),
        asc(ii.name),
        asc(il.id),
      )
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [total] = await tx
      .select({ n: count() })
      .from(il)
      .innerJoin(ii, and(eq(ii.organizationId, il.organizationId), eq(ii.id, il.itemId)))
      .innerJoin(
        s.persons,
        and(eq(s.persons.organizationId, il.organizationId), eq(s.persons.id, il.personId)),
      )
      .where(where);
    return {
      items: rows.map((row) => presentLoan(row, today)),
      total: total?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  });
}
export async function myLoans(db: Database, a: Access, q: InventoryLoanQuery) {
  const personId = await ownPerson(db, a);
  if (!personId) return { items: [], total: 0, page: q.page, pageSize: q.pageSize };
  return listLoans(db, a, { ...q, itemId: undefined, personId: undefined, search: '' }, personId);
}
const loanResult =
  (db: Database, a: Access) => async (r: { data: { id: string }; replayed: boolean }) => ({
    data: await getLoan(db, a, r.data.id),
    replayed: r.replayed,
  });
export function createLoan(db: Database, a: Access, key: string, input: InventoryLoanInput) {
  return financialOperation(db, a, key, 'inventory:lend', input, 'inventory:lend', async (tx) => {
    // Locking the item serializes concurrent loans; the trigger re-checks the same rule.
    const [item] = await tx
      .select()
      .from(ii)
      .where(and(eq(ii.organizationId, a.organizationId), eq(ii.id, input.itemId)))
      .for('update');
    if (!item) throw new HttpError(404, 'NOT_FOUND', 'Gegenstand nicht gefunden.');
    if (item.status !== 'active')
      throw new HttpError(409, 'INVENTORY_RETIRED', 'Ausgemusterte Gegenstände sind gesperrt.');
    const [person] = await tx
      .select({ id: s.persons.id })
      .from(s.persons)
      .where(and(eq(s.persons.organizationId, a.organizationId), eq(s.persons.id, input.personId)));
    if (!person) throw new HttpError(404, 'NOT_FOUND', 'Person nicht gefunden.');
    const available = item.quantity - (await lentPieces(tx, a, item.id));
    if (input.quantity > available)
      throw new HttpError(409, 'INVENTORY_NOT_AVAILABLE', `Nur ${available} Stück verfügbar.`);
    const [row] = await tx
      .insert(il)
      .values({
        ...input,
        issueCondition: input.issueCondition ?? item.condition,
        organizationId: a.organizationId,
        createdBy: a.userId,
      })
      .returning({ id: il.id });
    await audit(tx, a, 'lend', 'inventory_loan', row!.id, [
      'itemId',
      'personId',
      'quantity',
      'dueOn',
    ]);
    return { id: row!.id };
  }).then(loanResult(db, a));
}
async function lockedLoan(tx: Executor, a: Access, id: string, version: number) {
  const [row] = await tx
    .select()
    .from(il)
    .where(and(eq(il.organizationId, a.organizationId), eq(il.id, id)))
    .for('update');
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Ausleihe nicht gefunden.');
  if (row.version !== version)
    throw new HttpError(409, 'STALE_VERSION', 'Die Ausleihe wurde zwischenzeitlich geändert.');
  if (row.returnedOn)
    throw new HttpError(409, 'INVENTORY_RETURNED', 'Die Ausleihe ist bereits zurückgegeben.');
  return row;
}
export function returnLoan(
  db: Database,
  a: Access,
  key: string,
  id: string,
  input: z.infer<typeof inventoryLoanReturnSchema>,
) {
  return financialOperation(
    db,
    a,
    key,
    `inventory:return:${id}`,
    input,
    'inventory:lend',
    async (tx) => {
      const loan = await lockedLoan(tx, a, id, input.version);
      if (input.returnedOn < loan.issuedOn)
        throw new HttpError(422, 'VALIDATION_ERROR', 'Die Rückgabe liegt vor der Ausgabe.');
      const today = await businessDate(tx, a.organizationId);
      if (input.returnedOn > today)
        throw new HttpError(
          422,
          'VALIDATION_ERROR',
          'Die Rückgabe kann nicht in der Zukunft liegen.',
        );
      await tx
        .update(il)
        .set({
          returnedOn: input.returnedOn,
          returnCondition: input.returnCondition,
          returnNotes: input.returnNotes,
          returnedBy: a.userId,
          version: input.version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(il.organizationId, a.organizationId), eq(il.id, id)));
      // A single piece carries its condition back to the item; batches keep the batch condition
      // and document individual damage in the return notes.
      const [item] = await tx
        .select()
        .from(ii)
        .where(and(eq(ii.organizationId, a.organizationId), eq(ii.id, loan.itemId)))
        .for('update');
      if (item && item.quantity === 1 && item.condition !== input.returnCondition) {
        await tx
          .update(ii)
          .set({
            condition: input.returnCondition,
            version: item.version + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(ii.organizationId, a.organizationId), eq(ii.id, item.id)));
        await audit(tx, a, 'update', 'inventory_item', item.id, ['condition']);
      }
      await audit(tx, a, 'return', 'inventory_loan', id, [
        'returnedOn',
        'returnCondition',
        'returnNotes',
      ]);
      return { id };
    },
  ).then(loanResult(db, a));
}
export function extendLoan(
  db: Database,
  a: Access,
  key: string,
  id: string,
  input: z.infer<typeof inventoryLoanExtendSchema>,
) {
  return financialOperation(
    db,
    a,
    key,
    `inventory:extend:${id}`,
    input,
    'inventory:lend',
    async (tx) => {
      const loan = await lockedLoan(tx, a, id, input.version);
      if (input.dueOn < loan.issuedOn)
        throw new HttpError(422, 'VALIDATION_ERROR', 'Das Rückgabedatum liegt vor der Ausgabe.');
      await tx
        .update(il)
        .set({
          dueOn: input.dueOn,
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          version: input.version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(il.organizationId, a.organizationId), eq(il.id, id)));
      await audit(tx, a, 'update', 'inventory_loan', id, [
        'dueOn',
        ...(input.notes !== undefined ? ['notes'] : []),
      ]);
      return { id };
    },
  ).then(loanResult(db, a));
}

const exportLabels = {
  de: {
    number: 'Inventarnummer',
    name: 'Bezeichnung',
    category: 'Kategorie',
    location: 'Lagerort',
    condition: 'Zustand',
    quantity: 'Bestand',
    lent: 'Verliehen',
    available: 'Verfügbar',
    purchased: 'Anschaffung',
    value: 'Stückwert EUR',
    status: 'Status',
    conditions: {
      new: 'neu',
      good: 'gut',
      worn: 'abgenutzt',
      damaged: 'beschädigt',
      defective: 'defekt',
    },
    statuses: { active: 'aktiv', retired: 'ausgemustert' },
  },
  it: {
    number: 'Numero inventario',
    name: 'Denominazione',
    category: 'Categoria',
    location: 'Ubicazione',
    condition: 'Stato',
    quantity: 'Quantità',
    lent: 'In prestito',
    available: 'Disponibili',
    purchased: 'Acquisto',
    value: 'Valore unitario EUR',
    status: 'Stato voce',
    conditions: {
      new: 'nuovo',
      good: 'buono',
      worn: 'usurato',
      damaged: 'danneggiato',
      defective: 'guasto',
    },
    statuses: { active: 'attivo', retired: 'dismesso' },
  },
} as const;
export async function exportItems(
  db: Database,
  a: Access,
  q: { status: 'active' | 'retired' | 'all'; language: 'de' | 'it' },
) {
  return readSnapshot(db, async (tx) => {
    const today = await businessDate(tx, a.organizationId);
    const rows = await tx
      .select(itemColumns(today))
      .from(ii)
      .where(
        and(
          eq(ii.organizationId, a.organizationId),
          q.status === 'all' ? undefined : eq(ii.status, q.status),
        ),
      )
      .orderBy(asc(ii.category), asc(ii.name), asc(ii.id));
    if (rows.length > 10_000)
      throw new HttpError(422, 'EXPORT_TOO_LARGE', 'Bitte die Auswahl eingrenzen.');
    const t = exportLabels[q.language];
    // Both locales use a decimal comma, which spreadsheet imports with ';' expect.
    const money = (cents: number | null) =>
      cents === null ? '' : (cents / 100).toFixed(2).replace('.', ',');
    return (
      '﻿' +
      [
        [
          t.number,
          t.name,
          t.category,
          t.location,
          t.condition,
          t.quantity,
          t.lent,
          t.available,
          t.purchased,
          t.value,
          t.status,
        ],
        ...rows.map((r) => [
          r.inventoryNumber,
          r.name,
          r.category,
          r.location,
          t.conditions[r.condition],
          r.quantity,
          r.lentQuantity,
          r.quantity - r.lentQuantity,
          r.purchasedOn ?? '',
          money(r.valueCents),
          t.statuses[r.status],
        ]),
      ]
        .map((row) => row.map(csvCell).join(';'))
        .join('\r\n')
    );
  });
}
// Borrower picker: only what is needed to choose a person (no contact or register data).
export async function borrowerOptions(db: Executor, a: Access) {
  const rows = await db
    .select({
      id: s.persons.id,
      name: sql<string>`${s.persons.lastName}||' '||${s.persons.firstName}`,
      // Single-table selects render columns unqualified, so the subquery names the table.
      isMember: sql<boolean>`exists(select 1 from memberships m where m.organization_id="persons"."organization_id" and m.person_id="persons"."id" and m.status='active')`,
    })
    .from(s.persons)
    .where(eq(s.persons.organizationId, a.organizationId))
    .orderBy(asc(s.persons.lastName), asc(s.persons.firstName), asc(s.persons.id))
    .limit(5000);
  return { items: rows };
}
