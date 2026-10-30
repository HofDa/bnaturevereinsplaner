import { and, eq, sql, desc, or } from 'drizzle-orm';
import { schema as s, type Database, type Executor } from '@bnature/db';
import {
  ETS_POSITIONS,
  ETS_RULES,
  ETS_DEFINITION_VERSION,
  etsReportSchema,
  etsMappingResponseSchema,
  type EtsReportQuery,
  type CategoryInput,
} from '@bnature/contracts';
import { HttpError, type Access } from '../../middleware/access';
import { financialOperation } from './operations';
import { audit } from '../../services/audit';
import { wire } from '../responses';
import { accountBalances } from './ledger';

export async function listMappings(db: Executor, org: string, categoryId: string) {
  const [category] = await db
    .select()
    .from(s.cashbookCategories)
    .where(
      and(eq(s.cashbookCategories.organizationId, org), eq(s.cashbookCategories.id, categoryId)),
    );
  if (!category) throw new HttpError(404, 'NOT_FOUND', 'Kategorie nicht gefunden.');
  const rows = await db
    .select()
    .from(s.categoryEtsMappings)
    .where(
      and(
        eq(s.categoryEtsMappings.organizationId, org),
        eq(s.categoryEtsMappings.categoryId, categoryId),
      ),
    )
    .orderBy(desc(s.categoryEtsMappings.effectiveFrom));
  return { items: rows.map((r) => etsMappingResponseSchema.parse(wire(r))) };
}
export function createMapping(
  db: Database,
  access: Access,
  key: string,
  categoryId: string,
  input: { effectiveFrom: string; position: string },
) {
  return financialOperation(
    db,
    access,
    key,
    `ets-mapping:${categoryId}`,
    input,
    'finance:write',
    async (tx) => {
      const [category] = await tx
        .select()
        .from(s.cashbookCategories)
        .where(
          and(
            eq(s.cashbookCategories.organizationId, access.organizationId),
            eq(s.cashbookCategories.id, categoryId),
          ),
        );
      if (!category) throw new HttpError(404, 'NOT_FOUND', 'Kategorie nicht gefunden.');
      if (
        !ETS_POSITIONS.some((p) => p.code === input.position && p.direction === category.direction)
      )
        throw new HttpError(422, 'INVALID_ETS_POSITION', 'Ungültige ETS-Position.');
      const [exists] = await tx
        .select()
        .from(s.categoryEtsMappings)
        .where(
          and(
            eq(s.categoryEtsMappings.organizationId, access.organizationId),
            eq(s.categoryEtsMappings.categoryId, categoryId),
            eq(s.categoryEtsMappings.effectiveFrom, input.effectiveFrom),
          ),
        );
      if (exists)
        throw new HttpError(409, 'MAPPING_EXISTS', 'Zuordnung für dieses Datum existiert bereits.');
      const [row] = await tx
        .insert(s.categoryEtsMappings)
        .values({
          ...input,
          organizationId: access.organizationId,
          categoryId,
          definitionVersion: ETS_DEFINITION_VERSION,
          createdBy: access.userId,
        })
        .returning();
      await audit(tx, access, 'create', 'category_ets_mapping', row!.id, Object.keys(input));
      return etsMappingResponseSchema.parse(wire(row));
    },
  );
}
const starterCategories: Array<
  [string, string, 'income' | 'expense', CategoryInput['classification'], string | null]
> = [
  ['Mitgliedsbeiträge', 'Quote associative', 'income', 'membership_fee', 'A.income.1'],
  ['Spenden', 'Donazioni', 'income', 'donation', 'A.income.4'],
  ['Öffentliche Förderungen', 'Contributi pubblici', 'income', 'other', 'A.income.8'],
  ['Private Förderungen', 'Contributi privati', 'income', 'other', 'A.income.6'],
  ['Veranstaltungen', 'Eventi', 'income', 'other', null],
  ['Umweltbildung', 'Educazione ambientale', 'income', 'other', null],
  ['Sonstige Einnahmen', 'Altre entrate', 'income', 'other', null],
  ['Versicherungen', 'Assicurazioni', 'expense', 'other', null],
  ['Materialien und Ausrüstung', 'Materiali e attrezzature', 'expense', 'other', null],
  ['Veranstaltungen', 'Eventi', 'expense', 'other', null],
  ['Reisekosten', 'Spese di viaggio', 'expense', 'other', null],
  ['Verwaltung', 'Amministrazione', 'expense', 'other', 'E.expense.2'],
  ['Honorare und Dienstleistungen', 'Compensi e servizi', 'expense', 'other', null],
  ['Projektkosten', 'Costi di progetto', 'expense', 'other', null],
  ['Sonstige Ausgaben', 'Altre uscite', 'expense', 'other', null],
];
export function initializeFinance(
  db: Database,
  access: Access,
  key: string,
  language: 'de' | 'it',
) {
  return financialOperation(
    db,
    access,
    key,
    'finance:initialize',
    { language },
    'finance:write',
    async (tx) => {
      const org = access.organizationId;
      for (const [de, it, direction, classification, position] of starterCategories) {
        const name = language === 'it' ? it : de,
          starterKey = `${direction}:${de}`;
        const [existing] = await tx
          .select()
          .from(s.cashbookCategories)
          .where(
            and(
              eq(s.cashbookCategories.organizationId, org),
              eq(s.cashbookCategories.direction, direction),
              or(
                eq(s.cashbookCategories.starterKey, starterKey),
                eq(s.cashbookCategories.name, de),
                eq(s.cashbookCategories.name, it),
              ),
            ),
          );
        if (existing) {
          if (!existing.starterKey)
            await tx
              .update(s.cashbookCategories)
              .set({ starterKey, version: existing.version + 1, updatedAt: new Date() })
              .where(eq(s.cashbookCategories.id, existing.id));
          continue;
        }
        const [row] = await tx
          .insert(s.cashbookCategories)
          .values({ organizationId: org, name, direction, classification, starterKey })
          .returning();
        if (position)
          await tx.insert(s.categoryEtsMappings).values({
            organizationId: org,
            categoryId: row!.id,
            effectiveFrom: '1900-01-01',
            position,
            definitionVersion: ETS_DEFINITION_VERSION,
            createdBy: access.userId,
          });
      }
      const accounts = await tx
        .select()
        .from(s.financeAccounts)
        .where(eq(s.financeAccounts.organizationId, org));
      for (const kind of ['cash', 'bank'] as const)
        if (!accounts.some((a) => a.kind === kind && a.active)) {
          const name =
            kind === 'cash'
              ? language === 'it'
                ? 'Cassa'
                : 'Barkasse'
              : language === 'it'
                ? 'Conto bancario'
                : 'Bankkonto';
          const [row] = await tx
            .insert(s.financeAccounts)
            .values({ organizationId: org, name, kind })
            .returning();
          accounts.push(row!);
        }
      const [fees] = await tx
        .select()
        .from(s.cashbookCategories)
        .where(
          and(
            eq(s.cashbookCategories.organizationId, org),
            eq(s.cashbookCategories.classification, 'membership_fee'),
            eq(s.cashbookCategories.active, true),
          ),
        )
        .orderBy(s.cashbookCategories.createdAt, s.cashbookCategories.id)
        .limit(1);
      if (!fees)
        throw new HttpError(409, 'FEE_CATEGORY_REQUIRED', 'Aktive Beitragskategorie fehlt.');
      for (const [method, kind] of [
        ['cash', 'cash'],
        ['bank_transfer', 'bank'],
      ] as const) {
        // Existing multi-account setups require explicit selection instead of guessing a bank account.
        const matching = accounts.filter((a) => a.kind === kind && a.active);
        if (matching.length === 1)
          await tx
            .insert(s.paymentBookingDefaults)
            .values({
              organizationId: org,
              method,
              accountId: matching[0]!.id,
              categoryId: fees.id,
            })
            .onConflictDoNothing();
      }
      await audit(tx, access, 'initialize', 'finance', org, [
        'categories',
        'accounts',
        'paymentBookingDefaults',
      ]);
      return { initialized: true };
    },
  );
}
export async function etsReport(db: Database, org: string, q: EtsReportQuery) {
  return db.transaction(
    async (tx) => {
      const [year] = await tx
        .select()
        .from(s.fiscalYears)
        .where(and(eq(s.fiscalYears.organizationId, org), eq(s.fiscalYears.year, q.fiscalYear)));
      if (!year) throw new HttpError(404, 'NOT_FOUND', 'Geschäftsjahr nicht gefunden.');
      const [prior] = await tx
        .select()
        .from(s.fiscalYears)
        .where(
          and(eq(s.fiscalYears.organizationId, org), sql`${s.fiscalYears.endsOn}<${year.startsOn}`),
        )
        .orderBy(desc(s.fiscalYears.endsOn))
        .limit(1);
      const entries = await tx
        .select()
        .from(s.cashbookEntries)
        .where(
          and(
            eq(s.cashbookEntries.organizationId, org),
            eq(s.cashbookEntries.fiscalYear, year.year),
          ),
        );
      const previous = prior
        ? await tx
            .select()
            .from(s.cashbookEntries)
            .where(
              and(
                eq(s.cashbookEntries.organizationId, org),
                eq(s.cashbookEntries.fiscalYear, prior.year),
              ),
            )
        : [];
      const sum = (rows: typeof entries, direction: 'income' | 'expense') =>
        rows
          .filter((e) => e.direction === direction)
          .reduce((n, e) => n + BigInt(e.amountCents), 0n);
      const amount = (rows: typeof entries, code: string, direction: 'income' | 'expense') =>
        sum(
          rows.filter((e) => e.etsPosition === code),
          direction,
        );
      const row = (
        code: string,
        label: string,
        inc: bigint,
        exp: bigint,
        pi: bigint,
        pe: bigint,
      ) => ({
        code,
        label,
        incomeCents: String(inc),
        expenseCents: String(exp),
        resultCents: String(inc - exp),
        priorIncomeCents: prior ? String(pi) : null,
        priorExpenseCents: prior ? String(pe) : null,
        priorResultCents: prior ? String(pi - pe) : null,
      });
      const rows = [];
      for (const section of ['A', 'B', 'C', 'D', 'E', 'F']) {
        const ps = ETS_POSITIONS.filter((p) => p.code.startsWith(`${section}.`));
        if (q.model === 'D')
          for (const p of ps)
            rows.push(
              row(
                p.code,
                p[q.language],
                amount(entries, p.code, 'income'),
                amount(entries, p.code, 'expense'),
                amount(previous, p.code, 'income'),
                amount(previous, p.code, 'expense'),
              ),
            );
        const inc = ps.reduce((n, p) => n + amount(entries, p.code, 'income'), 0n),
          exp = ps.reduce((n, p) => n + amount(entries, p.code, 'expense'), 0n);
        rows.push(
          row(
            section,
            (
              {
                A: { de: 'Gemeinnützige Tätigkeit', it: 'Attività di interesse generale' },
                B: { de: 'Andere Tätigkeiten', it: 'Attività diverse' },
                C: { de: 'Mittelbeschaffung', it: 'Raccolta fondi' },
                D: {
                  de: 'Finanz- und Vermögensverwaltung',
                  it: 'Attività finanziarie e patrimoniali',
                },
                E: { de: 'Allgemeine Unterstützung', it: 'Supporto generale' },
                F: { de: 'Investitionen und Finanzierungen', it: 'Investimenti e finanziamenti' },
              } as const
            )[section as 'A'][q.language],
            inc,
            exp,
            ps.reduce((n, p) => n + amount(previous, p.code, 'income'), 0n),
            ps.reduce((n, p) => n + amount(previous, p.code, 'expense'), 0n),
          ),
        );
      }
      const management = (r: typeof entries, d: 'income' | 'expense') =>
        sum(
          r.filter((e) => e.etsPosition && /^[ABCDE]\./.test(e.etsPosition)),
          d,
        );
      rows.push(
        row(
          'management',
          q.language === 'it'
            ? 'Totale gestione prima delle imposte'
            : 'Laufende Tätigkeit vor Steuern',
          management(entries, 'income'),
          management(entries, 'expense'),
          management(previous, 'income'),
          management(previous, 'expense'),
        ),
      );
      for (const p of ETS_POSITIONS.filter((p) => p.code.startsWith('T.')))
        rows.push(
          row(
            p.code,
            p[q.language],
            0n,
            amount(entries, p.code, 'expense'),
            0n,
            amount(previous, p.code, 'expense'),
          ),
        );
      for (const [code, group, tax] of [
        ['operating', 'ABCDE', 'T.expense.1'],
        ['investing', 'F', 'T.expense.2'],
      ] as const) {
        const selected = (r: typeof entries) =>
          r.filter(
            (e) =>
              e.etsPosition &&
              (group.includes(e.etsPosition.split('.')[0]!) || e.etsPosition === tax),
          );
        rows.push(
          row(
            code,
            q.language === 'it'
              ? code === 'operating'
                ? 'Avanzo/disavanzo prima degli investimenti'
                : 'Avanzo/disavanzo investimenti'
              : code === 'operating'
                ? 'Ergebnis vor Investitionen'
                : 'Ergebnis Investitionen',
            sum(selected(entries), 'income'),
            sum(selected(entries), 'expense'),
            sum(selected(previous), 'income'),
            sum(selected(previous), 'expense'),
          ),
        );
      }
      const income = sum(entries, 'income'),
        expense = sum(entries, 'expense');
      rows.push(
        row(
          'total',
          q.language === 'it' ? 'Avanzo/disavanzo complessivo' : 'Gesamtergebnis',
          income,
          expense,
          sum(previous, 'income'),
          sum(previous, 'expense'),
        ),
      );
      const balances = await accountBalances(tx, org, year.year),
        opening = balances.reduce((n, b) => n + BigInt(b.openingCents), 0n),
        closing = balances.reduce((n, b) => n + BigInt(b.closingCents), 0n);
      const unmapped = entries.filter(
        (e) =>
          !ETS_POSITIONS.some(
            (p) =>
              p.code === e.etsPosition &&
              p.direction === e.direction &&
              e.etsDefinitionVersion === ETS_DEFINITION_VERSION,
          ),
      );
      const priorRevenue = q.priorRevenueCents ?? (prior ? String(sum(previous, 'income')) : null);
      const modern = year.startsOn > ETS_RULES.reformFirstStartAfter;
      const limit =
        q.model === 'E' || (modern && q.legalPersonality === 'yes')
          ? BigInt(ETS_RULES.eInclusiveLimitCents)
          : BigInt(modern ? ETS_RULES.dInclusiveLimitCents : ETS_RULES.legacyExclusiveLimitCents);
      const dateValid =
        q.model === 'E'
          ? year.endsOn >= ETS_RULES.eFirstYearEndingOnOrAfter
          : year.startsOn > ETS_RULES.dFirstStartAfter;
      const exceeds =
        priorRevenue !== null &&
        (modern ? BigInt(priorRevenue) > limit : BigInt(priorRevenue) >= limit);
      const [unbooked] = await tx
        .execute<{ n: number }>(
          sql`select count(*)::int n from payments p where p.organization_id=${org} and p.paid_on between ${year.startsOn} and ${year.endsOn} and not exists(select 1 from payment_reversals r where r.organization_id=p.organization_id and r.payment_id=p.id) and not exists(select 1 from cashbook_entries e where e.organization_id=p.organization_id and e.payment_id=p.id)`,
        )
        .then((r) => r.rows);
      return etsReportSchema.parse({
        fiscalYear: year.year,
        model: q.model,
        definitionVersion: ETS_DEFINITION_VERSION,
        status: year.status,
        startsOn: year.startsOn,
        endsOn: year.endsOn,
        incomeCents: String(income),
        expenseCents: String(expense),
        resultCents: String(income - expense),
        openingCents: String(opening),
        closingCents: String(closing),
        accounts: balances,
        priorAccounts: prior ? await accountBalances(tx, org, prior.year) : [],
        priorFiscalYear: prior?.year ?? null,
        priorRevenueCents: priorRevenue,
        eligibility:
          !dateValid || exceeds
            ? 'outside_limit'
            : priorRevenue === null || q.legalPersonality === 'unknown'
              ? 'review'
              : 'within_limit',
        rows,
        unmappedEntryIds: unmapped.map((e) => e.id),
        checks: [
          { code: 'balanced', ok: closing - opening === income - expense },
          { code: 'mapped', ok: unmapped.length === 0 },
          { code: 'payments_booked', ok: unbooked?.n === 0 },
          {
            code: 'nonnegative_cash',
            ok: balances.every((b) => b.kind !== 'cash' || BigInt(b.closingCents) >= 0n),
          },
          { code: 'model_date', ok: dateValid },
          { code: 'prior_year_available', ok: priorRevenue !== null },
        ],
        notice:
          q.language === 'it'
            ? 'Preparazione del rendiconto, da verificare. Nessuna revisione o certificazione. Verificare regime ETS, valori di riferimento e relazioni obbligatorie.'
            : 'Vorbereitung des Jahresabschlusses zur Prüfung. Keine rechtliche Prüfung oder Zertifizierung. ETS-Status, Referenzwerte und vorgeschriebene Erläuterungen prüfen.',
      });
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
