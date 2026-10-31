import { createHash } from 'node:crypto';
import { and, eq, sql, asc, desc, inArray, getTableColumns } from 'drizzle-orm';
import { schema as s, type Database, type Executor } from '@bnature/db';
import {
  addDays,
  policySchema,
  coverageSchema,
  notificationSchema,
  coverageOverviewSchema,
  type InsurancePolicy,
  type policyInputSchema,
  type policyPatchSchema,
  type coverageInputSchema,
  type coverageEndSchema,
  type notificationInputSchema,
  csvCell,
} from '@bnature/contracts';
import type { z } from 'zod';
import { HttpError, type Access } from '../../middleware/access';
import { audit } from '../../services/audit';
import { financialOperation, readSnapshot, canonicalJson } from '../finance/operations';
import { renderPdf, organizationName } from '../finance/pdf';
import { wire } from '../responses';
import { ve, registerSettings, coverageFor, personIdentity, today } from './common';

const ip = s.insurancePolicies,
  ic = s.insuranceCoverages;
// Single-table selects render columns unqualified, so correlated subqueries name the table.
const policyColumns = {
  ...getTableColumns(ip),
  coverageCount: sql<number>`(select count(*)::int from insurance_coverages c where c.organization_id="insurance_policies"."organization_id" and c.policy_id="insurance_policies"."id")`,
  documentCount: sql<number>`(select count(*)::int from documents d where d.organization_id="insurance_policies"."organization_id" and d.insurance_policy_id="insurance_policies"."id")`,
  lastNotifiedOn: sql<
    string | null
  >`(select max(n.notified_on)::text from insurer_notifications n where n.organization_id="insurance_policies"."organization_id" and n.policy_id="insurance_policies"."id")`,
};
async function presentPolicies(
  db: Executor,
  organizationId: string,
  rows: (typeof ip.$inferSelect & {
    coverageCount: number;
    documentCount: number;
    lastNotifiedOn: string | null;
  })[],
): Promise<InsurancePolicy[]> {
  const settings = await registerSettings(db, organizationId),
    now = today();
  return rows.map((row) =>
    policySchema.parse({
      ...wire(row),
      expiresInDays: Math.round((Date.parse(row.endsOn) - Date.parse(now)) / 86400000),
      // Art. 4 c. 2 D.M. 6.10.2021: at least ten years; counted from the end of the policy.
      retainUntil: addDays(row.endsOn, Math.round(settings.insuranceRetentionYears * 365.25)),
    }),
  );
}
export async function getPolicy(db: Executor, a: Access, id: string) {
  const rows = await db
    .select(policyColumns)
    .from(ip)
    .where(and(eq(ip.organizationId, a.organizationId), eq(ip.id, id)));
  if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Police nicht gefunden.');
  return (await presentPolicies(db, a.organizationId, rows))[0]!;
}
export async function listPolicies(db: Database, a: Access) {
  return readSnapshot(db, async (tx) => {
    const rows = await tx
      .select(policyColumns)
      .from(ip)
      .where(eq(ip.organizationId, a.organizationId))
      .orderBy(desc(ip.endsOn), asc(ip.insurer), asc(ip.id));
    return { items: await presentPolicies(tx, a.organizationId, rows) };
  });
}
const policyResult =
  (db: Database, a: Access) => async (r: { data: { id: string }; replayed: boolean }) => ({
    data: await getPolicy(db, a, r.data.id),
    replayed: r.replayed,
  });
export function createPolicy(
  db: Database,
  a: Access,
  key: string,
  input: z.infer<typeof policyInputSchema>,
) {
  return financialOperation(
    db,
    a,
    key,
    'insurance:create',
    input,
    'insurance:write',
    async (tx) => {
      const [row] = await tx
        .insert(ip)
        .values({ ...input, organizationId: a.organizationId, createdBy: a.userId })
        .returning({ id: ip.id });
      await audit(tx, a, 'create', 'insurance_policy', row!.id, Object.keys(input));
      return { id: row!.id };
    },
  ).then(policyResult(db, a));
}
export function updatePolicy(
  db: Database,
  a: Access,
  key: string,
  id: string,
  input: z.infer<typeof policyPatchSchema>,
) {
  return financialOperation(
    db,
    a,
    key,
    `insurance:update:${id}`,
    input,
    'insurance:write',
    async (tx) => {
      const [row] = await tx
        .select()
        .from(ip)
        .where(and(eq(ip.organizationId, a.organizationId), eq(ip.id, id)))
        .for('update');
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Police nicht gefunden.');
      if (row.version !== input.version)
        throw new HttpError(409, 'STALE_VERSION', 'Die Police wurde zwischenzeitlich geändert.');
      const { version, ...patch } = input;
      const startsOn = patch.startsOn ?? row.startsOn,
        endsOn = patch.endsOn ?? row.endsOn;
      if (endsOn < startsOn)
        throw new HttpError(422, 'VALIDATION_ERROR', 'Das Ende liegt vor dem Beginn.');
      if (patch.coverageTypes && new Set(patch.coverageTypes).size !== patch.coverageTypes.length)
        throw new HttpError(422, 'VALIDATION_ERROR', 'Versicherungsarten doppelt angegeben.');
      await tx
        .update(ip)
        .set({ ...patch, version: version + 1, updatedAt: new Date() })
        .where(and(eq(ip.organizationId, a.organizationId), eq(ip.id, id)));
      await audit(tx, a, 'update', 'insurance_policy', id, Object.keys(patch));
      return { id };
    },
  ).then(policyResult(db, a));
}
function coverageProjection(db: Executor) {
  return db
    .select({
      id: ic.id,
      policyId: ic.policyId,
      engagementId: ic.engagementId,
      volunteerName: sql<string>`${s.persons.firstName}||' '||${s.persons.lastName}`,
      volunteerType: ve.volunteerType,
      coveredFrom: ic.coveredFrom,
      coveredTo: ic.coveredTo,
      notes: ic.notes,
      notifiedOn: sql<
        string | null
      >`(select max(n.notified_on)::text from insurer_notification_items i join insurer_notifications n on n.organization_id=i.organization_id and n.id=i.notification_id where i.organization_id=${ic.organizationId} and i.engagement_id=${ic.engagementId} and n.policy_id=${ic.policyId})`,
    })
    .from(ic)
    .innerJoin(ve, and(eq(ve.organizationId, ic.organizationId), eq(ve.id, ic.engagementId)))
    .innerJoin(
      s.persons,
      and(eq(s.persons.organizationId, ve.organizationId), eq(s.persons.id, ve.personId)),
    );
}
export async function listCoverages(db: Executor, a: Access, policyId: string) {
  await getPolicy(db, a, policyId);
  const rows = await coverageProjection(db)
    .where(and(eq(ic.organizationId, a.organizationId), eq(ic.policyId, policyId)))
    .orderBy(asc(s.persons.lastName), asc(ic.coveredFrom));
  return { items: rows.map((r) => coverageSchema.parse(wire(r))) };
}
export function addCoverages(
  db: Database,
  a: Access,
  key: string,
  policyId: string,
  input: z.infer<typeof coverageInputSchema>,
) {
  return financialOperation(
    db,
    a,
    key,
    `insurance:cover:${policyId}`,
    input,
    'insurance:write',
    async (tx) => {
      const [policy] = await tx
        .select()
        .from(ip)
        .where(and(eq(ip.organizationId, a.organizationId), eq(ip.id, policyId)))
        .for('update');
      if (!policy) throw new HttpError(404, 'NOT_FOUND', 'Police nicht gefunden.');
      if (input.coveredFrom < policy.startsOn || (input.coveredTo ?? policy.endsOn) > policy.endsOn)
        throw new HttpError(
          422,
          'COVERAGE_OUTSIDE_POLICY',
          'Der Zeitraum liegt außerhalb der Policenlaufzeit.',
        );
      const ids = [...new Set(input.engagementIds)];
      const engagements = await tx
        .select()
        .from(ve)
        .where(and(eq(ve.organizationId, a.organizationId), inArray(ve.id, ids)));
      if (engagements.length !== ids.length)
        throw new HttpError(404, 'NOT_FOUND', 'Freiwilligeneinsatz nicht gefunden.');
      for (const engagement of engagements) {
        if (
          (policy.insuredGroup === 'regular' && engagement.volunteerType !== 'regular') ||
          (policy.insuredGroup === 'occasional' && engagement.volunteerType !== 'occasional')
        )
          throw new HttpError(
            422,
            'COVERAGE_GROUP_MISMATCH',
            'Die Police gilt nicht für diese Gruppe.',
          );
        const [clash] = await tx
          .select({ id: ic.id })
          .from(ic)
          .where(
            and(
              eq(ic.organizationId, a.organizationId),
              eq(ic.policyId, policyId),
              eq(ic.engagementId, engagement.id),
              sql`daterange(${ic.coveredFrom},${ic.coveredTo},'[]') && daterange(${input.coveredFrom}::date,${input.coveredTo}::date,'[]')`,
            ),
          );
        if (clash)
          throw new HttpError(
            409,
            'COVERAGE_EXISTS',
            'Für diesen Zeitraum besteht bereits eine Zuordnung.',
          );
      }
      await tx.insert(ic).values(
        ids.map((engagementId) => ({
          organizationId: a.organizationId,
          policyId,
          engagementId,
          coveredFrom: input.coveredFrom,
          coveredTo: input.coveredTo,
          notes: input.notes,
          createdBy: a.userId,
        })),
      );
      await audit(tx, a, 'cover', 'insurance_policy', policyId, [
        'engagementIds',
        'coveredFrom',
        'coveredTo',
      ]);
      return { id: policyId, count: ids.length };
    },
  );
}
export function endCoverage(
  db: Database,
  a: Access,
  key: string,
  coverageId: string,
  input: z.infer<typeof coverageEndSchema>,
) {
  return financialOperation(
    db,
    a,
    key,
    `insurance:coverage-end:${coverageId}`,
    input,
    'insurance:write',
    async (tx) => {
      const [row] = await tx
        .select()
        .from(ic)
        .where(and(eq(ic.organizationId, a.organizationId), eq(ic.id, coverageId)))
        .for('update');
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Zuordnung nicht gefunden.');
      if (input.coveredTo < row.coveredFrom || (row.coveredTo && input.coveredTo > row.coveredTo))
        throw new HttpError(422, 'VALIDATION_ERROR', 'Ungültiges Ende der Zuordnung.');
      await tx
        .update(ic)
        .set({ coveredTo: input.coveredTo, endReason: input.reason, updatedAt: new Date() })
        .where(and(eq(ic.organizationId, a.organizationId), eq(ic.id, coverageId)));
      await audit(tx, a, 'end', 'insurance_coverage', coverageId, ['coveredTo', 'endReason']);
      return { id: coverageId };
    },
  );
}
// Art. 3 c. 5 D.M. 6.10.2021: register data of covered volunteers for the insurer.
export async function notificationList(db: Database, a: Access, policyId: string, on = today()) {
  return readSnapshot(db, async (tx) => {
    const policy = await getPolicy(tx, a, policyId);
    const rows = await tx
      .select({ engagement: ve, coveredFrom: ic.coveredFrom, coveredTo: ic.coveredTo })
      .from(ic)
      .innerJoin(ve, and(eq(ve.organizationId, ic.organizationId), eq(ve.id, ic.engagementId)))
      .where(
        and(
          eq(ic.organizationId, a.organizationId),
          eq(ic.policyId, policyId),
          sql`${ic.coveredFrom}<=${on}::date and (${ic.coveredTo} is null or ${ic.coveredTo}>=${on}::date)`,
        ),
      );
    const people = [];
    for (const row of rows) {
      const identity = await personIdentity(tx, a.organizationId, row.engagement.personId);
      people.push({
        engagementId: row.engagement.id,
        volunteerType: row.engagement.volunteerType,
        lastName: identity.lastName,
        firstName: identity.firstName,
        fiscalCode: identity.fiscalCode,
        dateOfBirth: identity.dateOfBirth,
        birthPlace: identity.birthPlace,
        residence: [identity.street, identity.postalCode, identity.city, identity.country]
          .filter(Boolean)
          .join(', '),
        domicile: identity.domicile,
        startedOn: row.engagement.startedOn,
        endedOn: row.engagement.endedOn,
        coveredFrom: row.coveredFrom,
        coveredTo: row.coveredTo,
      });
    }
    people.sort((x, y) =>
      `${x.lastName} ${x.firstName}`.localeCompare(`${y.lastName} ${y.firstName}`, 'de'),
    );
    const payload = {
      policy: { insurer: policy.insurer, policyNumber: policy.policyNumber },
      on,
      people,
    };
    return {
      ...payload,
      sha256: createHash('sha256').update(canonicalJson(payload)).digest('hex'),
    };
  });
}
const listLabels = {
  de: {
    title: 'Meldeliste Freiwillige',
    policy: 'Police',
    on: 'Stichtag',
    name: 'Name',
    fiscal: 'Steuernummer',
    birth: 'Geburt',
    residence: 'Wohnsitz',
    domicile: 'Domizil',
    period: 'Tätigkeit',
    covered: 'Zuordnung',
    type: 'Art',
    regular: 'regelmäßig',
    occasional: 'gelegentlich',
    note: 'Meldeliste zur manuellen Übermittlung an den Versicherer. Keine Bestätigung des Versicherungsschutzes.',
    checksum: 'Prüfsumme (SHA-256)',
  },
  it: {
    title: 'Elenco volontari per l’assicurazione',
    policy: 'Polizza',
    on: 'Data di riferimento',
    name: 'Nome',
    fiscal: 'Codice fiscale',
    birth: 'Nascita',
    residence: 'Residenza',
    domicile: 'Domicilio',
    period: 'Attività',
    covered: 'Copertura assegnata',
    type: 'Tipo',
    regular: 'non occasionale',
    occasional: 'occasionale',
    note: 'Elenco per l’invio manuale all’impresa assicuratrice. Non conferma la copertura assicurativa.',
    checksum: 'Checksum (SHA-256)',
  },
};
export async function notificationListFile(
  db: Database,
  a: Access,
  policyId: string,
  format: 'csv' | 'pdf',
  language: 'de' | 'it',
  on?: string,
) {
  const list = await notificationList(db, a, policyId, on),
    t = listLabels[language];
  const rows = list.people.map((p) => [
    `${p.lastName} ${p.firstName}`,
    p.fiscalCode,
    [p.dateOfBirth, p.birthPlace].filter(Boolean).join(' '),
    p.residence,
    p.domicile,
    `${p.startedOn} – ${p.endedOn ?? ''}`,
    `${p.coveredFrom} – ${p.coveredTo ?? ''}`,
    t[p.volunteerType],
  ]);
  if (format === 'csv')
    return (
      '﻿' +
      [
        [t.name, t.fiscal, t.birth, t.residence, t.domicile, t.period, t.covered, t.type],
        ...rows,
        [t.checksum, list.sha256, '', '', '', '', '', ''],
      ]
        .map((row) => row.map(csvCell).join(';'))
        .join('\r\n')
    );
  return renderPdf(
    t.title,
    await organizationName(db, a.organizationId),
    [
      `${t.policy}: ${list.policy.insurer} · ${list.policy.policyNumber}`,
      `${t.on}: ${list.on}`,
      ...rows.map((r) => r.filter(Boolean).join(' | ')),
      `${t.checksum}: ${list.sha256}`,
    ],
    language,
    t.note,
  );
}
export async function listNotifications(db: Executor, a: Access, policyId: string) {
  await getPolicy(db, a, policyId);
  const n = s.insurerNotifications;
  const rows = await db
    .select({
      ...getTableColumns(n),
      createdByName: s.user.name,
      personCount: sql<number>`(select count(*)::int from insurer_notification_items i where i.organization_id=${n.organizationId} and i.notification_id=${n.id})`,
      proofDocumentIds: sql<
        string[]
      >`coalesce((select array_agg(d.id order by d.created_at) from documents d where d.organization_id=${n.organizationId} and d.insurer_notification_id=${n.id}), '{}')`,
    })
    .from(n)
    .leftJoin(s.user, eq(s.user.id, n.createdBy))
    .where(and(eq(n.organizationId, a.organizationId), eq(n.policyId, policyId)))
    .orderBy(desc(n.notifiedOn), desc(n.createdAt));
  return { items: rows.map((r) => notificationSchema.parse(wire(r))) };
}
export function recordNotification(
  db: Database,
  a: Access,
  key: string,
  input: z.infer<typeof notificationInputSchema>,
) {
  return financialOperation(
    db,
    a,
    key,
    'insurance:notify',
    input,
    'insurance:write',
    async (tx) => {
      const policy = await getPolicy(tx, a, input.policyId);
      const ids = [...new Set(input.engagementIds)];
      const covered = await tx
        .select({ engagementId: ic.engagementId })
        .from(ic)
        .where(
          and(
            eq(ic.organizationId, a.organizationId),
            eq(ic.policyId, policy.id),
            inArray(ic.engagementId, ids),
          ),
        );
      if (new Set(covered.map((c) => c.engagementId)).size !== ids.length)
        throw new HttpError(
          422,
          'NOTIFICATION_NOT_COVERED',
          'Die Liste enthält Personen ohne Zuordnung zur Police.',
        );
      const [row] = await tx
        .insert(s.insurerNotifications)
        .values({
          organizationId: a.organizationId,
          policyId: policy.id,
          notifiedOn: input.notifiedOn,
          method: input.method,
          listSha256: input.listSha256,
          notes: input.notes,
          createdBy: a.userId,
        })
        .returning({ id: s.insurerNotifications.id });
      await tx.insert(s.insurerNotificationItems).values(
        ids.map((engagementId) => ({
          organizationId: a.organizationId,
          notificationId: row!.id,
          engagementId,
        })),
      );
      await audit(tx, a, 'notify', 'insurance_policy', policy.id, [
        'notifiedOn',
        'method',
        'listSha256',
      ]);
      return { id: row!.id };
    },
  );
}
export async function coverageOverview(db: Database, a: Access, date = today()) {
  return readSnapshot(db, async (tx) => {
    const engagements = await tx
      .select()
      .from(ve)
      .where(
        and(
          eq(ve.organizationId, a.organizationId),
          sql`${ve.status}<>'ended' or ${ve.endedOn}>=${date}::date`,
        ),
      );
    const coverage = await coverageFor(tx, a.organizationId, engagements, date);
    const settings = await registerSettings(tx, a.organizationId);
    const names = await tx
      .select({ id: ve.id, name: sql<string>`${s.persons.firstName}||' '||${s.persons.lastName}` })
      .from(ve)
      .innerJoin(
        s.persons,
        and(eq(s.persons.organizationId, ve.organizationId), eq(s.persons.id, ve.personId)),
      )
      .where(eq(ve.organizationId, a.organizationId));
    const expiringRows = await tx
      .select(policyColumns)
      .from(ip)
      .where(
        and(
          eq(ip.organizationId, a.organizationId),
          eq(ip.status, 'active'),
          sql`${ip.endsOn} between ${date}::date and ${date}::date + ${settings.expiryWarningDays}::int`,
        ),
      )
      .orderBy(asc(ip.endsOn));
    return coverageOverviewSchema.parse({
      date,
      items: engagements
        .map((e) => ({
          engagementId: e.id,
          name: names.find((n) => n.id === e.id)?.name ?? '',
          volunteerType: e.volunteerType,
          ...coverage.get(e.id)!,
        }))
        .sort((x, y) => x.name.localeCompare(y.name, 'de')),
      expiring: await presentPolicies(tx, a.organizationId, expiringRows),
    });
  });
}
