import { and, eq, sql, asc, desc, count, ilike, or, type SQL } from 'drizzle-orm';
import { schema as s, type Database, type Executor, type Transaction } from '@bnature/db';
import {
  MAX_CENTS,
  accountResponseSchema,
  categoryResponseSchema,
  fiscalYearResponseSchema,
  cashbookEntryResponseSchema,
  reportTemplateResponseSchema,
  annualReportSchema,
  type AccountInput,
  type AccountPatch,
  type CategoryInput,
  type CategoryPatch,
  type FiscalYearInput,
  type CashbookEntryInput,
  type CashbookQuery,
  type CashbookEntry,
  type ReversalInput,
  type BookingInput,
  type PaymentReversalInput,
  type ReportTemplateInput,
  type AccountBalance,
  type AnnualReport,
  type FiscalYear,
  type Page,
} from '@bnature/contracts';
import { HttpError, type Access } from '../../middleware/access';
import { audit } from '../../services/audit';
import { wire } from '../responses';
import { escapeLike } from '../members';
import { financialOperation } from './operations';
import { getPayment } from './service';

const readOnly = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const;
const receipt = (n: number) => `BN-${String(n).padStart(6, '0')}`;

export async function listAccounts(db: Executor, org: string) {
  const rows = await db
    .select()
    .from(s.financeAccounts)
    .where(eq(s.financeAccounts.organizationId, org))
    .orderBy(asc(s.financeAccounts.name), asc(s.financeAccounts.id));
  return { items: rows.map((r) => accountResponseSchema.parse(wire(r))) };
}
async function getAccount(db: Executor, org: string, id: string) {
  const [row] = await db
    .select()
    .from(s.financeAccounts)
    .where(and(eq(s.financeAccounts.organizationId, org), eq(s.financeAccounts.id, id)));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Konto nicht gefunden.');
  return row;
}
async function assertNameFree(
  db: Executor,
  table: typeof s.financeAccounts | typeof s.cashbookCategories,
  org: string,
  name: string,
  exceptId?: string,
) {
  const [existing] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.organizationId, org), eq(table.name, name)));
  if (existing && existing.id !== exceptId)
    throw new HttpError(409, 'NAME_EXISTS', 'Dieser Name wird bereits verwendet.');
}
export function createAccount(db: Database, access: Access, key: string, input: AccountInput) {
  return financialOperation(
    db,
    access,
    key,
    'finance-accounts:create',
    input,
    'finance:write',
    async (tx) => {
      await assertNameFree(tx, s.financeAccounts, access.organizationId, input.name);
      const [row] = await tx
        .insert(s.financeAccounts)
        .values({ ...input, organizationId: access.organizationId })
        .returning();
      await audit(tx, access, 'create', 'finance_account', row!.id, Object.keys(input));
      return accountResponseSchema.parse(wire(row));
    },
  );
}
export function updateAccount(
  db: Database,
  access: Access,
  key: string,
  id: string,
  input: AccountPatch,
) {
  return financialOperation(
    db,
    access,
    key,
    `finance-accounts:update:${id}`,
    input,
    'finance:write',
    async (tx) => {
      const current = await getAccount(tx, access.organizationId, id);
      if (current.version !== input.version)
        throw new HttpError(409, 'STALE_VERSION', 'Das Konto wurde zwischenzeitlich geändert.');
      const { version, ...patch } = input;
      if (patch.name)
        await assertNameFree(tx, s.financeAccounts, access.organizationId, patch.name, id);
      const [row] = await tx
        .update(s.financeAccounts)
        .set({ ...patch, version: version + 1, updatedAt: new Date() })
        .where(
          and(
            eq(s.financeAccounts.organizationId, access.organizationId),
            eq(s.financeAccounts.id, id),
          ),
        )
        .returning();
      await audit(tx, access, 'update', 'finance_account', id, Object.keys(patch));
      return accountResponseSchema.parse(wire(row));
    },
  );
}
export async function listCategories(db: Executor, org: string) {
  const rows = await db
    .select()
    .from(s.cashbookCategories)
    .where(eq(s.cashbookCategories.organizationId, org))
    .orderBy(
      asc(s.cashbookCategories.direction),
      asc(s.cashbookCategories.name),
      asc(s.cashbookCategories.id),
    );
  return { items: rows.map((r) => categoryResponseSchema.parse(wire(r))) };
}
async function getCategory(db: Executor, org: string, id: string) {
  const [row] = await db
    .select()
    .from(s.cashbookCategories)
    .where(and(eq(s.cashbookCategories.organizationId, org), eq(s.cashbookCategories.id, id)));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Kategorie nicht gefunden.');
  return row;
}
export function createCategory(db: Database, access: Access, key: string, input: CategoryInput) {
  return financialOperation(
    db,
    access,
    key,
    'cashbook-categories:create',
    input,
    'finance:write',
    async (tx) => {
      await assertNameFree(tx, s.cashbookCategories, access.organizationId, input.name);
      const [row] = await tx
        .insert(s.cashbookCategories)
        .values({ ...input, organizationId: access.organizationId })
        .returning();
      await audit(tx, access, 'create', 'cashbook_category', row!.id, Object.keys(input));
      return categoryResponseSchema.parse(wire(row));
    },
  );
}
export function updateCategory(
  db: Database,
  access: Access,
  key: string,
  id: string,
  input: CategoryPatch,
) {
  return financialOperation(
    db,
    access,
    key,
    `cashbook-categories:update:${id}`,
    input,
    'finance:write',
    async (tx) => {
      const current = await getCategory(tx, access.organizationId, id);
      if (current.version !== input.version)
        throw new HttpError(409, 'STALE_VERSION', 'Die Kategorie wurde zwischenzeitlich geändert.');
      const { version, ...patch } = input;
      if (patch.name)
        await assertNameFree(tx, s.cashbookCategories, access.organizationId, patch.name, id);
      const [row] = await tx
        .update(s.cashbookCategories)
        .set({ ...patch, version: version + 1, updatedAt: new Date() })
        .where(
          and(
            eq(s.cashbookCategories.organizationId, access.organizationId),
            eq(s.cashbookCategories.id, id),
          ),
        )
        .returning();
      await audit(tx, access, 'update', 'cashbook_category', id, Object.keys(patch));
      return categoryResponseSchema.parse(wire(row));
    },
  );
}

// Closing = opening + income - expense; reversals carry negative amounts in their original direction.
export async function accountBalances(
  db: Executor,
  org: string,
  year: number,
): Promise<AccountBalance[]> {
  const result = await db.execute<{
    accountId: string;
    name: string;
    kind: 'cash' | 'bank';
    openingCents: string;
    incomeCents: string;
    expenseCents: string;
  }>(sql`
    select a.id as "accountId", a.name, a.kind,
      coalesce(ob.amount_cents, 0)::text as "openingCents",
      coalesce(sum(e.amount_cents) filter (where e.direction = 'income'), 0)::text as "incomeCents",
      coalesce(sum(e.amount_cents) filter (where e.direction = 'expense'), 0)::text as "expenseCents"
    from finance_accounts a
    left join fiscal_year_opening_balances ob
      on ob.organization_id = a.organization_id and ob.account_id = a.id and ob.fiscal_year = ${year}
    left join cashbook_entries e
      on e.organization_id = a.organization_id and e.account_id = a.id and e.fiscal_year = ${year}
    where a.organization_id = ${org}
    group by a.id, a.name, a.kind, ob.amount_cents
    order by a.name, a.id`);
  return result.rows.map((row) => ({
    ...row,
    closingCents: String(
      BigInt(row.openingCents) + BigInt(row.incomeCents) - BigInt(row.expenseCents),
    ),
  }));
}
async function fiscalYearRow(db: Executor, org: string, year: number) {
  const [row] = await db
    .select()
    .from(s.fiscalYears)
    .where(and(eq(s.fiscalYears.organizationId, org), eq(s.fiscalYears.year, year)));
  return row;
}
async function describeYear(
  db: Executor,
  org: string,
  row: typeof s.fiscalYears.$inferSelect,
): Promise<FiscalYear> {
  const balances = await accountBalances(db, org, row.year);
  let openingMismatch = false;
  if (await fiscalYearRow(db, org, row.year - 1)) {
    const previous = new Map(
      (await accountBalances(db, org, row.year - 1)).map((b) => [b.accountId, b.closingCents]),
    );
    openingMismatch = balances.some((b) => (previous.get(b.accountId) ?? '0') !== b.openingCents);
  }
  return fiscalYearResponseSchema.parse({
    id: row.id,
    year: row.year,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    openingMismatch,
    balances,
  });
}
export async function listFiscalYears(db: Database, org: string) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(s.fiscalYears)
      .where(eq(s.fiscalYears.organizationId, org))
      .orderBy(desc(s.fiscalYears.year));
    const items: FiscalYear[] = [];
    for (const row of rows) items.push(await describeYear(tx, org, row));
    return { items };
  }, readOnly);
}
export function openFiscalYear(db: Database, access: Access, key: string, input: FiscalYearInput) {
  return financialOperation(
    db,
    access,
    key,
    'fiscal-years:create',
    input,
    'finance:write',
    async (tx) => {
      const org = access.organizationId;
      if (await fiscalYearRow(tx, org, input.year))
        throw new HttpError(
          409,
          'FISCAL_YEAR_EXISTS',
          'Dieses Geschäftsjahr ist bereits eröffnet.',
        );
      let balances = input.openingBalances;
      if (!balances) {
        const previous = await fiscalYearRow(tx, org, input.year - 1);
        if (previous && previous.status !== 'closed')
          throw new HttpError(
            409,
            'PREVIOUS_YEAR_OPEN',
            'Das Vorjahr ist noch offen. Anfangsbestände bitte ausdrücklich angeben.',
          );
        balances = previous
          ? (await accountBalances(tx, org, previous.year))
              .filter((b) => b.closingCents !== '0')
              .map((b) => {
                const cents = BigInt(b.closingCents);
                if (cents > BigInt(MAX_CENTS) || cents < -BigInt(MAX_CENTS))
                  throw new HttpError(422, 'BALANCE_OUT_OF_RANGE', 'Saldo außerhalb des Bereichs.');
                return { accountId: b.accountId, amountCents: Number(cents) };
              })
          : [];
      }
      for (const balance of balances) {
        const account = await getAccount(tx, org, balance.accountId);
        if (account.kind === 'cash' && balance.amountCents < 0)
          throw new HttpError(422, 'NEGATIVE_CASH', 'Ein Kassenbestand kann nicht negativ sein.');
      }
      const [row] = await tx
        .insert(s.fiscalYears)
        .values({ organizationId: org, year: input.year, openedBy: access.userId })
        .returning();
      const nonZero = balances.filter((b) => b.amountCents !== 0);
      if (nonZero.length)
        await tx
          .insert(s.fiscalYearOpeningBalances)
          .values(nonZero.map((b) => ({ ...b, organizationId: org, fiscalYear: input.year })));
      await audit(tx, access, 'open_year', 'fiscal_year', row!.id, ['year', 'openingBalances']);
      return describeYear(tx, org, row!);
    },
  );
}
export function closeFiscalYear(db: Database, access: Access, key: string, year: number) {
  return financialOperation(
    db,
    access,
    key,
    `fiscal-years:close:${year}`,
    {},
    'finance:close',
    async (tx) => {
      const org = access.organizationId,
        row = await fiscalYearRow(tx, org, year);
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Geschäftsjahr nicht gefunden.');
      if (row.status === 'closed')
        throw new HttpError(
          409,
          'FISCAL_YEAR_CLOSED',
          'Das Geschäftsjahr ist bereits geschlossen.',
        );
      const [earlierOpen] = await tx
        .select({ year: s.fiscalYears.year })
        .from(s.fiscalYears)
        .where(
          and(
            eq(s.fiscalYears.organizationId, org),
            eq(s.fiscalYears.status, 'open'),
            sql`${s.fiscalYears.year} < ${year}`,
          ),
        )
        .limit(1);
      if (earlierOpen)
        throw new HttpError(
          409,
          'PREVIOUS_YEAR_OPEN',
          'Frühere Geschäftsjahre müssen zuerst geschlossen werden.',
        );
      const [closed] = await tx
        .update(s.fiscalYears)
        .set({ status: 'closed', closedBy: access.userId, closedAt: new Date() })
        .where(eq(s.fiscalYears.id, row.id))
        .returning();
      await audit(tx, access, 'close_year', 'fiscal_year', row.id, ['status']);
      return describeYear(tx, org, closed!);
    },
  );
}
async function assertYearOpen(db: Executor, org: string, date: string) {
  const row = await fiscalYearRow(db, org, Number(date.slice(0, 4)));
  if (!row || row.status !== 'open')
    throw new HttpError(
      409,
      'FISCAL_YEAR_NOT_OPEN',
      'Für dieses Datum ist kein offenes Geschäftsjahr vorhanden.',
    );
  return row.year;
}
async function nextEntryNumber(tx: Transaction, org: string, year: number) {
  const [row] = await tx
    .select({ next: sql<number>`coalesce(max(${s.cashbookEntries.entryNumber}),0)+1` })
    .from(s.cashbookEntries)
    .where(and(eq(s.cashbookEntries.organizationId, org), eq(s.cashbookEntries.fiscalYear, year)));
  return row!.next;
}

const e = s.cashbookEntries;
const reversal = sql<
  string | null
>`(select r.id from cashbook_entries r where r.organization_id=${e.organizationId} and r.reverses_entry_id=${e.id})`;
const entrySelect = {
  id: e.id,
  fiscalYear: e.fiscalYear,
  entryNumber: e.entryNumber,
  accountId: e.accountId,
  accountName: s.financeAccounts.name,
  categoryId: e.categoryId,
  categoryName: s.cashbookCategories.name,
  classification: s.cashbookCategories.classification,
  direction: e.direction,
  amountCents: e.amountCents,
  bookingDate: e.bookingDate,
  documentDate: e.documentDate,
  documentNumber: e.documentNumber,
  description: e.description,
  counterparty: e.counterparty,
  paymentId: e.paymentId,
  reversesEntryId: e.reversesEntryId,
  reversalReason: e.reversalReason,
  reversedByEntryId: reversal,
  createdAt: e.createdAt,
};
const entryQuery = (db: Executor) =>
  db
    .select(entrySelect)
    .from(e)
    .innerJoin(
      s.financeAccounts,
      and(
        eq(s.financeAccounts.organizationId, e.organizationId),
        eq(s.financeAccounts.id, e.accountId),
      ),
    )
    .innerJoin(
      s.cashbookCategories,
      and(
        eq(s.cashbookCategories.organizationId, e.organizationId),
        eq(s.cashbookCategories.id, e.categoryId),
      ),
    );
export async function getEntry(db: Executor, org: string, id: string): Promise<CashbookEntry> {
  const [row] = await entryQuery(db).where(and(eq(e.organizationId, org), eq(e.id, id)));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Buchung nicht gefunden.');
  return cashbookEntryResponseSchema.parse(wire(row));
}
export async function listEntries(
  db: Database,
  org: string,
  q: CashbookQuery,
): Promise<Page<CashbookEntry>> {
  const where: SQL | undefined = and(
    eq(e.organizationId, org),
    q.fiscalYear ? eq(e.fiscalYear, q.fiscalYear) : undefined,
    q.accountId ? eq(e.accountId, q.accountId) : undefined,
    q.categoryId ? eq(e.categoryId, q.categoryId) : undefined,
    q.direction ? eq(e.direction, q.direction) : undefined,
    q.search
      ? or(
          ilike(e.description, `%${escapeLike(q.search)}%`),
          ilike(e.counterparty, `%${escapeLike(q.search)}%`),
          ilike(e.documentNumber, `%${escapeLike(q.search)}%`),
        )
      : undefined,
  );
  const order = q.order === 'asc' ? asc : desc;
  return db.transaction(async (tx) => {
    const rows = await entryQuery(tx)
      .where(where)
      .orderBy(order(e.bookingDate), order(e.fiscalYear), order(e.entryNumber))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [total] = await tx.select({ n: count() }).from(e).where(where);
    return {
      items: rows.map((r) => cashbookEntryResponseSchema.parse(wire(r))),
      total: total?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  }, readOnly);
}
export function createEntry(db: Database, access: Access, key: string, input: CashbookEntryInput) {
  return financialOperation(
    db,
    access,
    key,
    'cashbook-entries:create',
    input,
    'finance:write',
    async (tx) => {
      const org = access.organizationId,
        year = await assertYearOpen(tx, org, input.bookingDate),
        account = await getAccount(tx, org, input.accountId),
        category = await getCategory(tx, org, input.categoryId);
      if (!account.active || !category.active)
        throw new HttpError(409, 'INACTIVE_REFERENCE', 'Konto oder Kategorie ist deaktiviert.');
      if (category.classification === 'membership_fee')
        throw new HttpError(
          422,
          'MEMBERSHIP_FEE_VIA_PAYMENT',
          'Mitgliedsbeiträge werden über erfasste Zahlungen verbucht.',
        );
      const [row] = await tx
        .insert(e)
        .values({
          ...input,
          organizationId: org,
          fiscalYear: year,
          entryNumber: await nextEntryNumber(tx, org, year),
          direction: category.direction,
          createdBy: access.userId,
        })
        .returning({ id: e.id });
      await audit(tx, access, 'create', 'cashbook_entry', row!.id, Object.keys(input));
      return getEntry(tx, org, row!.id);
    },
  );
}
async function insertReversal(
  tx: Transaction,
  access: Access,
  original: CashbookEntry,
  bookingDate: string,
  reason: string,
) {
  const org = access.organizationId;
  if (bookingDate < original.bookingDate)
    throw new HttpError(
      422,
      'REVERSAL_BEFORE_ORIGINAL',
      'Ein Storno kann nicht vor der ursprünglichen Buchung liegen.',
    );
  const year = await assertYearOpen(tx, org, bookingDate);
  const [row] = await tx
    .insert(e)
    .values({
      organizationId: org,
      fiscalYear: year,
      entryNumber: await nextEntryNumber(tx, org, year),
      accountId: original.accountId,
      categoryId: original.categoryId,
      direction: original.direction,
      amountCents: -original.amountCents,
      bookingDate,
      documentDate: original.documentDate,
      documentNumber: original.documentNumber,
      description:
        `Storno ${original.fiscalYear}/${original.entryNumber}: ${original.description}`.slice(
          0,
          300,
        ),
      counterparty: original.counterparty,
      paymentId: original.paymentId,
      reversesEntryId: original.id,
      reversalReason: reason,
      createdBy: access.userId,
    })
    .returning({ id: e.id });
  await audit(tx, access, 'reverse', 'cashbook_entry', original.id, ['reversalReason']);
  return row!.id;
}
export function reverseEntry(
  db: Database,
  access: Access,
  key: string,
  id: string,
  input: ReversalInput,
) {
  return financialOperation(
    db,
    access,
    key,
    `cashbook-entries:reverse:${id}`,
    input,
    'finance:write',
    async (tx) => {
      const original = await getEntry(tx, access.organizationId, id);
      if (original.reversesEntryId)
        throw new HttpError(409, 'NOT_REVERSIBLE', 'Ein Storno kann nicht storniert werden.');
      if (original.reversedByEntryId)
        throw new HttpError(409, 'ALREADY_REVERSED', 'Diese Buchung wurde bereits storniert.');
      if (original.paymentId)
        throw new HttpError(
          409,
          'USE_PAYMENT_REVERSAL',
          'Beitragsbuchungen werden über das Storno der Zahlung korrigiert.',
        );
      const reversalId = await insertReversal(
        tx,
        access,
        original,
        input.bookingDate,
        input.reason,
      );
      return getEntry(tx, access.organizationId, reversalId);
    },
  );
}
// Shared by payment creation and later booking; caller holds the organization lock.
export async function bookPayment(
  tx: Transaction,
  access: Access,
  paymentId: string,
  booking: BookingInput,
) {
  const org = access.organizationId,
    payment = await getPayment(tx, org, paymentId);
  if (payment.status === 'reversed')
    throw new HttpError(409, 'PAYMENT_REVERSED', 'Diese Zahlung wurde storniert.');
  if (payment.cashbookEntryId)
    throw new HttpError(409, 'PAYMENT_ALREADY_BOOKED', 'Diese Zahlung ist bereits verbucht.');
  const year = await assertYearOpen(tx, org, payment.paidOn),
    account = await getAccount(tx, org, booking.accountId),
    category = await getCategory(tx, org, booking.categoryId);
  if (!account.active || !category.active)
    throw new HttpError(409, 'INACTIVE_REFERENCE', 'Konto oder Kategorie ist deaktiviert.');
  if (category.direction !== 'income' || category.classification !== 'membership_fee')
    throw new HttpError(
      422,
      'BOOKING_CATEGORY_INVALID',
      'Beitragszahlungen benötigen eine Einnahmenkategorie für Mitgliedsbeiträge.',
    );
  const [row] = await tx
    .insert(e)
    .values({
      organizationId: org,
      fiscalYear: year,
      entryNumber: await nextEntryNumber(tx, org, year),
      accountId: account.id,
      categoryId: category.id,
      direction: 'income',
      amountCents: payment.amountCents,
      bookingDate: payment.paidOn,
      documentDate: payment.paidOn,
      documentNumber: receipt(payment.receiptNumber),
      description: `${receipt(payment.receiptNumber)} · ${payment.payerName}`.slice(0, 300),
      counterparty: payment.payerName,
      paymentId: payment.id,
      createdBy: access.userId,
    })
    .returning({ id: e.id });
  await audit(tx, access, 'book', 'payment', payment.id, ['accountId', 'categoryId']);
  return row!.id;
}
export function bookExistingPayment(
  db: Database,
  access: Access,
  key: string,
  paymentId: string,
  input: BookingInput,
) {
  return financialOperation(
    db,
    access,
    key,
    `payments:book:${paymentId}`,
    input,
    'finance:write',
    async (tx) => {
      await bookPayment(tx, access, paymentId, input);
      return getPayment(tx, access.organizationId, paymentId);
    },
  );
}
export function reversePayment(
  db: Database,
  access: Access,
  key: string,
  paymentId: string,
  input: PaymentReversalInput,
) {
  return financialOperation(
    db,
    access,
    key,
    `payments:reverse:${paymentId}`,
    input,
    'finance:write',
    async (tx) => {
      const org = access.organizationId,
        payment = await getPayment(tx, org, paymentId);
      if (payment.status === 'reversed')
        throw new HttpError(409, 'PAYMENT_REVERSED', 'Diese Zahlung wurde bereits storniert.');
      if (input.reversedOn < payment.paidOn)
        throw new HttpError(
          422,
          'REVERSAL_BEFORE_ORIGINAL',
          'Ein Storno kann nicht vor der Zahlung liegen.',
        );
      // Validate the cashbook side before writing the reversal so failures leave no partial state.
      const entry = payment.cashbookEntryId
        ? await getEntry(tx, org, payment.cashbookEntryId)
        : undefined;
      if (entry) await assertYearOpen(tx, org, input.reversedOn);
      await tx.insert(s.paymentReversals).values({
        organizationId: org,
        paymentId,
        reversedOn: input.reversedOn,
        reason: input.reason,
        createdBy: access.userId,
      });
      if (entry) await insertReversal(tx, access, entry, input.reversedOn, input.reason);
      await audit(tx, access, 'reverse', 'payment', paymentId, ['reversedOn', 'reason']);
      return getPayment(tx, org, paymentId);
    },
  );
}

const t = s.financeReportTemplates;
export async function listTemplates(db: Executor, org: string) {
  const rows = await db
    .selectDistinctOn([t.templateKey])
    .from(t)
    .where(eq(t.organizationId, org))
    .orderBy(t.templateKey, desc(t.version));
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { items: rows.map((r) => reportTemplateResponseSchema.parse(wire(r))) };
}
export async function listTemplateVersions(db: Executor, org: string, templateKey: string) {
  const rows = await db
    .select()
    .from(t)
    .where(and(eq(t.organizationId, org), eq(t.templateKey, templateKey)))
    .orderBy(desc(t.version));
  if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Berichtsvorlage nicht gefunden.');
  return { items: rows.map((r) => reportTemplateResponseSchema.parse(wire(r))) };
}
async function assertTemplateCategories(db: Executor, org: string, input: ReportTemplateInput) {
  const categories = new Map((await listCategories(db, org)).items.map((c) => [c.id, c]));
  for (const line of input.lines)
    for (const id of line.categoryIds)
      if (categories.get(id)?.direction !== line.direction)
        throw new HttpError(
          422,
          'TEMPLATE_CATEGORY_INVALID',
          'Eine Kategorie fehlt oder passt nicht zur Richtung der Berichtszeile.',
        );
}
async function insertTemplate(
  tx: Transaction,
  access: Access,
  templateKey: string,
  version: number,
  input: ReportTemplateInput,
) {
  await assertTemplateCategories(tx, access.organizationId, input);
  const [row] = await tx
    .insert(t)
    .values({
      ...input,
      organizationId: access.organizationId,
      templateKey,
      version,
      createdBy: access.userId,
    })
    .returning();
  await audit(
    tx,
    access,
    version === 1 ? 'create' : 'version',
    'finance_report_template',
    row!.id,
    ['name', 'validFromYear', 'validToYear', 'revenueThresholdCents', 'lines'],
  );
  return reportTemplateResponseSchema.parse(wire(row));
}
export function createTemplate(
  db: Database,
  access: Access,
  key: string,
  input: ReportTemplateInput,
) {
  return financialOperation(
    db,
    access,
    key,
    'report-templates:create',
    input,
    'finance:write',
    (tx) => insertTemplate(tx, access, crypto.randomUUID(), 1, input),
  );
}
export function createTemplateVersion(
  db: Database,
  access: Access,
  key: string,
  templateKey: string,
  input: { template: ReportTemplateInput; version: number },
) {
  return financialOperation(
    db,
    access,
    key,
    `report-templates:version:${templateKey}`,
    input,
    'finance:write',
    async (tx) => {
      const [latest] = (await listTemplateVersions(tx, access.organizationId, templateKey)).items;
      if (latest!.version !== input.version)
        throw new HttpError(409, 'STALE_VERSION', 'Die Vorlage wurde zwischenzeitlich geändert.');
      return insertTemplate(tx, access, templateKey, input.version + 1, input.template);
    },
  );
}

const sumOf = (values: string[]) => values.reduce((n, v) => n + BigInt(v), 0n);
export async function annualReport(
  db: Database,
  org: string,
  fiscalYear: number,
  templateId?: string,
): Promise<AnnualReport> {
  return db.transaction(async (tx) => {
    const year = await fiscalYearRow(tx, org, fiscalYear);
    if (!year) throw new HttpError(404, 'NOT_FOUND', 'Geschäftsjahr nicht gefunden.');
    const categories = (
      await tx.execute<{
        categoryId: string;
        name: string;
        direction: 'income' | 'expense';
        classification: 'membership_fee' | 'donation' | 'other';
        totalCents: string;
      }>(sql`
        select c.id as "categoryId", c.name, c.direction, c.classification,
          coalesce(sum(e.amount_cents), 0)::text as "totalCents"
        from cashbook_categories c
        left join cashbook_entries e
          on e.organization_id = c.organization_id and e.category_id = c.id and e.fiscal_year = ${fiscalYear}
        where c.organization_id = ${org}
        group by c.id, c.name, c.direction, c.classification
        order by c.direction, c.name, c.id`)
    ).rows;
    const income = categories.filter((c) => c.direction === 'income'),
      byClass = (value: string) =>
        String(sumOf(income.filter((c) => c.classification === value).map((c) => c.totalCents)));
    const incomeCents = sumOf(income.map((c) => c.totalCents)),
      expenseCents = sumOf(
        categories.filter((c) => c.direction === 'expense').map((c) => c.totalCents),
      );
    const [unbooked] = await tx
      .select({ n: count() })
      .from(s.payments)
      .where(
        and(
          eq(s.payments.organizationId, org),
          sql`extract(year from ${s.payments.paidOn})::integer = ${fiscalYear}`,
          sql`not exists(select 1 from payment_reversals r where r.organization_id=${s.payments.organizationId} and r.payment_id=${s.payments.id})`,
          sql`not exists(select 1 from cashbook_entries c where c.organization_id=${s.payments.organizationId} and c.payment_id=${s.payments.id} and c.reverses_entry_id is null)`,
        ),
      );
    let template: AnnualReport['template'] = null;
    if (templateId) {
      const [row] = await tx
        .select()
        .from(t)
        .where(and(eq(t.organizationId, org), eq(t.id, templateId)));
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Berichtsvorlage nicht gefunden.');
      if (
        fiscalYear < row.validFromYear ||
        (row.validToYear !== null && fiscalYear > row.validToYear)
      )
        throw new HttpError(
          422,
          'TEMPLATE_NOT_VALID_FOR_YEAR',
          'Die Vorlage gilt nicht für dieses Geschäftsjahr.',
        );
      const totals = new Map(categories.map((c) => [c.categoryId, c.totalCents])),
        mapped = new Set(row.lines.flatMap((l) => l.categoryIds));
      template = {
        id: row.id,
        name: row.name,
        version: row.version,
        revenueThresholdCents: row.revenueThresholdCents,
        thresholdExceeded:
          row.revenueThresholdCents !== null && incomeCents >= BigInt(row.revenueThresholdCents),
        lines: row.lines.map((line) => ({
          code: line.code,
          label: line.label,
          direction: line.direction,
          totalCents: String(sumOf(line.categoryIds.map((id) => totals.get(id) ?? '0'))),
        })),
        unmappedCategoryIds: categories
          .filter((c) => c.totalCents !== '0' && !mapped.has(c.categoryId))
          .map((c) => c.categoryId),
      };
    }
    return annualReportSchema.parse({
      fiscalYear,
      status: year.status,
      currency: 'EUR',
      incomeCents: String(incomeCents),
      expenseCents: String(expenseCents),
      resultCents: String(incomeCents - expenseCents),
      membershipFeeIncomeCents: byClass('membership_fee'),
      donationIncomeCents: byClass('donation'),
      otherIncomeCents: byClass('other'),
      unbookedPaymentCount: unbooked?.n ?? 0,
      categories,
      accounts: await accountBalances(tx, org, fiscalYear),
      template,
    });
  }, readOnly);
}
