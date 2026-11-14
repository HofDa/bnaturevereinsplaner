import { createHash } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import { createDatabase, schema as s } from '../../packages/db/src';
import { createApp } from '../../apps/api/src/app';
import { readConfig } from '../../apps/api/src/plugins/config';
import { bootstrap } from '../../apps/api/src/services/bootstrap';
import {
  encodeDocumentMetadata,
  type VolunteerDetail,
  type VolunteerSummary,
  type VolunteerAssignment,
  type VolunteerTimeEntry,
  type InsurancePolicy,
  type RegisterEntry,
  type RegisterSnapshot,
  type ComplianceDeadline,
  type ComplianceRule,
  type DocumentDetail,
  type EventCategory,
  type EventOccurrence,
  type EventRegistration,
} from '../../packages/contracts/src';
const config = readConfig();
if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('/bnature_test'))
  throw new Error('Dedicated test database required');
const { db, pool } = createDatabase(config.DATABASE_URL),
  app = await createApp(db, config),
  password = 'Volunteers-test-only-2026!';
const today = new Date().toISOString().slice(0, 10);
let admin = '',
  board = '',
  treasurer = '',
  lead = '',
  member = '',
  foreign = '',
  org = '',
  leadId = '',
  memberPersonId = '',
  regular: VolunteerDetail,
  occasional: VolunteerDetail,
  policy: InsurancePolicy;
const headers = (cookie: string, key?: string) => ({
  cookie,
  origin: config.APP_URL,
  ...(key ? { 'idempotency-key': key } : {}),
});
const get = (path: string, cookie = admin) =>
  app.inject({ url: `/api/v1${path}`, headers: headers(cookie) });
const send = (
  method: 'POST' | 'PATCH',
  path: string,
  payload: unknown,
  cookie = admin,
  key: string = crypto.randomUUID(),
) =>
  app.inject({
    method,
    url: `/api/v1${path}`,
    headers: headers(cookie, key),
    payload: payload as Record<string, unknown>,
  });
const post = (path: string, payload: unknown, cookie = admin, key: string = crypto.randomUUID()) =>
  send('POST', path, payload, cookie, key);
const patch = (path: string, payload: unknown, cookie = admin) =>
  send('PATCH', path, payload, cookie);
async function ok<T>(response: Awaited<ReturnType<typeof get>>, code = 200) {
  expect(response.statusCode, response.body).toBe(code);
  return response.json<T>();
}
async function login(email: string) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { origin: config.APP_URL },
    payload: { email, password },
  });
  expect(r.statusCode, r.body).toBe(200);
  const cookies = r.headers['set-cookie'];
  return (Array.isArray(cookies) ? cookies : [cookies])
    .filter(Boolean)
    .map((c) => c!.split(';')[0])
    .join('; ');
}
const upload = (
  path: string,
  cookie: string,
  metadata: unknown,
  bytes: Buffer,
  type = 'application/pdf',
) =>
  app.inject({
    method: 'POST',
    url: `/api/v1${path}`,
    headers: {
      ...headers(cookie, crypto.randomUUID()),
      'content-type': type,
      'x-document-metadata': encodeDocumentMetadata(metadata),
    },
    payload: bytes,
  });
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const registerData = {
  fiscalCode: 'RSSMRA80A01A952X',
  street: 'Domplatz 1',
  postalCode: '39042',
  city: 'Brixen',
  country: 'IT',
};
async function rejected(statement: ReturnType<typeof sql>) {
  await expect(db.execute(statement)).rejects.toThrow();
}
beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/db/migrations' });
  await db.execute(sql`truncate table organizations,users cascade`);
  const root = await bootstrap(db, config, {
    name: 'Volunteer Admin',
    email: 'vol-admin@example.test',
    password,
    organizationName: 'Volunteers',
    slug: 'volunteers',
  });
  org = root.organizationId;
  await bootstrap(db, config, {
    name: 'Foreign Admin',
    email: 'vol-foreign@example.test',
    password,
    organizationName: 'Foreign',
    slug: 'volunteers-foreign',
  });
  await app.ready();
  admin = await login('vol-admin@example.test');
  foreign = await login('vol-foreign@example.test');
  for (const [role, name] of [
    ['board', 'board'],
    ['treasurer', 'treasurer'],
    ['project_lead', 'lead'],
    ['member', 'member'],
  ] as const)
    await ok(
      await post('/users', { name, email: `vol-${name}@example.test`, password, role }),
      201,
    );
  board = await login('vol-board@example.test');
  treasurer = await login('vol-treasurer@example.test');
  lead = await login('vol-lead@example.test');
  member = await login('vol-member@example.test');
  const [l] = await db.select().from(s.user).where(eq(s.user.email, 'vol-lead@example.test'));
  leadId = l!.id;
  const created = await ok<{ personId: string }>(
    await post('/members', {
      firstName: 'Mara',
      lastName: 'Mitglied',
      membershipNumber: 'V-001',
      joinedAt: '2020-01-01',
    }),
    201,
  );
  memberPersonId = created.personId;
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('volunteer management', () => {
  it('1: lets one person be member and volunteer without a second person record', async () => {
    const before = await db.select().from(s.persons);
    regular = await ok(
      await post('/volunteers', {
        personId: memberPersonId,
        volunteerType: 'regular',
        startedOn: '2026-01-10',
        focusAreas: ['Biotoppflege'],
        activity: 'Pflegeeinsätze',
        registerData,
      }),
      201,
    );
    expect(regular.isMember).toBe(true);
    expect(regular.personId).toBe(memberPersonId);
    expect(await db.select().from(s.persons)).toHaveLength(before.length);
    expect(regular.registerData?.fiscalCode).toBe(registerData.fiscalCode);
    expect(regular.registerState).toBe('pending_admission');
    const again = await post('/volunteers', {
      personId: memberPersonId,
      volunteerType: 'occasional',
      startedOn: '2026-02-01',
    });
    expect(again.statusCode).toBe(409);
    // Idempotent replay returns the same engagement and stores no personal data in the operation log.
    const key = crypto.randomUUID();
    const body = {
      person: { firstName: 'Olga', lastName: 'Gelegentlich' },
      volunteerType: 'occasional',
      startedOn: '2026-03-01',
    };
    occasional = await ok(await post('/volunteers', body, admin, key), 201);
    const replay = await post('/volunteers', body, admin, key);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.json<VolunteerDetail>().id).toBe(occasional.id);
    const [operation] = await db
      .select()
      .from(s.financeOperations)
      .where(eq(s.financeOperations.idempotencyKey, key));
    expect(JSON.stringify(operation!.response)).not.toContain('Gelegentlich');
    expect(occasional.isMember).toBe(false);
  });
  it('2: distinguishes regular and occasional volunteers', async () => {
    const regularList = await ok<{ items: VolunteerSummary[] }>(
      await get('/volunteers?volunteerType=regular'),
    );
    expect(regularList.items.map((v) => v.id)).toEqual([regular.id]);
    const occasionalList = await ok<{ items: VolunteerSummary[] }>(
      await get('/volunteers?volunteerType=occasional'),
    );
    expect(occasionalList.items.map((v) => v.id)).toEqual([occasional.id]);
    // General lists never carry register data.
    expect(JSON.stringify(regularList)).not.toContain(registerData.fiscalCode);
    const leadView = await ok<VolunteerDetail>(await get(`/volunteers/${regular.id}`, lead));
    expect(leadView.registerData).toBeNull();
  });
  it('3: historizes admission and exit and records them in the register', async () => {
    const incomplete = await post('/volunteer-register/entries', {
      engagementId: occasional.id,
      entryType: 'admission',
    });
    expect(incomplete.statusCode).toBe(422);
    expect(incomplete.json().error.code).toBe('REGISTER_DATA_INCOMPLETE');
    occasional = await ok(
      await patch(`/volunteers/${occasional.id}`, {
        version: occasional.version,
        registerData: {
          dateOfBirth: '1990-05-05',
          birthPlace: 'Bozen',
          domicile: 'Bahnhofstraße 3, 39100 Bozen',
        },
      }),
    );
    expect(occasional.registerIssues).toEqual([]);
    const main = await ok<RegisterEntry>(
      await post('/volunteer-register/entries', {
        engagementId: regular.id,
        entryType: 'admission',
      }),
      201,
    );
    expect([main.section, main.entryNumber, main.previousHash]).toEqual(['main', 1, null]);
    expect(main.effectiveDate).toBe('2026-01-10');
    const occ = await ok<RegisterEntry>(
      await post('/volunteer-register/entries', {
        engagementId: occasional.id,
        entryType: 'admission',
      }),
      201,
    );
    expect([occ.section, occ.entryNumber]).toEqual(['occasional', 1]);
    expect(
      (
        await post('/volunteer-register/entries', {
          engagementId: regular.id,
          entryType: 'admission',
        })
      ).statusCode,
    ).toBe(409);
    // A third volunteer joins and leaves.
    let leaver = await ok<VolunteerDetail>(
      await post('/volunteers', {
        person: { firstName: 'Lea', lastName: 'Leaving' },
        volunteerType: 'regular',
        startedOn: '2026-02-01',
        registerData: { ...registerData, fiscalCode: 'LVNLEA85B41A952Y' },
      }),
      201,
    );
    await ok(
      await post('/volunteer-register/entries', {
        engagementId: leaver.id,
        entryType: 'admission',
      }),
      201,
    );
    expect(
      (await post('/volunteer-register/entries', { engagementId: leaver.id, entryType: 'exit' }))
        .statusCode,
    ).toBe(409);
    leaver = await ok(
      await post(`/volunteers/${leaver.id}/end`, {
        version: leaver.version,
        endedOn: '2026-06-30',
        reason: 'Umzug',
      }),
    );
    expect(leaver.status).toBe('ended');
    expect(leaver.registerState).toBe('pending_exit');
    expect(leaver.history.map((h) => h.action)).toEqual(['create', 'end']);
    const exit = await ok<RegisterEntry>(
      await post('/volunteer-register/entries', { engagementId: leaver.id, entryType: 'exit' }),
      201,
    );
    expect([exit.entryNumber, exit.effectiveDate, exit.data.endedOn]).toEqual([
      3,
      '2026-06-30',
      '2026-06-30',
    ]);
    const view = await ok<{ current: { engagementId: string }[]; entries: RegisterEntry[] }>(
      await get('/volunteer-register?section=main'),
    );
    expect(view.current.map((c) => c.engagementId)).toEqual([regular.id]);
    expect(view.entries.map((e) => e.entryType)).toEqual(['admission', 'admission', 'exit']);
    expect(
      (await patch(`/volunteers/${leaver.id}`, { version: leaver.version, notes: 'x' })).statusCode,
    ).toBe(409);
  });
  it('4: records corrections as new entries without overwriting the original', async () => {
    regular = await ok(
      await patch(`/volunteers/${regular.id}`, {
        version: regular.version,
        registerData: { city: 'Klausen', postalCode: '39043' },
      }),
    );
    expect(regular.registerState).toBe('pending_correction');
    const original = (
      await ok<{ entries: RegisterEntry[] }>(await get('/volunteer-register?section=main'))
    ).entries[0]!;
    expect(
      (
        await post('/volunteer-register/entries', {
          engagementId: regular.id,
          entryType: 'correction',
          correctsEntryId: original.id,
        })
      ).statusCode,
    ).toBe(422);
    const correction = await ok<RegisterEntry>(
      await post('/volunteer-register/entries', {
        engagementId: regular.id,
        entryType: 'correction',
        correctsEntryId: original.id,
        reason: 'Wohnsitzwechsel gemeldet',
      }),
      201,
    );
    expect(correction.data.city).toBe('Klausen');
    expect(correction.previousHash).not.toBeNull();
    const after = await ok<{ entries: RegisterEntry[]; current: { data: { city: string } }[] }>(
      await get('/volunteer-register?section=main'),
    );
    expect(after.entries[0]).toEqual(original);
    expect(after.entries[0]!.data.city).toBe('Brixen');
    expect(after.current[0]!.data.city).toBe('Klausen');
    await rejected(sql`update volunteer_register_entries set reason='x' where id=${original.id}`);
    await rejected(sql`delete from volunteer_register_entries where id=${original.id}`);
    expect(await ok(await get('/volunteer-register/verify'))).toEqual({
      main: { entries: 4, valid: true, brokenAt: null },
      occasional: { entries: 1, valid: true, brokenAt: null },
    });
  });
});

describe('register snapshots and signatures', () => {
  let snapshot: RegisterSnapshot, pdf: Buffer;
  it('5+6: finalizes reproducible snapshots with correct checksums', async () => {
    const pending = await post('/volunteers', {
      person: { firstName: 'Paul', lastName: 'Pending' },
      volunteerType: 'regular',
      startedOn: '2026-04-01',
    });
    const paul = await ok<VolunteerDetail>(pending, 201);
    const validation = await ok<{ ready: boolean; invalid: { engagementId: string }[] }>(
      await get(`/register-snapshots/validation?cutoffDate=${today}`),
    );
    expect(validation.ready).toBe(false);
    expect(validation.invalid.map((i) => i.engagementId)).toEqual([paul.id]);
    expect((await post('/register-snapshots', { cutoffDate: today })).statusCode).toBe(409);
    await ok(
      await patch(`/volunteers/${paul.id}`, {
        version: paul.version,
        registerData: { ...registerData, fiscalCode: 'PNDPLA70C01A952Z' },
      }),
    );
    await ok(
      await post('/volunteer-register/entries', { engagementId: paul.id, entryType: 'admission' }),
      201,
    );
    expect((await post('/register-snapshots', { cutoffDate: '2099-01-01' })).statusCode).toBe(409);
    snapshot = await ok(await post('/register-snapshots', { cutoffDate: today }), 201);
    expect(snapshot.snapshotNumber).toBe(1);
    expect(snapshot.status).toBe('signature_pending');
    expect([snapshot.mainCount, snapshot.occasionalCount]).toEqual([2, 1]);
    const file = await get(`/register-snapshots/${snapshot.id}/files/snapshot`);
    expect(file.statusCode).toBe(200);
    pdf = file.rawPayload;
    expect(sha256(pdf)).toBe(snapshot.sha256);
    const document = await ok<DocumentDetail>(await get(`/documents/${snapshot.documentId}`));
    expect(document.latestVersion!.sha256).toBe(snapshot.sha256);
    expect(document.category).toBe('register');
    expect(await ok(await get(`/register-snapshots/${snapshot.id}/integrity`))).toMatchObject({
      reproducible: true,
      archivedFileIntact: true,
    });
    // Later entries never alter an archived state.
    await ok(
      await post('/volunteers', {
        person: { firstName: 'Nora', lastName: 'Neu' },
        volunteerType: 'regular',
        startedOn: today,
        registerData: { ...registerData, fiscalCode: 'NEUNRO95D41A952W' },
      }),
      201,
    );
    expect(await ok(await get(`/register-snapshots/${snapshot.id}/integrity`))).toMatchObject({
      reproducible: true,
    });
    await rejected(
      sql`update volunteer_register_snapshots set sha256=${'0'.repeat(64)}, version=version+1 where id=${snapshot.id}`,
    );
    await rejected(sql`delete from volunteer_register_snapshots where id=${snapshot.id}`);
    const versionUpload = await upload(
      `/documents/${snapshot.documentId}/versions`,
      admin,
      { filename: 'x.pdf' },
      Buffer.from('%PDF-1.4\n%%EOF'),
    );
    expect(versionUpload.statusCode).toBe(422);
    const reserved = await upload(
      '/documents',
      admin,
      { title: 'Fake', category: 'register', filename: 'f.pdf' },
      Buffer.from('%PDF-1.4\n%%EOF'),
    );
    expect(reserved.json().error.code).toBe('REGISTER_DOCUMENT_RESERVED');
  });
  it('7+8: archives signature files securely and never reports unsigned states as complete', async () => {
    expect(snapshot.legallyApproved).toBe(false);
    expect(JSON.stringify(snapshot)).not.toMatch(/certif/i);
    const verifyEarly = await post(`/register-snapshots/${snapshot.id}/verification`, {
      version: snapshot.version,
      result: 'verified',
      tool: 'DSS',
    });
    expect(verifyEarly.json().error.code).toBe('SIGNATURE_MISSING');
    const disguised = await upload(
      `/register-snapshots/${snapshot.id}/signature-files`,
      admin,
      { kind: 'signed', filename: 's.p7m' },
      Buffer.from('not a signature'),
      'application/pkcs7-mime',
    );
    expect(disguised.statusCode).toBe(415);
    expect(
      (
        await upload(
          `/register-snapshots/${snapshot.id}/signature-files`,
          treasurer,
          { kind: 'signed', filename: 's.pdf' },
          pdf,
        )
      ).statusCode,
    ).toBe(403);
    const signed = Buffer.concat([
      pdf,
      Buffer.from(
        '\n1 0 obj << /Type /Sig /ByteRange [0 1 2 3] /SubFilter /ETSI.CAdES.detached >> endobj\n%%EOF\n',
      ),
    ]);
    const imported = await ok<RegisterSnapshot>(
      await upload(
        `/register-snapshots/${snapshot.id}/signature-files`,
        admin,
        { kind: 'signed', filename: 'register-signed.pdf' },
        signed,
      ),
      201,
    );
    expect(imported.status).toBe('signature_imported');
    expect(imported.technicalChecks.signed).toMatchObject({
      signatureDictionary: true,
      preservesSnapshot: true,
      sha256: sha256(signed),
    });
    const stored = await get(`/register-snapshots/${snapshot.id}/files/signed`);
    expect(sha256(stored.rawPayload)).toBe(sha256(signed));
    const token = Buffer.concat([
      Buffer.from([0x30, 0x82, 0x01, 0x00]),
      Buffer.alloc(40),
      createHash('sha256').update(signed).digest(),
      Buffer.alloc(40),
    ]);
    const stamped = await ok<RegisterSnapshot>(
      await upload(
        `/register-snapshots/${snapshot.id}/signature-files`,
        admin,
        { kind: 'timestamp', filename: 'register.tsr' },
        token,
        'application/timestamp-reply',
      ),
      201,
    );
    expect(stamped.technicalChecks.timestamp).toMatchObject({ imprintMatches: true });
    expect(
      (
        await upload(
          `/register-snapshots/${snapshot.id}/signature-files`,
          admin,
          { kind: 'signed', filename: 'again.pdf' },
          signed,
        )
      ).statusCode,
    ).toBe(409);
    // Register files stay invisible to roles without register access, also via the general archive.
    const treasurerDocs = await ok<{ items: DocumentDetail[] }>(await get('/documents', treasurer));
    expect(treasurerDocs.items.some((d) => d.category === 'register')).toBe(false);
    expect(
      (await get(`/register-snapshots/${snapshot.id}/files/signed`, treasurer)).statusCode,
    ).toBe(403);
    expect((await get(`/register-snapshots/${snapshot.id}/files/signed`, foreign)).statusCode).toBe(
      404,
    );
    const verified = await ok<RegisterSnapshot>(
      await post(`/register-snapshots/${snapshot.id}/verification`, {
        version: stamped.version,
        result: 'verified',
        tool: 'EU DSS Demonstration WebApp',
        signer: 'Vorstand',
        timestampTime: new Date().toISOString(),
      }),
    );
    expect(verified.status).toBe('verified');
    expect(verified.legallyApproved).toBe(false);
    await rejected(
      sql`update volunteer_register_snapshots set status='signature_imported', version=version+1 where id=${snapshot.id}`,
    );
    // Nora joined after the first snapshot; her admission is pending until it is recorded.
    expect(
      (await post('/register-snapshots', { cutoffDate: today }, board)).json().error.code,
    ).toBe('REGISTER_NOT_READY');
    const nora = (await ok<{ items: VolunteerSummary[] }>(await get('/volunteers?search=Neu')))
      .items[0]!;
    await ok(
      await post(
        '/volunteer-register/entries',
        { engagementId: nora.id, entryType: 'admission' },
        board,
      ),
      201,
    );
    const second = await ok<RegisterSnapshot>(
      await post('/register-snapshots', { cutoffDate: today }, board),
      201,
    );
    expect([second.snapshotNumber, second.previousSnapshotId, second.previousSha256]).toEqual([
      2,
      snapshot.id,
      snapshot.sha256,
    ]);
    expect(second.status).toBe('signature_pending');
  });
});

describe('insurance', () => {
  let liabilityOnly: InsurancePolicy;
  it('9+10: checks insurance periods indicatively and exposes coverage gaps', async () => {
    const none = await ok<{ items: { engagementId: string; status: string }[] }>(
      await get('/insurance-coverage'),
    );
    expect(none.items.find((i) => i.engagementId === regular.id)!.status).toBe('none');
    policy = await ok(
      await post('/insurance-policies', {
        insurer: 'Assicurazioni Alto Adige',
        policyNumber: 'VOL-2026-1',
        coverageTypes: ['accident', 'illness', 'liability'],
        startsOn: '2026-01-01',
        endsOn: '2026-12-31',
        insuredGroup: 'all',
      }),
      201,
    );
    expect(policy.retainUntil > '2036-12-30').toBe(true);
    expect(
      (
        await post(`/insurance-policies/${policy.id}/coverages`, {
          engagementIds: [regular.id],
          coveredFrom: '2025-12-01',
        })
      ).json().error.code,
    ).toBe('COVERAGE_OUTSIDE_POLICY');
    await ok(
      await post(`/insurance-policies/${policy.id}/coverages`, {
        engagementIds: [regular.id, occasional.id],
        coveredFrom: '2026-01-10',
      }),
      201,
    );
    expect(
      (
        await post(`/insurance-policies/${policy.id}/coverages`, {
          engagementIds: [regular.id],
          coveredFrom: '2026-02-01',
        })
      ).statusCode,
    ).toBe(409);
    let detail = await ok<VolunteerDetail>(await get(`/volunteers/${regular.id}`));
    expect(detail.coverage.status).toBe('assigned');
    expect(detail.coverage.reasons).toEqual(
      expect.arrayContaining(['coveragePolicyDocumentMissing', 'coverageNotNotified']),
    );
    await ok(
      await upload(
        '/documents',
        admin,
        {
          title: 'Police 2026',
          category: 'insurance',
          insurancePolicyId: policy.id,
          filename: 'police.pdf',
        },
        Buffer.from('%PDF-1.4\npolicy\n%%EOF'),
      ),
      201,
    );
    const list = await ok<{
      sha256: string;
      people: { engagementId: string; fiscalCode: string }[];
    }>(await get(`/insurance-policies/${policy.id}/notification-list`));
    expect(list.people.map((p) => p.engagementId).sort()).toEqual(
      [regular.id, occasional.id].sort(),
    );
    const csv = await get(
      `/insurance-policies/${policy.id}/notification-list?format=csv&language=it`,
    );
    expect(csv.body).toContain('Codice fiscale');
    expect(csv.body).toContain(list.sha256);
    await ok(
      await post('/insurer-notifications', {
        policyId: policy.id,
        notifiedOn: today,
        method: 'PEC',
        engagementIds: [regular.id, occasional.id],
        listSha256: list.sha256,
      }),
      201,
    );
    detail = await ok<VolunteerDetail>(await get(`/volunteers/${regular.id}`));
    expect(detail.coverage.status).toBe('possibly_covered');
    const counted = await ok<InsurancePolicy>(await get(`/insurance-policies/${policy.id}`));
    expect([counted.coverageCount, counted.documentCount, counted.lastNotifiedOn]).toEqual([
      2,
      1,
      today,
    ]);
    const people = await ok<{
      items: { id: string; isMember: boolean; hasOpenEngagement: boolean }[];
    }>(await get('/volunteer-people?search=Mitglied'));
    expect(people.items).toEqual([
      expect.objectContaining({ id: memberPersonId, isMember: true, hasOpenEngagement: true }),
    ]);
    const future = await ok<{
      items: { engagementId: string; status: string; gaps: { type: string; from: string }[] }[];
    }>(await get('/insurance-coverage?date=2027-02-01'));
    const later = future.items.find((i) => i.engagementId === regular.id)!;
    expect(later.status).toBe('unclear');
    expect(later.gaps).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'accident', from: '2027-01-01' })]),
    );
    // A policy covering only liability leaves accident and illness open.
    const nora = (await ok<{ items: VolunteerSummary[] }>(await get('/volunteers?search=Neu')))
      .items[0]!;
    liabilityOnly = await ok(
      await post('/insurance-policies', {
        insurer: 'Haftpflicht AG',
        policyNumber: 'HP-1',
        coverageTypes: ['liability'],
        startsOn: '2026-01-01',
        endsOn: '2026-12-31',
      }),
      201,
    );
    await ok(
      await post(`/insurance-policies/${liabilityOnly.id}/coverages`, {
        engagementIds: [nora.id],
        coveredFrom: today,
      }),
      201,
    );
    const gap = await ok<VolunteerDetail>(await get(`/volunteers/${nora.id}`));
    expect(gap.coverage.status).toBe('unclear');
    expect(gap.coverage.reasons).toContain('coverageTypeMissing');
    expect(new Set(gap.coverage.gaps.map((g) => g.type))).toEqual(new Set(['accident', 'illness']));
    const overview = await ok<{ expiring: InsurancePolicy[] }>(
      await get('/insurance-coverage?date=2026-11-15'),
    );
    expect(overview.expiring.map((p) => p.id)).toEqual(expect.arrayContaining([policy.id]));
  });
  it('11: protects insurance documents', async () => {
    const docs = await ok<{ items: DocumentDetail[] }>(
      await get(`/documents?insurancePolicyId=${policy.id}`),
    );
    const doc = docs.items[0]!;
    expect(doc.protected).toBe(true);
    const content = `/documents/${doc.id}/versions/${doc.latestVersion!.id}/content`;
    expect((await get(content)).statusCode).toBe(200);
    expect((await get(content, board)).statusCode).toBe(200);
    expect((await get(`/documents/${doc.id}`, treasurer)).statusCode).toBe(200);
    expect((await get(content, treasurer)).statusCode).toBe(403);
    expect((await get(`/documents/${doc.id}`, lead)).statusCode).toBe(403);
    expect((await get(content, member)).statusCode).toBe(403);
    expect((await get(content, foreign)).statusCode).toBe(404);
    expect(
      (await get(`/insurance-policies/${policy.id}/notification-list`, treasurer)).statusCode,
    ).toBe(403);
  });
});

describe('assignments and hours', () => {
  let event: EventOccurrence, assignment: VolunteerAssignment;
  it('12: sums confirmed hours only and prevents duplicate or overlapping entries', async () => {
    const draft = await ok<VolunteerTimeEntry>(
      await post('/volunteer-time-entries', {
        engagementId: regular.id,
        actualStart: '2026-05-02T07:00:00.000Z',
        actualEnd: '2026-05-02T10:00:00.000Z',
        breakMinutes: 30,
        project: 'Moorpflege',
        submit: true,
      }),
      201,
    );
    expect(draft.minutes).toBe(150);
    const overlap = await post('/volunteer-time-entries', {
      engagementId: regular.id,
      actualStart: '2026-05-02T09:00:00.000Z',
      actualEnd: '2026-05-02T11:00:00.000Z',
    });
    expect(overlap.json().error.code).toBe('TIME_OVERLAP');
    await rejected(
      sql`insert into volunteer_time_entries (organization_id, engagement_id, actual_start, actual_end, minutes, created_by) select organization_id, id, '2026-05-02T08:00Z', '2026-05-02T09:00Z', 60, created_by from volunteer_engagements where id=${regular.id}`,
    );
    const second = await ok<VolunteerTimeEntry>(
      await post('/volunteer-time-entries', {
        engagementId: regular.id,
        actualStart: '2026-05-03T07:00:00.000Z',
        actualEnd: '2026-05-03T08:30:00.000Z',
      }),
      201,
    );
    const open = await ok<VolunteerTimeEntry>(
      await post('/volunteer-time-entries', {
        engagementId: regular.id,
        actualStart: '2026-05-04T07:00:00.000Z',
        actualEnd: '2026-05-04T08:00:00.000Z',
      }),
      201,
    );
    expect(
      (
        await post(
          `/volunteer-time-entries/${draft.id}/decision`,
          { version: draft.version, decision: 'confirm' },
          treasurer,
        )
      ).statusCode,
    ).toBe(403);
    await ok(
      await post(`/volunteer-time-entries/${draft.id}/decision`, {
        version: draft.version,
        decision: 'confirm',
      }),
    );
    await ok(
      await post(
        `/volunteer-time-entries/${second.id}/decision`,
        { version: second.version, decision: 'confirm' },
        board,
      ),
    );
    const totals = await ok<{ totals: { confirmedMinutes: number; pendingMinutes: number } }>(
      await get(`/volunteer-time-entries?engagementId=${regular.id}`),
    );
    expect(totals.totals).toMatchObject({ confirmedMinutes: 240, pendingMinutes: 60 });
    expect(
      (await ok<VolunteerDetail>(await get(`/volunteers/${regular.id}`))).confirmedMinutes,
    ).toBe(240);
    // Corrections keep the previous values and need a new confirmation.
    const confirmed = await ok<VolunteerTimeEntry>(
      await get(`/volunteer-time-entries/${second.id}`),
    );
    const corrected = await ok<VolunteerTimeEntry>(
      await post(`/volunteer-time-entries/${second.id}/correction`, {
        version: confirmed.version,
        breakMinutes: 30,
        reason: 'Pause nachgetragen',
      }),
    );
    expect([corrected.minutes, corrected.status]).toEqual([60, 'submitted']);
    expect(corrected.history.at(-1)).toMatchObject({
      action: 'correction',
      reason: 'Pause nachgetragen',
      previous: { minutes: 90, status: 'confirmed' },
    });
    await rejected(
      sql`update volunteer_time_entries set minutes=1, version=version+1 where id=${second.id}`,
    );
    const totalsAfter = await ok<{ totals: { confirmedMinutes: number } }>(
      await get(`/volunteer-time-entries?engagementId=${regular.id}`),
    );
    expect(totalsAfter.totals.confirmedMinutes).toBe(150);
    expect(
      (
        await post(`/volunteer-time-entries/${open.id}/decision`, {
          version: open.version,
          decision: 'reject',
        })
      ).statusCode,
    ).toBe(422);
    const csv = await get(`/volunteer-time-entries/export?format=csv&engagementId=${regular.id}`);
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain('Summe bestätigter Stunden');
    expect(csv.body).toContain('2:30');
    const pdf = await get(
      `/volunteer-time-entries/export?format=pdf&language=it&engagementId=${regular.id}`,
    );
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });
  it('13: attendance creates only an unconfirmed draft, never counted hours', async () => {
    const eventDay = new Date(
      Math.min(Date.now() + 2 * 86_400_000, Date.parse('2026-12-30T12:00:00Z')),
    )
      .toISOString()
      .slice(0, 10);
    const [category] = (
      await ok<{ items: EventCategory[] }>(await post('/event-categories/initialize', {}))
    ).items;
    event = await ok(
      await post('/events', {
        titleI18n: { de: 'Heckenpflege', it: 'Cura delle siepi' },
        descriptionI18n: { de: '', it: '' },
        categoryId: category!.id,
        startLocal: `${eventDay}T09:00`,
        endLocal: `${eventDay}T12:00`,
        timezone: 'Europe/Rome',
        status: 'published',
        visibility: 'members',
        organizerId: leadId,
      }),
      201,
    );
    const registration = await ok<EventRegistration>(
      await post(`/events/${event.id}/registrations`, { personId: memberPersonId }),
      201,
    );
    assignment = await ok(
      await post(
        '/volunteer-assignments',
        {
          engagementId: regular.id,
          eventOccurrenceId: event.id,
          role: 'lead',
          task: 'Gruppe anleiten',
          plannedStart: `${eventDay}T08:00:00.000Z`,
          plannedEnd: `${eventDay}T11:00:00.000Z`,
          responsibleUserId: leadId,
          project: 'Hecken',
        },
        lead,
      ),
      201,
    );
    expect(assignment.coverageStatus).toBe('possibly_covered');
    const duplicate = await post('/volunteer-assignments', {
      engagementId: regular.id,
      eventOccurrenceId: event.id,
      task: 'Doppelt',
      plannedStart: `${eventDay}T12:00:00.000Z`,
      plannedEnd: `${eventDay}T13:00:00.000Z`,
    });
    expect(duplicate.json().error.code).toBe('ASSIGNMENT_EXISTS');
    expect(
      (await post(`/volunteer-assignments/${assignment.id}/attendance-draft`, {}, lead)).json()
        .error.code,
    ).toBe('ATTENDANCE_NOT_PRESENT');
    const sync = await ok<{ results: { status: string }[] }>(
      await post(
        '/attendance/sync',
        {
          operations: [
            {
              operationId: crypto.randomUUID(),
              organizationId: org,
              eventOccurrenceId: event.id,
              registrationId: registration.id,
              requestedStatus: 'present',
              expectedVersion: 0,
              clientCreatedAt: new Date().toISOString(),
            },
          ],
        },
        lead,
      ),
    );
    expect(sync.results[0]!.status).toBe('applied');
    const before = (await ok<VolunteerDetail>(await get(`/volunteers/${regular.id}`)))
      .confirmedMinutes;
    const draft = await ok<VolunteerTimeEntry>(
      await post(`/volunteer-assignments/${assignment.id}/attendance-draft`, {}, lead),
      201,
    );
    expect([draft.status, draft.source, draft.minutes]).toEqual(['draft', 'attendance', 180]);
    expect(
      (await ok<VolunteerDetail>(await get(`/volunteers/${regular.id}`))).confirmedMinutes,
    ).toBe(before);
    expect(
      (await post(`/volunteer-assignments/${assignment.id}/attendance-draft`, {}, lead)).json()
        .error.code,
    ).toBe('TIME_DRAFT_EXISTS');
    const detail = await ok<VolunteerDetail>(await get(`/volunteers/${regular.id}`));
    expect(detail.events.map((e) => e.relation).sort()).toEqual(['assignment', 'registration']);
    // Project leads confirm hours of their own events, but never their own hours.
    const [mine] = await db.select().from(s.user).where(eq(s.user.email, 'vol-lead@example.test'));
    await db
      .insert(s.personUserLinks)
      .values({ organizationId: org, userId: mine!.id, personId: memberPersonId });
    const self = await post(
      `/volunteer-time-entries/${draft.id}/decision`,
      { version: draft.version, decision: 'confirm' },
      lead,
    );
    expect(self.json().error.code).toBe('TIME_SELF_CONFIRM');
    await db.delete(s.personUserLinks).where(eq(s.personUserLinks.userId, mine!.id));
    const confirmed = await ok<VolunteerTimeEntry>(
      await post(
        `/volunteer-time-entries/${draft.id}/decision`,
        { version: draft.version, decision: 'confirm' },
        lead,
      ),
    );
    expect(confirmed.status).toBe('confirmed');
    expect(
      (await ok<VolunteerDetail>(await get(`/volunteers/${regular.id}`))).confirmedMinutes,
    ).toBe(before + 180);
    const unscoped = await post(
      '/volunteer-assignments',
      {
        engagementId: regular.id,
        task: 'Ohne Veranstaltung',
        plannedStart: '2026-12-01T08:00:00.000Z',
        plannedEnd: '2026-12-01T09:00:00.000Z',
      },
      lead,
    );
    expect(unscoped.statusCode).toBe(403);
  });
});

describe('authorization and tenancy', () => {
  it('14: blocks unauthorized changes of register and insurance data', async () => {
    expect(
      (
        await post(
          '/volunteer-register/entries',
          { engagementId: regular.id, entryType: 'exit' },
          treasurer,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post(
          '/volunteer-register/entries',
          { engagementId: regular.id, entryType: 'exit' },
          lead,
        )
      ).statusCode,
    ).toBe(403);
    expect((await post('/register-snapshots', { cutoffDate: today }, lead)).statusCode).toBe(403);
    expect((await get('/volunteer-register', lead)).statusCode).toBe(403);
    expect((await get('/volunteer-register', treasurer)).statusCode).toBe(403);
    expect(
      (
        await post(
          '/insurance-policies',
          {
            insurer: 'X',
            policyNumber: '1',
            coverageTypes: ['accident'],
            startsOn: '2026-01-01',
            endsOn: '2026-12-31',
          },
          treasurer,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await patch(
          `/insurance-policies/${policy.id}`,
          { version: policy.version, notes: 'x' },
          lead,
        )
      ).statusCode,
    ).toBe(403);
    expect((await get('/volunteers', member)).statusCode).toBe(403);
    expect(
      (
        await post(
          '/volunteers',
          { person: { firstName: 'X', lastName: 'Y' }, volunteerType: 'regular', startedOn: today },
          lead,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await patch(
          '/volunteer-register/settings',
          { version: 0, legalApprovedOn: today, legalApprovalReference: 'Gutachten' },
          board,
        )
      ).statusCode,
    ).toBe(403);
    expect((await get('/compliance-deadlines', member)).statusCode).toBe(403);
    expect((await post('/compliance-rules/initialize', {}, treasurer)).statusCode).toBe(403);
  });
  it('15: keeps all volunteer data inside the organization', async () => {
    expect((await get(`/volunteers/${regular.id}`, foreign)).statusCode).toBe(404);
    expect((await get(`/insurance-policies/${policy.id}`, foreign)).statusCode).toBe(404);
    expect((await ok<{ items: unknown[] }>(await get('/volunteers', foreign))).items).toEqual([]);
    expect(
      (await ok<{ entries: unknown[] }>(await get('/volunteer-register', foreign))).entries,
    ).toEqual([]);
    expect(
      (await ok<{ items: unknown[] }>(await get('/register-snapshots', foreign))).items,
    ).toEqual([]);
    expect(
      (await ok<{ items: unknown[] }>(await get('/volunteer-time-entries', foreign))).items,
    ).toEqual([]);
    const foreignPolicy = await ok<InsurancePolicy>(
      await post(
        '/insurance-policies',
        {
          insurer: 'F',
          policyNumber: 'F-1',
          coverageTypes: ['accident'],
          startsOn: '2026-01-01',
          endsOn: '2026-12-31',
        },
        foreign,
      ),
      201,
    );
    expect(
      (
        await post(
          `/insurance-policies/${foreignPolicy.id}/coverages`,
          { engagementIds: [regular.id], coveredFrom: '2026-02-01' },
          foreign,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await post(
          '/volunteer-register/entries',
          { engagementId: regular.id, entryType: 'exit' },
          foreign,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await post(
          '/volunteer-time-entries',
          {
            engagementId: regular.id,
            actualStart: '2026-06-01T08:00:00Z',
            actualEnd: '2026-06-01T09:00:00Z',
          },
          foreign,
        )
      ).statusCode,
    ).toBe(404);
  });
});

describe('compliance', () => {
  it('16: calculates deadlines from versioned rules', async () => {
    const rules = await ok<{ items: ComplianceRule[] }>(
      await post('/compliance-rules/initialize', {}),
    );
    expect(rules.items.length).toBe(7);
    expect(rules.items.every((r) => r.reviewNote.length > 0)).toBe(true);
    const [adminUser] = await db
      .select()
      .from(s.user)
      .where(eq(s.user.email, 'vol-admin@example.test'));
    await db.insert(s.fiscalYears).values({
      organizationId: org,
      year: 2025,
      startsOn: '2025-01-01',
      endsOn: '2025-12-31',
      openedBy: adminUser!.id,
    });
    await db.insert(s.fiscalYears).values({
      organizationId: org,
      year: 2026,
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
      openedBy: adminUser!.id,
    });
    await ok(
      await post('/board-mandates', {
        personId: memberPersonId,
        position: 'Präsidentin',
        startDate: '2026-03-01',
        endDate: '2027-02-28',
      }),
      201,
    );
    const generated = await ok<{ created: number }>(
      await post('/compliance-deadlines/generate', { from: '2026-01-01', to: '2027-12-31' }),
    );
    expect(generated.created).toBeGreaterThan(0);
    const again = await ok<{ created: number; existing: number }>(
      await post('/compliance-deadlines/generate', { from: '2026-01-01', to: '2027-12-31' }),
    );
    expect(again).toEqual({ created: 0, existing: generated.created });
    const all = (
      await ok<{ items: ComplianceDeadline[] }>(await get('/compliance-deadlines?pageSize=100'))
    ).items;
    const due = (key: string) =>
      all
        .filter((d) => d.titleI18n.de === key)
        .map((d) => d.dueDate)
        .sort();
    expect(due('RUNTS: Hinterlegung Jahresabschluss')).toEqual(['2026-06-29', '2027-06-29']);
    expect(due('RUNTS: Vereinsdaten aktualisieren')).toEqual(['2026-06-30', '2027-06-30']);
    expect(due('RUNTS: Änderung der Organe melden')).toEqual(['2026-03-31', '2027-03-30']);
    expect(due('Ablauf einer Vorstandsfunktion vorbereiten')).toEqual(['2026-12-30']);
    expect(due('Freiwilligenversicherung: Laufzeitende')).toEqual(['2026-12-31', '2026-12-31']);
    const snapshotDue = all.find((d) => d.topic === 'register_snapshot')!;
    expect(snapshotDue.dueDate).toBe(
      new Date(Date.parse(`${today}T00:00:00Z`) + 365 * 86400000).toISOString().slice(0, 10),
    );
    const legal = all.find((d) => d.titleI18n.de === 'RUNTS: Hinterlegung Jahresabschluss')!;
    expect([legal.kind, legal.ruleVersion, legal.legalBasis]).toEqual([
      'legal',
      1,
      expect.stringContaining('Art. 48'),
    ]);
    // A new rule version closes the old one and leaves generated deadlines untouched.
    const current = rules.items.find((r) => r.ruleKey === 'runts_annual_report')!;
    const v2 = await ok<ComplianceRule>(
      await post('/compliance-rules', {
        ruleKey: current.ruleKey,
        kind: 'legal',
        topic: current.topic,
        titleI18n: current.titleI18n,
        descriptionI18n: current.descriptionI18n,
        legalBasis: current.legalBasis,
        responsibleRole: 'board',
        calculation: { basis: 'fiscal_year_end', offsetDays: 120 },
        validFrom: '2028-01-01',
      }),
      201,
    );
    expect(v2.version).toBe(2);
    const versions = (
      await ok<{ items: ComplianceRule[] }>(await get('/compliance-rules'))
    ).items.filter((r) => r.ruleKey === current.ruleKey);
    expect(versions.find((r) => r.version === 1)!.validTo).toBe('2027-12-31');
    await rejected(
      sql`update compliance_rules set calculation='{"basis":"manual","offsetDays":0}' where id=${current.id}`,
    );
    const unchanged = (
      await ok<{ items: ComplianceDeadline[] }>(await get('/compliance-deadlines?pageSize=100'))
    ).items.find((d) => d.id === legal.id)!;
    expect(unchanged.dueDate).toBe('2026-06-29');
    expect(
      (
        await post('/compliance-deadlines', {
          kind: 'legal',
          titleI18n: { de: 'X', it: 'X' },
          dueDate: '2027-01-01',
        })
      ).json().error.code,
    ).toBe('LEGAL_BASIS_REQUIRED');
  });
  it('17: requires documented evidence for completed deadlines', async () => {
    const custom = await ok<ComplianceDeadline>(
      await post('/compliance-deadlines', {
        kind: 'internal',
        titleI18n: { de: 'Mitgliederversammlung einberufen', it: 'Convocare l’assemblea' },
        dueDate: new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10),
        responsibleRole: 'board',
      }),
      201,
    );
    expect(custom.nextReminder).not.toBeNull();
    const missing = await post(`/compliance-deadlines/${custom.id}/complete`, {
      version: custom.version,
      completedOn: today,
    });
    expect(missing.json().error.code).toBe('EVIDENCE_REQUIRED');
    const [adminUser] = await db
      .select()
      .from(s.user)
      .where(eq(s.user.email, 'vol-admin@example.test'));
    await rejected(
      sql`update compliance_deadlines set status='done', completed_on=${today}, completed_by=${adminUser!.id}, version=version+1 where id=${custom.id}`,
    );
    const doc = await ok<DocumentDetail>(
      await upload(
        '/documents',
        admin,
        {
          title: 'Einladung',
          category: 'minutes',
          complianceDeadlineId: custom.id,
          filename: 'einladung.pdf',
        },
        Buffer.from('%PDF-1.4\ninvite\n%%EOF'),
      ),
      201,
    );
    const withEvidence = await ok<ComplianceDeadline>(
      await post(`/compliance-deadlines/${custom.id}/evidence`, {
        documentId: doc.id,
        description: 'Einladung versendet',
      }),
      201,
    );
    const done = await ok<ComplianceDeadline>(
      await post(`/compliance-deadlines/${custom.id}/complete`, {
        version: withEvidence.version,
        completedOn: today,
        protocolNumber: 'PROT-2026-17',
      }),
    );
    expect([done.status, done.protocolNumber, done.evidence.length]).toEqual([
      'done',
      'PROT-2026-17',
      1,
    ]);
    expect(done.history.map((h) => h.action)).toEqual(['create', 'evidence', 'complete']);
    expect(
      (await patch(`/compliance-deadlines/${custom.id}`, { version: done.version, status: 'open' }))
        .statusCode,
    ).toBe(409);
    await rejected(sql`delete from compliance_evidence where deadline_id=${custom.id}`);
    expect((await get(`/documents/${doc.id}`, member)).statusCode).toBe(403);
  });
  it('18: leaves events, finance and documents working', async () => {
    expect((await get('/events')).statusCode).toBe(200);
    expect((await get('/documents')).statusCode).toBe(200);
    expect((await get('/finance/fee-plans')).statusCode).not.toBe(500);
    expect(await db.select().from(s.cashbookEntries)).toEqual([]);
    expect(await db.select().from(s.payments)).toEqual([]);
    const overview = await ok<{
      activeRegular: number;
      openLegalDeadlines: number;
      lastSnapshot: { snapshotNumber: number };
    }>(await get('/volunteers/overview'));
    expect(overview.activeRegular).toBe(3);
    expect(overview.lastSnapshot.snapshotNumber).toBe(2);
    expect(overview.openLegalDeadlines).toBeGreaterThan(0);
    const leadOverview = await ok<{ unclearCoverage: number | null; lastSnapshot: unknown }>(
      await get('/volunteers/overview', lead),
    );
    expect([leadOverview.unclearCoverage, leadOverview.lastSnapshot]).toEqual([null, null]);
  });
  it('accepts a completion on the organization-local date after UTC midnight differs', async () => {
    const instant = new Date();
    instant.setUTCHours(23, 30, 0, 0);
    const completedOn = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(
      instant,
    );
    const deadline = await ok<ComplianceDeadline>(
      await post('/compliance-deadlines', {
        kind: 'internal',
        titleI18n: { de: 'Mitternacht', it: 'Mezzanotte' },
        dueDate: completedOn,
      }),
      201,
    );
    const evidence = await ok<ComplianceDeadline>(
      await post(`/compliance-deadlines/${deadline.id}/evidence`, {
        reference: 'Local-midnight regression',
        description: 'Documented completion',
      }),
      201,
    );
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(instant);
    try {
      const done = await ok<ComplianceDeadline>(
        await post(`/compliance-deadlines/${deadline.id}/complete`, {
          version: evidence.version,
          completedOn,
        }),
      );
      expect(done.completedOn).toBe(completedOn);
      expect(done.status).toBe('done');
    } finally {
      vi.useRealTimers();
    }
  });
});
describe('volunteer self-service', () => {
  // A separate client address, so this block does not share the file's rate-limit budget.
  const remoteAddress = '198.51.100.7';
  const get = (path: string, cookie = admin) =>
    app.inject({ url: `/api/v1${path}`, headers: headers(cookie), remoteAddress });
  const post = (path: string, payload: unknown, cookie = admin) =>
    app.inject({
      method: 'POST',
      url: `/api/v1${path}`,
      headers: headers(cookie, crypto.randomUUID()),
      payload: payload as Record<string, unknown>,
      remoteAddress,
    });
  it('shows only the own engagement and accepts own hours for confirmation', async () => {
    const [account] = await db
      .select()
      .from(s.user)
      .where(eq(s.user.email, 'vol-member@example.test'));
    expect(
      (await ok<{ engagements: unknown[] }>(await get('/me/volunteering', member))).engagements,
    ).toEqual([]);
    await db
      .insert(s.personUserLinks)
      .values({ organizationId: org, userId: account!.id, personId: memberPersonId });
    try {
      const own = await ok<{
        engagements: { id: string }[];
        timeEntries: { id: string; status: string }[];
        pendingMinutes: number;
        confirmedMinutesThisYear: number;
      }>(await get('/me/volunteering', member));
      expect(own.engagements.map((e) => e.id)).toContain(regular.id);
      expect(own.engagements.map((e) => e.id)).not.toContain(occasional.id);
      const body = {
        engagementId: regular.id,
        actualStart: '2026-10-20T07:00:00.000Z',
        actualEnd: '2026-10-20T09:00:00.000Z',
        breakMinutes: 15,
        description: 'Hecke geschnitten',
      };
      const created = await ok<{ id: string }>(
        await post('/me/volunteering/time-entries', body, member),
        201,
      );
      const [row] = await db
        .select()
        .from(s.volunteerTimeEntries)
        .where(eq(s.volunteerTimeEntries.id, created.id));
      expect(row).toMatchObject({ status: 'submitted', minutes: 105, source: 'manual' });
      expect((await post('/me/volunteering/time-entries', body, member)).json().error.code).toBe(
        'TIME_OVERLAP',
      );
      const future = new Date(Date.now() + 86_400_000).toISOString();
      expect(
        (
          await post(
            '/me/volunteering/time-entries',
            {
              ...body,
              actualStart: future,
              actualEnd: new Date(Date.now() + 2 * 86_400_000).toISOString(),
            },
            member,
          )
        ).json().error.code,
      ).toBe('TIME_IN_FUTURE');
      expect(
        (
          await post(
            '/me/volunteering/time-entries',
            { ...body, engagementId: occasional.id },
            member,
          )
        ).statusCode,
      ).toBe(404);
      expect((await post('/me/volunteering/time-entries', body, treasurer)).statusCode).toBe(404);
      const after = await ok<typeof own>(await get('/me/volunteering', member));
      expect(after.pendingMinutes).toBeGreaterThanOrEqual(105);
      expect(after.timeEntries.find((e) => e.id === created.id)?.status).toBe('submitted');
      const confirmed = await post(
        `/volunteer-time-entries/${created.id}/decision`,
        { version: row!.version, decision: 'confirm' },
        admin,
      );
      expect(confirmed.statusCode, confirmed.body).toBe(200);
      const final = await ok<typeof own>(await get('/me/volunteering', member));
      expect(final.confirmedMinutesThisYear).toBe(after.confirmedMinutesThisYear + 105);
      // The annual overview counts exactly the confirmed minutes.
      const overview = await ok<{ volunteers: { months: { minutes: number }[] } }>(
        await get('/reports/annual-overview?year=2026', admin),
      );
      const [confirmedTotal] = await db
        .select({ n: sql<number>`coalesce(sum(${s.volunteerTimeEntries.minutes}),0)::int` })
        .from(s.volunteerTimeEntries)
        .where(
          sql`${s.volunteerTimeEntries.organizationId}=${org} and ${s.volunteerTimeEntries.status}='confirmed' and extract(year from (${s.volunteerTimeEntries.actualStart} at time zone 'Europe/Rome'))=2026`,
        );
      expect(overview.volunteers.months.reduce((n, m) => n + m.minutes, 0)).toBe(confirmedTotal!.n);
      expect(confirmedTotal!.n).toBeGreaterThan(0);
      expect((await get('/reports/annual-overview?year=2026', member)).statusCode).toBe(403);
    } finally {
      await db.delete(s.personUserLinks).where(eq(s.personUserLinks.userId, account!.id));
    }
  });
});
