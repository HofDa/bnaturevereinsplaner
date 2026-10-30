import { createHash } from 'node:crypto';
import { and, eq, sql, asc, desc, lte } from 'drizzle-orm';
import { schema as s, type Database, type Executor, type Transaction } from '@bnature/db';
import {
  registerEntrySchema,
  registerViewSchema,
  snapshotSchema,
  snapshotValidationSchema,
  registerSettingsResponseSchema,
  registerDataIssues,
  detectSignatureMediaType,
  type RegisterSection,
  type RegisterEntryData,
  type RegisterSnapshot,
  type registerEntryInputSchema,
  type registerSettingsPatchSchema,
  type signatureVerificationSchema,
} from '@bnature/contracts';
import type { z } from 'zod';
import { HttpError, type Access } from '../../middleware/access';
import { audit } from '../../services/audit';
import type { DocumentStorage } from '../../services/storage';
import { technicalSignatureChecks, manualExternalProvider } from '../../services/signature';
import { financialOperation, readSnapshot, canonicalJson } from '../finance/operations';
import { renderPdf } from '../finance/pdf';
import { fingerprint, insertDocument, readDocumentVersion } from '../documents';
import { wire } from '../responses';
import {
  ve,
  engagementRow,
  personIdentity,
  registerSettings,
  registeredData,
  registerState,
  sectionFor,
  today,
} from './common';

const re = s.volunteerRegisterEntries,
  rs = s.volunteerRegisterSnapshots;
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
export async function getSettings(db: Executor, a: Access) {
  return registerSettingsResponseSchema.parse(wire(await registerSettings(db, a.organizationId)));
}
export function updateSettings(
  db: Database,
  a: Access,
  key: string,
  input: z.infer<typeof registerSettingsPatchSchema>,
) {
  return financialOperation(
    db,
    a,
    key,
    'register:settings',
    input,
    'register:finalize',
    async (tx) => {
      const current = await registerSettings(tx, a.organizationId);
      if (current.version !== input.version)
        throw new HttpError(
          409,
          'STALE_VERSION',
          'Die Einstellungen wurden zwischenzeitlich geändert.',
        );
      const { version, ...patch } = input;
      // The legal sign-off of the procedure is recorded by administrators only.
      if (
        (patch.legalApprovedOn !== undefined || patch.legalApprovalReference !== undefined) &&
        a.role !== 'admin'
      )
        throw new HttpError(403, 'FORBIDDEN', 'Die rechtliche Freigabe erfassen Administratoren.');
      const values = {
        ...current,
        ...patch,
        version: version + 1,
        updatedBy: a.userId,
        updatedAt: new Date(),
      };
      await tx
        .insert(s.volunteerRegisterSettings)
        .values({ ...values, organizationId: a.organizationId })
        .onConflictDoUpdate({ target: s.volunteerRegisterSettings.organizationId, set: values });
      await audit(
        tx,
        a,
        'update',
        'volunteer_register_settings',
        a.organizationId,
        Object.keys(patch),
      );
      return getSettings(tx, a);
    },
  );
}
const entryProjection = (db: Executor) =>
  db
    .select({
      id: re.id,
      section: re.section,
      entryNumber: re.entryNumber,
      engagementId: re.engagementId,
      entryType: re.entryType,
      effectiveDate: re.effectiveDate,
      correctsEntryId: re.correctsEntryId,
      data: re.data,
      reason: re.reason,
      recordedByName: s.user.name,
      recordedBy: re.recordedBy,
      recordedAt: re.recordedAt,
      previousHash: re.previousHash,
      entryHash: re.entryHash,
      organizationId: re.organizationId,
      personId: re.personId,
    })
    .from(re)
    .leftJoin(s.user, eq(s.user.id, re.recordedBy));
type EntryRow = Awaited<ReturnType<ReturnType<typeof entryProjection>['where']>>[number];
const entryHashInput = (e: Omit<EntryRow, 'id' | 'recordedByName' | 'entryHash'>) => ({
  organizationId: e.organizationId,
  section: e.section,
  entryNumber: e.entryNumber,
  engagementId: e.engagementId,
  personId: e.personId,
  entryType: e.entryType,
  effectiveDate: e.effectiveDate,
  correctsEntryId: e.correctsEntryId,
  data: e.data,
  reason: e.reason,
  recordedBy: e.recordedBy,
  recordedAt: e.recordedAt.toISOString(),
  previousHash: e.previousHash,
});
async function sectionEntries(db: Executor, organizationId: string, section: RegisterSection) {
  return entryProjection(db)
    .where(and(eq(re.organizationId, organizationId), eq(re.section, section)))
    .orderBy(asc(re.entryNumber));
}
// Current register state: admitted and not exited, with the latest recorded data.
function currentOf(entries: EntryRow[], cutoff?: string) {
  const byEngagement = new Map<string, EntryRow[]>();
  for (const e of entries)
    if (!cutoff || e.effectiveDate <= cutoff)
      byEngagement.set(e.engagementId, [...(byEngagement.get(e.engagementId) ?? []), e]);
  return [...byEngagement.entries()]
    .filter(
      ([, list]) =>
        list.some((e) => e.entryType === 'admission') && !list.some((e) => e.entryType === 'exit'),
    )
    .map(([engagementId, list]) => {
      const first = list.find((e) => e.entryType === 'admission')!,
        last = list.at(-1)!;
      return {
        engagementId,
        entryNumber: first.entryNumber,
        data: last.data as RegisterEntryData,
        lastEntryId: last.id,
      };
    })
    .sort((x, y) => x.entryNumber - y.entryNumber);
}
async function pendingActions(tx: Executor, a: Access, cutoff?: string) {
  const settings = await registerSettings(tx, a.organizationId);
  const engagements = await tx
    .select({ engagement: ve, firstName: s.persons.firstName, lastName: s.persons.lastName })
    .from(ve)
    .innerJoin(
      s.persons,
      and(eq(s.persons.organizationId, ve.organizationId), eq(s.persons.id, ve.personId)),
    )
    .where(
      and(eq(ve.organizationId, a.organizationId), cutoff ? lte(ve.startedOn, cutoff) : undefined),
    )
    .orderBy(asc(ve.startedOn), asc(ve.id));
  const entries = await tx
    .select()
    .from(re)
    .where(eq(re.organizationId, a.organizationId))
    .orderBy(asc(re.entryNumber));
  const pending = [];
  for (const { engagement, firstName, lastName } of engagements) {
    const identity = await personIdentity(tx, a.organizationId, engagement.personId);
    const state = registerState(engagement, entries, identity, settings.occasionalSection);
    if (state === 'registered' || state === 'closed') continue;
    const action =
      state === 'pending_admission'
        ? 'admission'
        : state === 'pending_exit'
          ? 'exit'
          : 'correction';
    if (action === 'exit' && cutoff && engagement.endedOn! > cutoff) continue;
    const last = entries.filter((e) => e.engagementId === engagement.id).at(-1);
    pending.push({
      engagementId: engagement.id,
      name: `${firstName} ${lastName}`,
      section: sectionFor(engagement.volunteerType),
      action: action as 'admission' | 'exit' | 'correction',
      issues: registerDataIssues(identity),
      correctsEntryId: action === 'correction' ? (last?.id ?? null) : null,
    });
  }
  return pending;
}
export async function registerView(db: Database, a: Access, section: RegisterSection) {
  return readSnapshot(db, async (tx) => {
    const entries = await sectionEntries(tx, a.organizationId, section);
    return registerViewSchema.parse({
      section,
      current: currentOf(entries),
      entries: entries.map((e) => registerEntrySchema.parse(wire(e))),
      pending: (await pendingActions(tx, a)).filter((p) => p.section === section),
    });
  });
}
export async function verifyChain(db: Database, a: Access) {
  return readSnapshot(db, async (tx) => {
    const result: Record<string, { entries: number; valid: boolean; brokenAt: number | null }> = {};
    for (const section of ['main', 'occasional'] as const) {
      const entries = await sectionEntries(tx, a.organizationId, section);
      let previous: string | null = null,
        brokenAt: number | null = null;
      for (const e of entries) {
        if (e.previousHash !== previous || hash(entryHashInput(e)) !== e.entryHash) {
          brokenAt = e.entryNumber;
          break;
        }
        previous = e.entryHash;
      }
      result[section] = { entries: entries.length, valid: brokenAt === null, brokenAt };
    }
    return result;
  });
}
export function createRegisterEntry(
  db: Database,
  a: Access,
  key: string,
  input: z.infer<typeof registerEntryInputSchema>,
) {
  return financialOperation(db, a, key, 'register:entry', input, 'register:write', async (tx) => {
    const engagement = await engagementRow(tx, a, input.engagementId, true);
    const settings = await registerSettings(tx, a.organizationId);
    const section = sectionFor(engagement.volunteerType);
    if (section === 'occasional' && !settings.occasionalSection)
      throw new HttpError(
        409,
        'REGISTER_SECTION_DISABLED',
        'Die Sektion für gelegentliche Freiwillige ist nicht eingerichtet.',
      );
    const own = await tx
      .select()
      .from(re)
      .where(and(eq(re.organizationId, a.organizationId), eq(re.engagementId, engagement.id)))
      .orderBy(asc(re.entryNumber));
    const identity = await personIdentity(tx, a.organizationId, engagement.personId);
    const issues = registerDataIssues(identity);
    if (issues.length)
      throw new HttpError(422, 'REGISTER_DATA_INCOMPLETE', 'Die Registerdaten sind unvollständig.');
    const data = registeredData(identity, engagement);
    let effectiveDate = engagement.startedOn;
    if (input.entryType === 'admission') {
      if (own.some((e) => e.entryType === 'admission'))
        throw new HttpError(
          409,
          'REGISTER_ALREADY_ADMITTED',
          'Die Aufnahme ist bereits eingetragen.',
        );
    } else {
      if (!own.some((e) => e.entryType === 'admission'))
        throw new HttpError(
          409,
          'REGISTER_NOT_ADMITTED',
          'Zuerst muss die Aufnahme eingetragen werden.',
        );
      if (own.some((e) => e.entryType === 'exit'))
        throw new HttpError(409, 'REGISTER_CLOSED', 'Der Austritt ist bereits eingetragen.');
    }
    if (input.entryType === 'exit') {
      if (!engagement.endedOn)
        throw new HttpError(409, 'REGISTER_NOT_ENDED', 'Die Tätigkeit ist noch nicht beendet.');
      effectiveDate = engagement.endedOn;
    }
    if (input.entryType === 'correction') {
      if (!own.some((e) => e.id === input.correctsEntryId))
        throw new HttpError(
          422,
          'INVALID_RELATION',
          'Der korrigierte Eintrag gehört nicht zu dieser Person.',
        );
      const last = own.at(-1)!.data as Record<string, unknown>;
      if (
        Object.entries(data).every(([k, v]) => k === 'endedOn' || (last[k] ?? null) === (v ?? null))
      )
        throw new HttpError(409, 'REGISTER_NO_CHANGE', 'Die Registerdaten sind unverändert.');
      effectiveDate = today();
    }
    const [last] = await tx
      .select({ entryNumber: re.entryNumber, entryHash: re.entryHash })
      .from(re)
      .where(and(eq(re.organizationId, a.organizationId), eq(re.section, section)))
      .orderBy(desc(re.entryNumber))
      .limit(1);
    const values = {
      organizationId: a.organizationId,
      section,
      entryNumber: (last?.entryNumber ?? 0) + 1,
      engagementId: engagement.id,
      personId: engagement.personId,
      entryType: input.entryType,
      effectiveDate,
      correctsEntryId: input.entryType === 'correction' ? input.correctsEntryId : null,
      data,
      reason: input.reason,
      recordedBy: a.userId,
      // JavaScript dates carry milliseconds, which timestamptz stores exactly, so the hash stays reproducible.
      recordedAt: new Date(),
      previousHash: last?.entryHash ?? null,
    };
    const [row] = await tx
      .insert(re)
      .values({ ...values, entryHash: hash(entryHashInput(values)) })
      .returning({ id: re.id });
    await audit(tx, a, input.entryType, 'volunteer_register_entry', row!.id, [
      'section',
      'entryNumber',
    ]);
    return { id: row!.id };
  }).then(async (r) => {
    const [row] = await entryProjection(db).where(
      and(eq(re.organizationId, a.organizationId), eq(re.id, r.data.id)),
    );
    return { data: registerEntrySchema.parse(wire(row)), replayed: r.replayed };
  });
}
export async function validateSnapshot(db: Database, a: Access, cutoffDate: string) {
  return readSnapshot(db, async (tx) => {
    const pending = await pendingActions(tx, a, cutoffDate);
    const main = currentOf(await sectionEntries(tx, a.organizationId, 'main'), cutoffDate),
      occasional = currentOf(await sectionEntries(tx, a.organizationId, 'occasional'), cutoffDate);
    const invalid = pending
      .filter((p) => p.issues.length)
      .map((p) => ({ engagementId: p.engagementId, name: p.name, issues: p.issues }));
    const [lastSnapshot] = await tx
      .select({ cutoffDate: rs.cutoffDate })
      .from(rs)
      .where(eq(rs.organizationId, a.organizationId))
      .orderBy(desc(rs.snapshotNumber))
      .limit(1);
    return snapshotValidationSchema.parse({
      cutoffDate,
      ready:
        !pending.length &&
        cutoffDate <= today() &&
        (!lastSnapshot || cutoffDate >= lastSnapshot.cutoffDate),
      pending,
      invalid,
      mainCount: main.length,
      occasionalCount: occasional.length,
    });
  });
}
const pdfLabels = {
  de: {
    title: 'Register der Freiwilligen – festgeschriebener Stand',
    snapshot: 'Registerstand Nr.',
    cutoff: 'Stichtag',
    generated: 'Erstellt am',
    main: 'Hauptregister – regelmäßig tätige Freiwillige (Art. 17 c. 1 D.Lgs. 117/2017)',
    occasional: 'Getrennte Sektion – gelegentlich tätige Freiwillige',
    current: 'Eingetragene Personen',
    entries: 'Chronologische Registervorgänge',
    admission: 'Aufnahme',
    exit: 'Austritt',
    correction: 'Korrektur zu',
    fiscal: 'StNr.',
    born: 'geb.',
    residence: 'Wohnsitz',
    domicile: 'Domizil',
    from: 'Beginn',
    to: 'Ende',
    payload: 'SHA-256 Registerdaten',
    previous: 'Vorheriger Stand',
    none: 'keiner',
    chain: 'Letzter Eintrags-Hash',
    note: 'Technische Festschreibung mit Prüfsumme. Eine SHA-256-Prüfsumme ersetzt keine qualifizierte elektronische Signatur und keinen Zeitstempel. Status: Signatur ausstehend.',
  },
  it: {
    title: 'Registro dei volontari – stato consolidato',
    snapshot: 'Stato del registro n.',
    cutoff: 'Data di riferimento',
    generated: 'Generato il',
    main: 'Registro – volontari non occasionali (art. 17 c. 1 D.Lgs. 117/2017)',
    occasional: 'Sezione separata – volontari occasionali',
    current: 'Persone iscritte',
    entries: 'Movimenti in ordine cronologico',
    admission: 'Iscrizione',
    exit: 'Cancellazione',
    correction: 'Rettifica di',
    fiscal: 'C.F.',
    born: 'nato/a',
    residence: 'Residenza',
    domicile: 'Domicilio',
    from: 'Inizio',
    to: 'Fine',
    payload: 'SHA-256 dati del registro',
    previous: 'Stato precedente',
    none: 'nessuno',
    chain: 'Ultimo hash di iscrizione',
    note: 'Consolidamento tecnico con checksum. Un checksum SHA-256 non sostituisce una firma elettronica qualificata né una marca temporale. Stato: firma in attesa.',
  },
};
type SnapshotMeta = {
  organizationId: string;
  snapshotNumber: number;
  cutoffDate: string;
  generatedAt: Date;
  mainLastNumber: number;
  occasionalLastNumber: number;
  previousSnapshotId: string | null;
  previousSha256: string | null;
};
// Deterministic: identical register entries and metadata produce identical bytes.
async function buildSnapshot(db: Executor, meta: SnapshotMeta) {
  const [organization] = await db
    .select({
      name: s.organizations.name,
      fiscalCode: s.organizations.fiscalCode,
      locale: s.organizations.locale,
    })
    .from(s.organizations)
    .where(eq(s.organizations.id, meta.organizationId));
  const sections = {} as Record<
    RegisterSection,
    { current: ReturnType<typeof currentOf>; entries: EntryRow[] }
  >;
  for (const section of ['main', 'occasional'] as const) {
    const last = section === 'main' ? meta.mainLastNumber : meta.occasionalLastNumber;
    const entries = (await sectionEntries(db, meta.organizationId, section)).filter(
      (e) => e.entryNumber <= last && e.effectiveDate <= meta.cutoffDate,
    );
    sections[section] = { current: currentOf(entries, meta.cutoffDate), entries };
  }
  const payload = {
    format: 'bnature-volunteer-register/1',
    organization: {
      id: meta.organizationId,
      name: organization!.name,
      fiscalCode: organization!.fiscalCode,
    },
    snapshotNumber: meta.snapshotNumber,
    cutoffDate: meta.cutoffDate,
    generatedAt: meta.generatedAt.toISOString(),
    previous: meta.previousSnapshotId
      ? { id: meta.previousSnapshotId, sha256: meta.previousSha256 }
      : null,
    sections: Object.fromEntries(
      Object.entries(sections).map(([key, value]) => [
        key,
        {
          current: value.current.map((c) => ({ entryNumber: c.entryNumber, data: c.data })),
          entries: value.entries.map((e) => ({
            entryNumber: e.entryNumber,
            entryType: e.entryType,
            effectiveDate: e.effectiveDate,
            data: e.data,
            reason: e.reason,
            recordedAt: e.recordedAt.toISOString(),
            entryHash: e.entryHash,
          })),
          lastEntryHash: value.entries.at(-1)?.entryHash ?? null,
        },
      ]),
    ),
  };
  const payloadSha256 = hash(payload);
  const language = organization!.locale,
    t = pdfLabels[language];
  const person = (d: RegisterEntryData) =>
    [
      `${d.lastName} ${d.firstName}`,
      d.fiscalCode ? `${t.fiscal} ${d.fiscalCode}` : '',
      d.dateOfBirth ? `${t.born} ${d.dateOfBirth} ${d.birthPlace}`.trim() : '',
      `${t.residence}: ${[d.street, d.postalCode, d.city, d.country].filter(Boolean).join(', ')}`,
      d.domicile ? `${t.domicile}: ${d.domicile}` : '',
      `${t.from} ${d.startedOn}`,
      d.endedOn ? `${t.to} ${d.endedOn}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  const lines = [
    `${t.snapshot} ${meta.snapshotNumber} · ${t.cutoff} ${meta.cutoffDate}`,
    `${t.generated} ${meta.generatedAt.toISOString()}`,
    `${t.previous}: ${meta.previousSha256 ?? t.none}`,
  ];
  for (const section of ['main', 'occasional'] as const) {
    const value = sections[section];
    lines.push('', t[section], `${t.current}: ${value.current.length}`);
    for (const c of value.current) lines.push(`#${c.entryNumber} ${person(c.data)}`);
    lines.push('', t.entries);
    for (const e of value.entries)
      lines.push(
        `#${e.entryNumber} ${e.effectiveDate} ${e.entryType === 'correction' ? `${t.correction} ${e.correctsEntryId?.slice(0, 8)}` : t[e.entryType]} · ${person(e.data as RegisterEntryData)}${e.reason ? ` · ${e.reason}` : ''}`,
      );
    lines.push(`${t.chain}: ${value.entries.at(-1)?.entryHash ?? t.none}`);
  }
  lines.push('', `${t.payload}: ${payloadSha256}`);
  const pdf = await renderPdf(
    `${t.title} (${meta.cutoffDate})`,
    organization!.name,
    lines,
    language,
    t.note,
    meta.generatedAt,
  );
  return {
    pdf,
    sha256: fingerprint(pdf),
    payloadSha256,
    mainCount: sections.main.current.length,
    occasionalCount: sections.occasional.current.length,
    language,
  };
}
const snapshotProjection = (db: Executor) =>
  db
    .select({
      snapshot: rs,
      createdByName: s.user.name,
    })
    .from(rs)
    .leftJoin(s.user, eq(s.user.id, rs.createdBy));
async function presentSnapshot(db: Executor, a: Access, id: string): Promise<RegisterSnapshot> {
  const [row] = await snapshotProjection(db).where(
    and(eq(rs.organizationId, a.organizationId), eq(rs.id, id)),
  );
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Registerstand nicht gefunden.');
  const settings = await registerSettings(db, a.organizationId);
  return snapshotSchema.parse({
    ...wire(row.snapshot),
    createdByName: row.createdByName,
    // A recorded legal approval of the procedure; never a certification claim.
    legallyApproved: !!settings.legalApprovedOn,
  });
}
export async function listSnapshots(db: Database, a: Access) {
  return readSnapshot(db, async (tx) => {
    const rows = await tx
      .select({ id: rs.id })
      .from(rs)
      .where(eq(rs.organizationId, a.organizationId))
      .orderBy(desc(rs.snapshotNumber));
    const items: RegisterSnapshot[] = [];
    for (const row of rows) items.push(await presentSnapshot(tx, a, row.id));
    return {
      items,
      provider: { id: manualExternalProvider.id, qualified: manualExternalProvider.qualified },
    };
  });
}
export function createSnapshot(
  db: Database,
  storage: DocumentStorage,
  a: Access,
  key: string,
  cutoffDate: string,
) {
  const written: string[] = [];
  return financialOperation(
    db,
    a,
    key,
    'register:snapshot',
    { cutoffDate },
    'register:finalize',
    async (tx) => {
      const validation = await validateSnapshot(tx as unknown as Database, a, cutoffDate);
      if (!validation.ready)
        throw new HttpError(
          409,
          'REGISTER_NOT_READY',
          'Der Registerstand ist nicht vollständig oder der Stichtag ist ungültig.',
        );
      const [previous] = await tx
        .select()
        .from(rs)
        .where(eq(rs.organizationId, a.organizationId))
        .orderBy(desc(rs.snapshotNumber))
        .limit(1);
      const lastNumber = async (section: RegisterSection) =>
        (
          await tx
            .select({ n: sql<number>`coalesce(max(${re.entryNumber}),0)::int` })
            .from(re)
            .where(and(eq(re.organizationId, a.organizationId), eq(re.section, section)))
        )[0]!.n;
      const meta: SnapshotMeta = {
        organizationId: a.organizationId,
        snapshotNumber: (previous?.snapshotNumber ?? 0) + 1,
        cutoffDate,
        generatedAt: new Date(Math.floor(Date.now() / 1000) * 1000),
        mainLastNumber: await lastNumber('main'),
        occasionalLastNumber: await lastNumber('occasional'),
        previousSnapshotId: previous?.id ?? null,
        previousSha256: previous?.sha256 ?? null,
      };
      const built = await buildSnapshot(tx, meta);
      const storageKey = crypto.randomUUID();
      await storage.write(a.organizationId, storageKey, built.pdf);
      written.push(storageKey);
      const documentId = await insertDocument(
        tx,
        a,
        {
          title: `${built.language === 'it' ? 'Registro volontari' : 'Freiwilligenregister'} #${meta.snapshotNumber} (${cutoffDate})`,
          category: 'register',
          description: `SHA-256 ${built.sha256}`,
        },
        `register-${meta.snapshotNumber}-${cutoffDate}.pdf`,
        { bytes: built.pdf, mediaType: 'application/pdf', sha256: built.sha256 },
        storageKey,
      );
      const [row] = await tx
        .insert(rs)
        .values({
          ...meta,
          mainCount: built.mainCount,
          occasionalCount: built.occasionalCount,
          payloadSha256: built.payloadSha256,
          sha256: built.sha256,
          documentId,
          createdBy: a.userId,
        })
        .returning({ id: rs.id });
      await audit(tx, a, 'finalize', 'volunteer_register_snapshot', row!.id, [
        'cutoffDate',
        'sha256',
      ]);
      return { id: row!.id };
    },
  )
    .then(async (r) => {
      if (r.replayed) for (const k of written) await storage.remove(a.organizationId, k);
      return { data: await presentSnapshot(db, a, r.data.id), replayed: r.replayed };
    })
    .catch(async (error: unknown) => {
      for (const k of written) await storage.remove(a.organizationId, k);
      throw error;
    });
}
// Recomputes the snapshot from the immutable entries and compares it with the archived file.
export async function verifySnapshotIntegrity(
  db: Database,
  storage: DocumentStorage,
  a: Access,
  id: string,
) {
  return readSnapshot(db, async (tx) => {
    const [row] = await tx
      .select()
      .from(rs)
      .where(and(eq(rs.organizationId, a.organizationId), eq(rs.id, id)));
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Registerstand nicht gefunden.');
    const rebuilt = await buildSnapshot(tx, row);
    const [version] = await tx
      .select({ id: s.documentVersions.id })
      .from(s.documentVersions)
      .where(
        and(
          eq(s.documentVersions.organizationId, a.organizationId),
          eq(s.documentVersions.documentId, row.documentId),
        ),
      );
    const file = await readDocumentVersion(
      db,
      storage,
      a.organizationId,
      a.role,
      row.documentId,
      version!.id,
      a.userId,
    );
    return {
      reproducible: rebuilt.sha256 === row.sha256 && rebuilt.payloadSha256 === row.payloadSha256,
      archivedFileIntact: file.sha256 === row.sha256,
      sha256: row.sha256,
      recomputedSha256: rebuilt.sha256,
    };
  });
}
export async function snapshotFile(
  db: Database,
  storage: DocumentStorage,
  a: Access,
  id: string,
  kind: 'snapshot' | 'signed' | 'timestamp',
) {
  const [row] = await db
    .select()
    .from(rs)
    .where(and(eq(rs.organizationId, a.organizationId), eq(rs.id, id)));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Registerstand nicht gefunden.');
  const documentId =
    kind === 'snapshot'
      ? row.documentId
      : kind === 'signed'
        ? row.signedDocumentId
        : row.timestampDocumentId;
  if (!documentId) throw new HttpError(404, 'NOT_FOUND', 'Datei nicht vorhanden.');
  const [version] = await db
    .select({ id: s.documentVersions.id })
    .from(s.documentVersions)
    .where(
      and(
        eq(s.documentVersions.organizationId, a.organizationId),
        eq(s.documentVersions.documentId, documentId),
      ),
    )
    .orderBy(desc(s.documentVersions.versionNumber))
    .limit(1);
  return readDocumentVersion(
    db,
    storage,
    a.organizationId,
    a.role,
    documentId,
    version!.id,
    a.userId,
  );
}
async function lockedSnapshot(tx: Transaction, a: Access, id: string) {
  const [row] = await tx
    .select()
    .from(rs)
    .where(and(eq(rs.organizationId, a.organizationId), eq(rs.id, id)))
    .for('update');
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Registerstand nicht gefunden.');
  return row;
}
export function importSignatureFile(
  db: Database,
  storage: DocumentStorage,
  a: Access,
  key: string,
  id: string,
  meta: { kind: 'signed' | 'timestamp'; filename: string },
  bytes: Buffer,
  declared: string,
) {
  const mediaType = detectSignatureMediaType(bytes, declared);
  const allowed =
    meta.kind === 'signed'
      ? ['application/pdf', 'application/pkcs7-mime']
      : ['application/timestamp-reply', 'application/pkcs7-mime'];
  if (!mediaType || !allowed.includes(mediaType))
    throw new HttpError(415, 'FILE_TYPE_MISMATCH', 'Der Dateityp passt nicht zur Signaturdatei.');
  const written: string[] = [];
  const sha256 = fingerprint(bytes);
  return financialOperation(
    db,
    a,
    key,
    `register:signature:${id}`,
    { ...meta, sha256, mediaType },
    'register:finalize',
    async (tx) => {
      const snapshot = await lockedSnapshot(tx, a, id);
      if (snapshot.status === 'verified')
        throw new HttpError(409, 'SNAPSHOT_VERIFIED', 'Der Registerstand ist bereits geprüft.');
      if (
        meta.kind === 'signed' &&
        snapshot.signedDocumentId &&
        snapshot.status !== 'verification_failed'
      )
        throw new HttpError(
          409,
          'SIGNATURE_EXISTS',
          'Eine signierte Datei ist bereits archiviert.',
        );
      const original = await snapshotFile(tx as unknown as Database, storage, a, id, 'snapshot');
      const signed =
        meta.kind === 'timestamp' && snapshot.signedDocumentId
          ? (await snapshotFile(tx as unknown as Database, storage, a, id, 'signed')).bytes
          : null;
      const checks = technicalSignatureChecks(meta.kind, original.bytes, bytes, mediaType, signed);
      const storageKey = crypto.randomUUID();
      await storage.write(a.organizationId, storageKey, bytes);
      written.push(storageKey);
      const documentId = await insertDocument(
        tx,
        a,
        {
          title: `${meta.kind === 'signed' ? 'Signatur' : 'Zeitstempel'} Registerstand #${snapshot.snapshotNumber}`,
          category: 'register',
          description: `SHA-256 ${sha256}`,
        },
        meta.filename,
        { bytes, mediaType, sha256 },
        storageKey,
      );
      const technicalChecks = {
        ...snapshot.technicalChecks,
        [meta.kind]: { ...checks, checkedAt: new Date().toISOString() },
      };
      await tx
        .update(rs)
        .set({
          ...(meta.kind === 'signed'
            ? {
                signedDocumentId: documentId,
                status: 'signature_imported' as const,
                verification: {},
              }
            : { timestampDocumentId: documentId }),
          technicalChecks,
          version: snapshot.version + 1,
        })
        .where(and(eq(rs.organizationId, a.organizationId), eq(rs.id, id)));
      await audit(tx, a, `import_${meta.kind}`, 'volunteer_register_snapshot', id, ['documentId']);
      return { id };
    },
  )
    .then(async (r) => {
      if (r.replayed) for (const k of written) await storage.remove(a.organizationId, k);
      return { data: await presentSnapshot(db, a, r.data.id), replayed: r.replayed };
    })
    .catch(async (error: unknown) => {
      for (const k of written) await storage.remove(a.organizationId, k);
      throw error;
    });
}
export function recordVerification(
  db: Database,
  a: Access,
  key: string,
  id: string,
  input: z.infer<typeof signatureVerificationSchema>,
) {
  return financialOperation(
    db,
    a,
    key,
    `register:verify:${id}`,
    input,
    'register:finalize',
    async (tx) => {
      const snapshot = await lockedSnapshot(tx, a, id);
      if (snapshot.version !== input.version)
        throw new HttpError(
          409,
          'STALE_VERSION',
          'Der Registerstand wurde zwischenzeitlich geändert.',
        );
      if (snapshot.status !== 'signature_imported')
        throw new HttpError(
          409,
          'SIGNATURE_MISSING',
          'Zuerst eine extern signierte Datei importieren.',
        );
      await tx
        .update(rs)
        .set({
          status: input.result,
          verification: {
            result: input.result,
            tool: input.tool,
            signer: input.signer,
            timestampTime: input.timestampTime,
            notes: input.notes,
            recordedBy: a.userId,
            recordedAt: new Date().toISOString(),
          },
          version: snapshot.version + 1,
        })
        .where(and(eq(rs.organizationId, a.organizationId), eq(rs.id, id)));
      await audit(tx, a, 'verify_signature', 'volunteer_register_snapshot', id, [
        'status',
        'verification',
      ]);
      return { id };
    },
  ).then(async (r) => ({ data: await presentSnapshot(db, a, r.data.id), replayed: r.replayed }));
}
