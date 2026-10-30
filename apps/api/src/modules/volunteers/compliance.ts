import { and, eq, sql, asc, desc, count, gte, lte, isNull } from 'drizzle-orm';
import { schema as s, type Database, type Executor, type Transaction } from '@bnature/db';
import {
  addDays,
  annualDate,
  calculationSchema,
  dueDateFor,
  nextReminder,
  ruleSchema,
  deadlineSchema,
  type ComplianceDeadline,
  type RuleInput,
  type deadlineInputSchema,
  type deadlinePatchSchema,
  type deadlineCompleteSchema,
  type evidenceInputSchema,
  type deadlineQuerySchema,
  type generateDeadlinesSchema,
} from '@bnature/contracts';
import type { z } from 'zod';
import { HttpError, type Access } from '../../middleware/access';
import { audit } from '../../services/audit';
import { financialOperation, readSnapshot } from '../finance/operations';
import { getDocument } from '../documents';
import { wire } from '../responses';
import { today } from './common';

const cr = s.complianceRules,
  cd = s.complianceDeadlines;
const review = {
  de: 'Startvorlage. Rechtsgrundlage, Frist und Anwendbarkeit vor Verwendung fachlich prüfen.',
};
// Starter rules cite official sources; every organization reviews them before relying on them.
export const starterRules: Omit<RuleInput, 'validFrom' | 'active'>[] = [
  {
    ruleKey: 'runts_annual_report',
    kind: 'legal',
    topic: 'runts_annual_report',
    titleI18n: {
      de: 'RUNTS: Hinterlegung Jahresabschluss',
      it: 'RUNTS: deposito del bilancio',
    },
    descriptionI18n: {
      de: 'Jahresabschluss bzw. Rechnungslegung und Berichte über Spendensammlungen beim RUNTS hinterlegen (180 Tage nach Ende des Geschäftsjahres). Manuelle Einreichung über das Portal.',
      it: 'Depositare al RUNTS bilancio o rendiconto e rendiconti delle raccolte fondi (180 giorni dalla chiusura dell’esercizio). Invio manuale tramite il portale.',
    },
    legalBasis:
      'Art. 48 c. 3 D.Lgs. 117/2017 i.d.F. L. 104/2024; Art. 20 c. 5 D.M. 106/2020 i.d.F. D.M. 2/2026',
    sourceUrl:
      'https://www.lavoro.gov.it/notizie/pagine/runts-pubblicato-gazzetta-ufficiale-il-dm-22026-recante-modifiche-al-dm-1062020',
    responsibleRole: 'board',
    calculation: { basis: 'fiscal_year_end', offsetDays: 180 },
    reminderDays: [60, 30, 7],
  },
  {
    ruleKey: 'runts_organ_change',
    kind: 'legal',
    topic: 'organ_change',
    titleI18n: {
      de: 'RUNTS: Änderung der Organe melden',
      it: 'RUNTS: comunicare la variazione delle cariche sociali',
    },
    descriptionI18n: {
      de: 'Änderungen bei Vorstand, Vertretung oder Kontrollorgan innerhalb von 30 Tagen beim RUNTS hinterlegen.',
      it: 'Depositare al RUNTS entro 30 giorni le variazioni di amministratori, rappresentanza o organo di controllo.',
    },
    legalBasis: 'Art. 48 D.Lgs. 117/2017; Art. 20 und Anlage C D.M. 106/2020',
    sourceUrl:
      'https://www.lavoro.gov.it/notizie/pagine/runts-pubblicato-gazzetta-ufficiale-il-dm-22026-recante-modifiche-al-dm-1062020',
    responsibleRole: 'admin',
    calculation: { basis: 'board_change', offsetDays: 30 },
    reminderDays: [14, 3],
  },
  {
    ruleKey: 'runts_association_data',
    kind: 'legal',
    topic: 'association_data',
    titleI18n: {
      de: 'RUNTS: Vereinsdaten aktualisieren',
      it: 'RUNTS: aggiornare i dati dell’ente',
    },
    descriptionI18n: {
      de: 'Angaben zu Mitgliedern, Freiwilligen und Beschäftigten jährlich prüfen und bei Änderungen bis 30. Juni aktualisieren.',
      it: 'Verificare annualmente i dati su associati, volontari e lavoratori e aggiornarli entro il 30 giugno in caso di variazioni.',
    },
    legalBasis: 'Art. 20 D.M. 106/2020 i.d.F. D.M. 2/2026',
    sourceUrl:
      'https://www.lavoro.gov.it/notizie/pagine/runts-pubblicato-gazzetta-ufficiale-il-dm-22026-recante-modifiche-al-dm-1062020',
    responsibleRole: 'board',
    calculation: { basis: 'annual_date', month: 6, day: 30, offsetDays: 0 },
    reminderDays: [30, 7],
  },
  {
    ruleKey: 'board_term_end',
    kind: 'recommendation',
    topic: 'board_term',
    titleI18n: {
      de: 'Ablauf einer Vorstandsfunktion vorbereiten',
      it: 'Preparare la scadenza di una carica',
    },
    descriptionI18n: {
      de: 'Neuwahl oder Verlängerung gemäß Satzung rechtzeitig vorbereiten.',
      it: 'Preparare per tempo rinnovo o proroga secondo lo statuto.',
    },
    legalBasis: 'Satzung des Vereins',
    sourceUrl: '',
    responsibleRole: 'board',
    calculation: { basis: 'board_mandate_end', offsetDays: -60 },
    reminderDays: [30, 7],
  },
  {
    ruleKey: 'volunteer_insurance_renewal',
    kind: 'legal',
    topic: 'insurance',
    titleI18n: {
      de: 'Freiwilligenversicherung: Laufzeitende',
      it: 'Assicurazione volontari: scadenza',
    },
    descriptionI18n: {
      de: 'Verlängerung prüfen; Freiwillige sind gegen Unfall, tätigkeitsbedingte Krankheit und Haftpflicht zu versichern. Deckung richtet sich nach dem Vertrag.',
      it: 'Verificare il rinnovo; i volontari vanno assicurati contro infortuni, malattie connesse all’attività e responsabilità civile. La copertura dipende dal contratto.',
    },
    legalBasis: 'Art. 18 D.Lgs. 117/2017; Art. 1–2 D.M. 6.10.2021',
    sourceUrl: 'https://www.gazzettaufficiale.it/eli/id/2021/11/30/21A06971/sg',
    responsibleRole: 'board',
    calculation: { basis: 'policy_end', offsetDays: 0 },
    reminderDays: [60, 30, 7],
  },
  {
    ruleKey: 'volunteer_register_snapshot',
    kind: 'recommendation',
    topic: 'register_snapshot',
    titleI18n: {
      de: 'Freiwilligenregister festschreiben und signieren',
      it: 'Consolidare e firmare il registro dei volontari',
    },
    descriptionI18n: {
      de: 'Registerstand festschreiben, extern qualifiziert signieren und mit Zeitstempel archivieren. Intervall und Verfahren sind rechtlich zu bestätigen.',
      it: 'Consolidare lo stato del registro, firmarlo esternamente con firma qualificata e archiviarlo con marca temporale. Intervallo e procedura da confermare legalmente.',
    },
    legalBasis:
      'Art. 17 c. 1 D.Lgs. 117/2017; Art. 3 c. 2 D.M. 6.10.2021 i.V.m. Art. 2215-bis c.c.',
    sourceUrl: 'https://www.gazzettaufficiale.it/eli/id/2021/11/30/21A06971/sg',
    responsibleRole: 'board',
    calculation: { basis: 'last_register_snapshot', offsetDays: 365 },
    reminderDays: [30, 7],
  },
  {
    ruleKey: 'annual_document_review',
    kind: 'internal',
    topic: 'document_review',
    titleI18n: {
      de: 'Jährliche Dokumentenprüfung',
      it: 'Verifica annuale dei documenti',
    },
    descriptionI18n: {
      de: 'Satzung, Protokolle, Policen und Nachweise auf Vollständigkeit und Aufbewahrung prüfen.',
      it: 'Verificare completezza e conservazione di statuto, verbali, polizze e documentazione.',
    },
    legalBasis: '',
    sourceUrl: '',
    responsibleRole: 'board',
    calculation: { basis: 'annual_date', month: 12, day: 15, offsetDays: 0 },
    reminderDays: [30],
  },
];
export async function listRules(db: Database, a: Access) {
  const rows = await db
    .select()
    .from(cr)
    .where(eq(cr.organizationId, a.organizationId))
    .orderBy(asc(cr.ruleKey), desc(cr.version));
  return { items: rows.map((r) => ruleSchema.parse(wire(r))) };
}
async function insertRuleVersion(tx: Transaction, a: Access, input: RuleInput, starter = false) {
  const [current] = await tx
    .select()
    .from(cr)
    .where(
      and(
        eq(cr.organizationId, a.organizationId),
        eq(cr.ruleKey, input.ruleKey),
        isNull(cr.validTo),
      ),
    )
    .for('update');
  if (current) {
    if (input.validFrom <= current.validFrom)
      throw new HttpError(
        422,
        'RULE_VALID_FROM',
        'Eine neue Version muss nach der geltenden beginnen.',
      );
    await tx
      .update(cr)
      .set({ validTo: addDays(input.validFrom, -1) })
      .where(and(eq(cr.organizationId, a.organizationId), eq(cr.id, current.id)));
  }
  const [row] = await tx
    .insert(cr)
    .values({
      ...input,
      calculation: calculationSchema.parse(input.calculation),
      organizationId: a.organizationId,
      version: (current?.version ?? 0) + 1,
      starter,
      reviewNote: starter ? review.de : '',
      createdBy: a.userId,
    })
    .returning();
  await audit(tx, a, 'version', 'compliance_rule', row!.id, Object.keys(input));
  return row!;
}
export function createRuleVersion(db: Database, a: Access, key: string, input: RuleInput) {
  return financialOperation(db, a, key, 'compliance:rule', input, 'compliance:write', async (tx) =>
    ruleSchema.parse(wire(await insertRuleVersion(tx, a, input))),
  );
}
export function setRuleActive(
  db: Database,
  a: Access,
  key: string,
  id: string,
  input: { active: boolean; reviewNote: string },
) {
  return financialOperation(
    db,
    a,
    key,
    `compliance:rule-active:${id}`,
    input,
    'compliance:write',
    async (tx) => {
      const [row] = await tx
        .update(cr)
        .set(input)
        .where(and(eq(cr.organizationId, a.organizationId), eq(cr.id, id), isNull(cr.validTo)))
        .returning();
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Geltende Regelversion nicht gefunden.');
      await audit(tx, a, 'update', 'compliance_rule', id, Object.keys(input));
      return ruleSchema.parse(wire(row));
    },
  );
}
export function initializeRules(db: Database, a: Access, key: string) {
  return financialOperation(
    db,
    a,
    key,
    'compliance:initialize',
    {},
    'compliance:write',
    async (tx) => {
      for (const rule of starterRules) {
        const [exists] = await tx
          .select({ id: cr.id })
          .from(cr)
          .where(and(eq(cr.organizationId, a.organizationId), eq(cr.ruleKey, rule.ruleKey)));
        if (!exists)
          await insertRuleVersion(tx, a, { ...rule, validFrom: '2026-01-01', active: true }, true);
      }
      return {
        items: (await tx.select().from(cr).where(eq(cr.organizationId, a.organizationId))).map(
          (r) => ruleSchema.parse(wire(r)),
        ),
      };
    },
  );
}
async function presentDeadline(db: Executor, a: Access, id: string): Promise<ComplianceDeadline> {
  const [row] = await db
    .select({ deadline: cd, responsibleName: s.user.name })
    .from(cd)
    .leftJoin(s.user, eq(s.user.id, cd.responsibleUserId))
    .where(and(eq(cd.organizationId, a.organizationId), eq(cd.id, id)));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Frist nicht gefunden.');
  const evidence = await db
    .select({
      id: s.complianceEvidence.id,
      documentId: s.complianceEvidence.documentId,
      documentTitle: s.documents.title,
      reference: s.complianceEvidence.reference,
      description: s.complianceEvidence.description,
      createdByName: s.user.name,
      createdAt: s.complianceEvidence.createdAt,
    })
    .from(s.complianceEvidence)
    .leftJoin(
      s.documents,
      and(
        eq(s.documents.organizationId, s.complianceEvidence.organizationId),
        eq(s.documents.id, s.complianceEvidence.documentId),
      ),
    )
    .leftJoin(s.user, eq(s.user.id, s.complianceEvidence.createdBy))
    .where(
      and(
        eq(s.complianceEvidence.organizationId, a.organizationId),
        eq(s.complianceEvidence.deadlineId, id),
      ),
    )
    .orderBy(asc(s.complianceEvidence.createdAt));
  const history = await db
    .select({
      action: s.complianceDeadlineHistory.action,
      fromStatus: s.complianceDeadlineHistory.fromStatus,
      toStatus: s.complianceDeadlineHistory.toStatus,
      note: s.complianceDeadlineHistory.note,
      actorName: s.user.name,
      createdAt: s.complianceDeadlineHistory.createdAt,
    })
    .from(s.complianceDeadlineHistory)
    .leftJoin(s.user, eq(s.user.id, s.complianceDeadlineHistory.actorUserId))
    .where(
      and(
        eq(s.complianceDeadlineHistory.organizationId, a.organizationId),
        eq(s.complianceDeadlineHistory.deadlineId, id),
      ),
    )
    .orderBy(asc(s.complianceDeadlineHistory.createdAt));
  const d = row.deadline,
    now = today(),
    open = d.status === 'open' || d.status === 'in_progress';
  return deadlineSchema.parse({
    ...wire(d),
    responsibleName: row.responsibleName,
    evidence: evidence.map((e) => wire(e)),
    history: history.map((h) => wire(h)),
    overdue: open && d.dueDate < now,
    nextReminder: open ? nextReminder(d.dueDate, d.reminderDays, now) : null,
  });
}
export async function listDeadlines(
  db: Database,
  a: Access,
  q: z.infer<typeof deadlineQuerySchema>,
) {
  return readSnapshot(db, async (tx) => {
    const where = and(
      eq(cd.organizationId, a.organizationId),
      q.status ? eq(cd.status, q.status) : undefined,
      q.kind ? eq(cd.kind, q.kind) : undefined,
      q.from ? gte(cd.dueDate, q.from) : undefined,
      q.to ? lte(cd.dueDate, q.to) : undefined,
    );
    const rows = await tx
      .select({ id: cd.id })
      .from(cd)
      .where(where)
      .orderBy(asc(cd.dueDate), asc(cd.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [total] = await tx.select({ n: count() }).from(cd).where(where);
    const items: ComplianceDeadline[] = [];
    for (const row of rows) items.push(await presentDeadline(tx, a, row.id));
    return { items, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize };
  });
}
async function history(
  tx: Transaction,
  a: Access,
  deadlineId: string,
  action: string,
  fromStatus: ComplianceDeadline['status'] | null,
  toStatus: ComplianceDeadline['status'] | null,
  note = '',
) {
  await tx.insert(s.complianceDeadlineHistory).values({
    organizationId: a.organizationId,
    deadlineId,
    action,
    fromStatus,
    toStatus,
    note,
    actorUserId: a.userId,
  });
}
async function assertResponsibleUser(
  tx: Transaction,
  a: Access,
  userId: string | null | undefined,
) {
  if (!userId) return;
  const [row] = await tx
    .select({ id: s.organizationUserRoles.userId })
    .from(s.organizationUserRoles)
    .where(
      and(
        eq(s.organizationUserRoles.organizationId, a.organizationId),
        eq(s.organizationUserRoles.userId, userId),
      ),
    );
  if (!row) throw new HttpError(422, 'INVALID_RELATION', 'Verantwortliche Person unbekannt.');
}
const deadlineResult =
  (db: Database, a: Access) => async (r: { data: { id: string }; replayed: boolean }) => ({
    data: await presentDeadline(db, a, r.data.id),
    replayed: r.replayed,
  });
export function createDeadline(
  db: Database,
  a: Access,
  key: string,
  input: z.infer<typeof deadlineInputSchema>,
) {
  return financialOperation(
    db,
    a,
    key,
    'compliance:deadline',
    input,
    'compliance:write',
    async (tx) => {
      await assertResponsibleUser(tx, a, input.responsibleUserId);
      let rule: typeof cr.$inferSelect | undefined;
      if (input.ruleId) {
        [rule] = await tx
          .select()
          .from(cr)
          .where(and(eq(cr.organizationId, a.organizationId), eq(cr.id, input.ruleId)));
        if (!rule) throw new HttpError(404, 'NOT_FOUND', 'Regel nicht gefunden.');
      }
      if (input.kind === 'legal' && !(rule?.legalBasis || input.legalBasis))
        throw new HttpError(
          422,
          'LEGAL_BASIS_REQUIRED',
          'Gesetzliche Pflichten benötigen eine Rechtsgrundlage.',
        );
      const [row] = await tx
        .insert(cd)
        .values({
          ...input,
          ruleVersion: rule?.version ?? null,
          kind: rule?.kind ?? input.kind,
          legalBasis: input.legalBasis || rule?.legalBasis || '',
          organizationId: a.organizationId,
          createdBy: a.userId,
        })
        .returning({ id: cd.id });
      await history(tx, a, row!.id, 'create', null, 'open');
      await audit(tx, a, 'create', 'compliance_deadline', row!.id, Object.keys(input));
      return { id: row!.id };
    },
  ).then(deadlineResult(db, a));
}
export function updateDeadline(
  db: Database,
  a: Access,
  key: string,
  id: string,
  input: z.infer<typeof deadlinePatchSchema>,
) {
  return financialOperation(
    db,
    a,
    key,
    `compliance:update:${id}`,
    input,
    'compliance:write',
    async (tx) => {
      const [row] = await tx
        .select()
        .from(cd)
        .where(and(eq(cd.organizationId, a.organizationId), eq(cd.id, id)))
        .for('update');
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Frist nicht gefunden.');
      if (row.version !== input.version)
        throw new HttpError(409, 'STALE_VERSION', 'Die Frist wurde zwischenzeitlich geändert.');
      if (row.status === 'done')
        throw new HttpError(409, 'DEADLINE_DONE', 'Erledigte Fristen sind abgeschlossen.');
      // Moving a statutory due date needs a documented reason.
      if (input.dueDate && input.dueDate !== row.dueDate && row.kind === 'legal' && !input.note)
        throw new HttpError(422, 'VALIDATION_ERROR', 'Bitte die Verschiebung begründen.');
      await assertResponsibleUser(tx, a, input.responsibleUserId);
      const { version, note, ...patch } = input;
      await tx
        .update(cd)
        .set({ ...patch, version: version + 1, updatedAt: new Date() })
        .where(and(eq(cd.organizationId, a.organizationId), eq(cd.id, id)));
      await history(
        tx,
        a,
        id,
        input.dueDate && input.dueDate !== row.dueDate ? 'reschedule' : 'update',
        row.status,
        patch.status ?? row.status,
        note,
      );
      await audit(tx, a, 'update', 'compliance_deadline', id, Object.keys(patch));
      return { id };
    },
  ).then(deadlineResult(db, a));
}
export function addEvidence(
  db: Database,
  a: Access,
  key: string,
  id: string,
  input: z.infer<typeof evidenceInputSchema>,
) {
  return financialOperation(
    db,
    a,
    key,
    `compliance:evidence:${id}`,
    input,
    'compliance:write',
    async (tx) => {
      const [row] = await tx
        .select()
        .from(cd)
        .where(and(eq(cd.organizationId, a.organizationId), eq(cd.id, id)))
        .for('update');
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Frist nicht gefunden.');
      if (row.status === 'done')
        throw new HttpError(409, 'DEADLINE_DONE', 'Erledigte Fristen sind abgeschlossen.');
      if (input.documentId)
        await getDocument(tx, a.organizationId, a.role, input.documentId, a.userId);
      await tx.insert(s.complianceEvidence).values({
        ...input,
        organizationId: a.organizationId,
        deadlineId: id,
        createdBy: a.userId,
      });
      await history(
        tx,
        a,
        id,
        'evidence',
        row.status,
        row.status,
        input.reference || input.description,
      );
      await audit(tx, a, 'evidence', 'compliance_deadline', id, Object.keys(input));
      return { id };
    },
  ).then(deadlineResult(db, a));
}
export function completeDeadline(
  db: Database,
  a: Access,
  key: string,
  id: string,
  input: z.infer<typeof deadlineCompleteSchema>,
) {
  return financialOperation(
    db,
    a,
    key,
    `compliance:complete:${id}`,
    input,
    'compliance:write',
    async (tx) => {
      const [row] = await tx
        .select()
        .from(cd)
        .where(and(eq(cd.organizationId, a.organizationId), eq(cd.id, id)))
        .for('update');
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Frist nicht gefunden.');
      if (row.version !== input.version)
        throw new HttpError(409, 'STALE_VERSION', 'Die Frist wurde zwischenzeitlich geändert.');
      if (row.status === 'done' || row.status === 'not_applicable')
        throw new HttpError(409, 'DEADLINE_DONE', 'Die Frist ist bereits abgeschlossen.');
      if (input.completedOn > today())
        throw new HttpError(422, 'VALIDATION_ERROR', 'Das Erledigungsdatum liegt in der Zukunft.');
      const [evidence] = await tx
        .select({ n: count() })
        .from(s.complianceEvidence)
        .where(
          and(
            eq(s.complianceEvidence.organizationId, a.organizationId),
            eq(s.complianceEvidence.deadlineId, id),
          ),
        );
      if (!evidence!.n)
        throw new HttpError(409, 'EVIDENCE_REQUIRED', 'Zuerst einen Nachweis hinterlegen.');
      await tx
        .update(cd)
        .set({
          status: 'done',
          completedOn: input.completedOn,
          completedBy: a.userId,
          protocolNumber: input.protocolNumber,
          version: input.version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(cd.organizationId, a.organizationId), eq(cd.id, id)));
      await history(tx, a, id, 'complete', row.status, 'done', input.note || input.protocolNumber);
      await audit(tx, a, 'complete', 'compliance_deadline', id, [
        'status',
        'completedOn',
        'protocolNumber',
      ]);
      return { id };
    },
  ).then(deadlineResult(db, a));
}
type Candidate = { sourceKey: string; sourceLabel: string; dueDate: string };
async function candidates(
  tx: Transaction,
  a: Access,
  rule: typeof cr.$inferSelect,
  from: string,
  to: string,
) {
  const calc = calculationSchema.parse(rule.calculation);
  const out: Candidate[] = [];
  const add = (sourceKey: string, sourceLabel: string, basisDate: string) => {
    const dueDate = dueDateFor(calc, basisDate);
    if (
      dueDate >= from &&
      dueDate <= to &&
      dueDate >= rule.validFrom &&
      (!rule.validTo || dueDate <= rule.validTo)
    )
      out.push({ sourceKey: `${rule.ruleKey}:${sourceKey}`, sourceLabel, dueDate });
  };
  const org = a.organizationId;
  if (calc.basis === 'fiscal_year_end')
    for (const fy of await tx
      .select()
      .from(s.fiscalYears)
      .where(eq(s.fiscalYears.organizationId, org)))
      add(`fy:${fy.id}`, `${fy.year} (${fy.startsOn} – ${fy.endsOn})`, fy.endsOn);
  if (calc.basis === 'annual_date')
    for (let year = Number(from.slice(0, 4)) - 1; year <= Number(to.slice(0, 4)) + 1; year++)
      add(String(year), String(year), annualDate(year, calc.month!, calc.day!));
  if (calc.basis === 'board_change' || calc.basis === 'board_mandate_end') {
    const mandates = await tx
      .select({ m: s.boardMandates, firstName: s.persons.firstName, lastName: s.persons.lastName })
      .from(s.boardMandates)
      .innerJoin(
        s.persons,
        and(
          eq(s.persons.organizationId, s.boardMandates.organizationId),
          eq(s.persons.id, s.boardMandates.personId),
        ),
      )
      .where(eq(s.boardMandates.organizationId, org));
    for (const { m, firstName, lastName } of mandates) {
      const label = `${m.position}: ${firstName} ${lastName}`;
      if (calc.basis === 'board_change') {
        add(`mandate:${m.id}:start`, label, m.startDate);
        if (m.endDate) add(`mandate:${m.id}:end`, label, m.endDate);
      } else if (m.endDate) add(`mandate:${m.id}:${m.endDate}`, label, m.endDate);
    }
  }
  if (calc.basis === 'policy_end')
    for (const p of await tx
      .select()
      .from(s.insurancePolicies)
      .where(
        and(eq(s.insurancePolicies.organizationId, org), eq(s.insurancePolicies.status, 'active')),
      ))
      add(`policy:${p.id}:${p.endsOn}`, `${p.insurer} · ${p.policyNumber}`, p.endsOn);
  if (calc.basis === 'last_register_snapshot') {
    const [last] = await tx
      .select()
      .from(s.volunteerRegisterSnapshots)
      .where(eq(s.volunteerRegisterSnapshots.organizationId, org))
      .orderBy(desc(s.volunteerRegisterSnapshots.snapshotNumber))
      .limit(1);
    const [first] = await tx
      .select({ d: sql<string | null>`min(${s.volunteerRegisterEntries.recordedAt})::date::text` })
      .from(s.volunteerRegisterEntries)
      .where(eq(s.volunteerRegisterEntries.organizationId, org));
    if (last)
      add(`after:${last.id}`, `#${last.snapshotNumber} (${last.cutoffDate})`, last.cutoffDate);
    else if (first?.d) add('initial', first.d, first.d);
  }
  return out;
}
export function generateDeadlines(
  db: Database,
  a: Access,
  key: string,
  input: z.infer<typeof generateDeadlinesSchema>,
) {
  return financialOperation(
    db,
    a,
    key,
    'compliance:generate',
    input,
    'compliance:write',
    async (tx) => {
      const rules = await tx
        .select()
        .from(cr)
        .where(and(eq(cr.organizationId, a.organizationId), eq(cr.active, true)));
      let created = 0,
        existing = 0;
      for (const rule of rules) {
        if (calculationSchema.parse(rule.calculation).basis === 'manual') continue;
        for (const c of await candidates(tx, a, rule, input.from, input.to)) {
          const [row] = await tx
            .insert(cd)
            .values({
              organizationId: a.organizationId,
              ruleId: rule.id,
              ruleVersion: rule.version,
              kind: rule.kind,
              topic: rule.topic,
              titleI18n: rule.titleI18n,
              descriptionI18n: rule.descriptionI18n,
              legalBasis: rule.legalBasis,
              responsibleRole: rule.responsibleRole,
              sourceKey: c.sourceKey,
              sourceLabel: c.sourceLabel,
              dueDate: c.dueDate,
              reminderDays: rule.reminderDays,
              createdBy: a.userId,
            })
            .onConflictDoNothing({ target: [cd.organizationId, cd.sourceKey] })
            .returning({ id: cd.id });
          if (row) {
            created++;
            await history(
              tx,
              a,
              row.id,
              'generate',
              null,
              'open',
              `${rule.ruleKey} v${rule.version}`,
            );
          } else existing++;
        }
      }
      await audit(tx, a, 'generate', 'compliance_deadline', a.organizationId, ['from', 'to']);
      return { created, existing };
    },
  );
}
