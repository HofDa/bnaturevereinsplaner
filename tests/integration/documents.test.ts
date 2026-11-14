import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql, eq } from 'drizzle-orm';
import { createDatabase, schema as s } from '../../packages/db/src';
import { createApp } from '../../apps/api/src/app';
import { bootstrap } from '../../apps/api/src/services/bootstrap';
import { readConfig } from '../../apps/api/src/plugins/config';
import {
  encodeDocumentMetadata,
  type DocumentDetail,
  type DocumentRecord,
  type CashbookEntry,
  type FinanceAccount,
  type CashbookCategory,
  type Member,
  type Page,
} from '../../packages/contracts/src';
const storageDir = await mkdtemp(join(tmpdir(), 'bnature-documents-'));
const config = readConfig({ ...process.env, DOCUMENT_STORAGE_DIR: storageDir });
if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('/bnature_test'))
  throw new Error('Dedicated test database required');
const { db, pool } = createDatabase(config.DATABASE_URL),
  app = await createApp(db, config);
const password = 'Documents-test-only-Password-2026!';
const pdf = (text = 'Beleg') => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
let admin = '',
  treasurer = '',
  board = '',
  member = '',
  lead = '',
  foreignAdmin = '',
  org = '';
let entry: CashbookEntry, own: Member, foreignMember: Member;
const headers = (cookie: string, key?: string) => ({
  cookie,
  origin: config.APP_URL,
  ...(key ? { 'idempotency-key': key } : {}),
});
const json = (
  method: 'POST' | 'PATCH',
  path: string,
  payload: Record<string, unknown>,
  cookie = admin,
) =>
  app.inject({
    method,
    url: `/api/v1${path}`,
    headers: headers(cookie, crypto.randomUUID()),
    payload,
  });
const get = (path: string, cookie = admin) =>
  app.inject({ url: `/api/v1${path}`, headers: headers(cookie) });
function upload(
  meta: Record<string, unknown>,
  body: Buffer = pdf(),
  cookie = board,
  options: { key?: string; type?: string; path?: string } = {},
) {
  return app.inject({
    method: 'POST',
    url: `/api/v1${options.path ?? '/documents'}`,
    headers: {
      ...headers(cookie, options.key ?? crypto.randomUUID()),
      'content-type': options.type ?? 'application/pdf',
      'x-document-metadata': encodeDocumentMetadata(meta),
    },
    payload: body,
  });
}
const meta = (patch: Record<string, unknown> = {}) => ({
  title: 'Vereinsstatut',
  category: 'statute',
  filename: 'statut.pdf',
  ...patch,
});
async function ok<T>(response: Awaited<ReturnType<typeof get>>, status = 200) {
  expect(response.statusCode, response.body).toBe(status);
  return response.json<T>();
}
async function storedFiles() {
  return (await readdir(join(storageDir, org)).catch(() => [])).filter(
    (name) => !name.endsWith('.partial'),
  );
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
beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/db/migrations' });
  await db.execute(sql`truncate table organizations,users cascade`);
  const a = await bootstrap(db, config, {
    name: 'Documents Admin',
    email: 'documents-admin@example.test',
    password,
    organizationName: 'b*nature Dokumente',
    slug: 'documents-a',
  });
  await bootstrap(db, config, {
    name: 'Foreign Documents Admin',
    email: 'documents-foreign@example.test',
    password,
    organizationName: 'Fremde Dokumente',
    slug: 'documents-b',
  });
  org = a.organizationId;
  await app.ready();
  admin = await login('documents-admin@example.test');
  foreignAdmin = await login('documents-foreign@example.test');
  for (const [role, email] of [
    ['treasurer', 'treasurer@example.test'],
    ['board', 'documents-board@example.test'],
    ['member', 'documents-member@example.test'],
    ['project_lead', 'documents-lead@example.test'],
  ] as const)
    await ok(await json('POST', '/users', { name: role, email, password, role }), 201);
  treasurer = await login('treasurer@example.test');
  board = await login('documents-board@example.test');
  member = await login('documents-member@example.test');
  lead = await login('documents-lead@example.test');
  own = await ok(
    await json('POST', '/members', {
      firstName: 'Dora',
      lastName: 'Dokument',
      membershipNumber: 'D-001',
      joinedAt: '2020-01-01',
    }),
    201,
  );
  foreignMember = await ok(
    await json(
      'POST',
      '/members',
      { firstName: 'F', lastName: 'Remd', membershipNumber: 'F-001', joinedAt: '2020-01-01' },
      foreignAdmin,
    ),
    201,
  );
  const account = await ok<FinanceAccount>(
    await json('POST', '/finance/accounts', { name: 'Kasse', kind: 'cash' }),
    201,
  );
  const category = await ok<CashbookCategory>(
    await json('POST', '/finance/categories', { name: 'Porto', direction: 'expense' }),
    201,
  );
  await ok(await json('POST', '/finance/fiscal-years', { year: 2026, openingBalances: [] }), 201);
  entry = await ok(
    await json('POST', '/finance/cashbook', {
      accountId: account.id,
      categoryId: category.id,
      amountCents: 500,
      bookingDate: '2026-02-01',
      documentDate: '2026-02-01',
      description: 'Briefmarken',
    }),
    201,
  );
});
afterAll(async () => {
  await app.close();
  await pool.end();
  await rm(storageDir, { recursive: true, force: true });
});

describe('private documents', () => {
  let statute: DocumentDetail;
  it('stores an upload privately with signature check and SHA-256', async () => {
    const body = pdf('Statut 2026');
    statute = await ok(
      await upload(
        meta({ membershipId: own.id, filename: '../../Statut für Mitglieder.pdf' }),
        body,
      ),
      201,
    );
    expect(statute.versionCount).toBe(1);
    expect(statute.memberName).toBe('Dora Dokument');
    const version = statute.latestVersion!;
    expect(version.filename).not.toContain('/');
    expect(version.sha256).toBe(createHash('sha256').update(body).digest('hex'));
    const files = await storedFiles();
    expect(files).toHaveLength(1);
    expect(await readFile(join(storageDir, org, files[0]!))).toEqual(body);
    const download = await get(
      `/documents/${statute.id}/versions/${version.id}/content`,
      treasurer,
    );
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload).toEqual(body);
    expect(download.headers['content-type']).toBe('application/pdf');
    expect(download.headers['cache-control']).toBe('no-store');
    expect(download.headers['content-security-policy']).toContain('sandbox');
    expect(download.headers['content-disposition']).toContain(
      "filename*=UTF-8''.._.._Statut%20f%C3%BCr%20Mitglieder.pdf",
    );
  });
  it('rejects disguised, unsupported, empty and oversized files without storing them', async () => {
    const before = await storedFiles();
    expect((await upload(meta(), png)).json().error.code).toBe('FILE_TYPE_MISMATCH');
    expect(
      (await upload(meta(), Buffer.from('MZ executable'), board, { type: 'image/jpeg' }))
        .statusCode,
    ).toBe(415);
    expect(
      (await upload(meta(), Buffer.from('plain'), board, { type: 'text/plain' })).statusCode,
    ).toBe(415);
    expect((await upload(meta(), Buffer.alloc(0))).statusCode).toBeGreaterThanOrEqual(400);
    const huge = Buffer.concat([pdf(), Buffer.alloc(10 * 1024 * 1024)]);
    expect((await upload(meta(), huge)).statusCode).toBe(413);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/documents',
          headers: {
            ...headers(board, crypto.randomUUID()),
            'content-type': 'application/pdf',
            'x-document-metadata': 'not-json',
          },
          payload: pdf(),
        })
      ).statusCode,
    ).toBe(422);
    expect((await upload(meta({ title: '' }))).statusCode).toBe(422);
    expect(await storedFiles()).toEqual(before);
  });
  it('removes the stored file when the transaction fails or replays', async () => {
    const before = await storedFiles();
    expect((await upload(meta({ membershipId: foreignMember.id }))).statusCode).toBe(404);
    expect(await storedFiles()).toEqual(before);
    const key = crypto.randomUUID(),
      body = pdf('Protokoll');
    const [a, b] = await Promise.all([
      upload(meta({ title: 'Protokoll', category: 'minutes' }), body, board, { key }),
      upload(meta({ title: 'Protokoll', category: 'minutes' }), body, board, { key }),
    ]);
    expect(a.statusCode, a.body).toBe(201);
    expect(b.json()).toEqual(a.json());
    expect([a.headers['idempotency-replayed'], b.headers['idempotency-replayed']].sort()).toEqual([
      'false',
      'true',
    ]);
    expect(await storedFiles()).toHaveLength(before.length + 1);
    expect((await upload(meta({ title: 'Anders' }), body, board, { key })).json().error.code).toBe(
      'IDEMPOTENCY_MISMATCH',
    );
    expect(await storedFiles()).toHaveLength(before.length + 1);
  });
  it('adds immutable versions and keeps earlier versions downloadable', async () => {
    const next = await ok<DocumentDetail>(
      await upload({ filename: 'statut-v2.png' }, png, board, {
        type: 'image/png',
        path: `/documents/${statute.id}/versions`,
      }),
      201,
    );
    expect(next.versions.map((v) => v.versionNumber)).toEqual([2, 1]);
    expect(next.latestVersion?.mediaType).toBe('image/png');
    const first = next.versions[1]!;
    const download = await get(`/documents/${statute.id}/versions/${first.id}/content`, board);
    expect(download.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    statute = next;
    await expect(
      db.execute(sql`update document_versions set filename='x' where id=${first.id}`),
    ).rejects.toThrow();
    await expect(db.execute(sql`delete from documents where id=${statute.id}`)).rejects.toThrow();
  });
  it('archives documents, blocks new versions and detects stale edits', async () => {
    const archived = await ok<DocumentDetail>(
      await json(
        'PATCH',
        `/documents/${statute.id}`,
        { archived: true, version: statute.version },
        board,
      ),
    );
    expect(archived.archived).toBe(true);
    expect(
      (
        await json(
          'PATCH',
          `/documents/${statute.id}`,
          { title: 'X', version: statute.version },
          board,
        )
      ).json().error.code,
    ).toBe('STALE_VERSION');
    expect(
      (
        await upload({ filename: 'v3.pdf' }, pdf(), board, {
          path: `/documents/${statute.id}/versions`,
        })
      ).json().error.code,
    ).toBe('DOCUMENT_ARCHIVED');
    const active = await ok<Page<DocumentRecord>>(await get('/documents', board));
    expect(active.items.map((d) => d.id)).not.toContain(statute.id);
    const listed = await ok<Page<DocumentRecord>>(await get('/documents?archived=true', board));
    expect(listed.items.map((d) => d.id)).toContain(statute.id);
    const restored = await ok<DocumentDetail>(
      await json(
        'PATCH',
        `/documents/${statute.id}`,
        { archived: false, version: archived.version },
        board,
      ),
    );
    expect(restored.archived).toBe(false);
  });
  it('restricts receipts on cashbook entries to finance roles', async () => {
    expect(
      (await upload(meta({ title: 'Quittung', category: 'receipt', cashbookEntryId: entry.id })))
        .statusCode,
    ).toBe(403);
    const receipt = await ok<DocumentDetail>(
      await upload(
        meta({ title: 'Quittung', category: 'receipt', cashbookEntryId: entry.id }),
        pdf('Quittung'),
        treasurer,
      ),
      201,
    );
    expect(receipt.cashbookEntryLabel).toBe(`2026/${entry.entryNumber}`);
    const versionId = receipt.latestVersion!.id;
    expect((await get(`/documents/${receipt.id}`, board)).statusCode).toBe(404);
    expect(
      (await get(`/documents/${receipt.id}/versions/${versionId}/content`, board)).statusCode,
    ).toBe(404);
    expect(
      (await ok<Page<DocumentRecord>>(await get('/documents', board))).items.map((d) => d.id),
    ).not.toContain(receipt.id);
    const linked = await ok<Page<DocumentRecord>>(
      await get(`/documents?cashbookEntryId=${entry.id}`, treasurer),
    );
    expect(linked.items.map((d) => d.id)).toEqual([receipt.id]);
    expect(
      (
        await json(
          'PATCH',
          `/documents/${statute.id}`,
          {
            cashbookEntryId: entry.id,
            version: (await ok<DocumentDetail>(await get(`/documents/${statute.id}`, board)))
              .version,
          },
          board,
        )
      ).statusCode,
    ).toBe(403);
  });
  it('refuses members, project leads, anonymous users and foreign organizations', async () => {
    const versionId = statute.latestVersion!.id;
    for (const cookie of [member, lead]) {
      expect((await get('/documents', cookie)).statusCode).toBe(403);
      expect(
        (await get(`/documents/${statute.id}/versions/${versionId}/content`, cookie)).statusCode,
      ).toBe(403);
      expect((await upload(meta(), pdf(), cookie)).statusCode).toBe(403);
    }
    expect(
      (
        await app.inject({
          url: `/api/v1/documents/${statute.id}/versions/${versionId}/content`,
        })
      ).statusCode,
    ).toBe(401);
    expect((await get(`/documents/${statute.id}`, foreignAdmin)).statusCode).toBe(404);
    expect(
      (await get(`/documents/${statute.id}/versions/${versionId}/content`, foreignAdmin))
        .statusCode,
    ).toBe(404);
    expect((await get('/documents', foreignAdmin)).json().total).toBe(0);
    // A version ID from another document does not unlock a file either.
    const other = (await ok<Page<DocumentRecord>>(await get('/documents', board))).items.find(
      (d) => d.id !== statute.id,
    )!;
    expect(
      (await get(`/documents/${other.id}/versions/${versionId}/content`, board)).statusCode,
    ).toBe(404);
  });
  it('detects tampered storage files by hash', async () => {
    const [row] = await db
      .select({ key: s.documentVersions.storageKey, id: s.documentVersions.id })
      .from(s.documentVersions)
      .where(sql`${s.documentVersions.documentId} = ${statute.id} and version_number = 1`);
    await writeFile(join(storageDir, org, row!.key), pdf('manipuliert'));
    const response = await get(`/documents/${statute.id}/versions/${row!.id}/content`, board);
    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('DOCUMENT_STORAGE_ERROR');
  });
});

describe('document retry authorization', () => {
  it('does not replay financial metadata after finance access is lost', async () => {
    const key = crypto.randomUUID(),
      body = pdf('Private');
    const input = meta({ title: 'Private', category: 'receipt', cashbookEntryId: entry.id });
    expect((await upload(input, body, treasurer, { key })).statusCode).toBe(201);
    const [user] = await db.select().from(s.user).where(eq(s.user.email, 'treasurer@example.test'));
    expect(user).toBeDefined();
    await db
      .update(s.organizationUserRoles)
      .set({ role: 'board' })
      .where(eq(s.organizationUserRoles.userId, user!.id));
    try {
      expect((await upload(input, body, treasurer, { key })).statusCode).toBe(404);
    } finally {
      await db
        .update(s.organizationUserRoles)
        .set({ role: 'treasurer' })
        .where(eq(s.organizationUserRoles.userId, user!.id));
    }
  });
  it('rejects a retry key belonging to a different actor', async () => {
    const key = crypto.randomUUID(),
      body = pdf('Shared');
    expect((await upload(meta(), body, board, { key })).statusCode).toBe(201);
    const response = await upload(meta(), body, admin, { key });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('IDEMPOTENCY_MISMATCH');
  });
});
