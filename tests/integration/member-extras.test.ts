import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import { createDatabase, schema as s } from '../../packages/db/src';
import { createApp } from '../../apps/api/src/app';
import { bootstrap } from '../../apps/api/src/services/bootstrap';
import { readConfig } from '../../apps/api/src/plugins/config';
import type { Member, MemberExtras, MemberField } from '../../packages/contracts/src';
const config = readConfig();
if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('/bnature_test'))
  throw new Error('Dedicated test database required');
const { db, pool } = createDatabase(config.DATABASE_URL),
  app = await createApp(db, config);
const password = 'Extras-test-only-Password-2026!';
let admin = '',
  board = '',
  treasurer = '',
  member = '',
  foreignAdmin = '';
let adult: Member, child: Member, foreignMember: Member;
const headers = (cookie: string) => ({ cookie, origin: config.APP_URL });
const call = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  cookie = admin,
  payload?: Record<string, unknown>,
) =>
  app.inject({
    method,
    url: `/api/v1${path}`,
    headers: headers(cookie),
    ...(payload ? { payload } : {}),
  });
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
const extras = async (m: Member, cookie = admin) => {
  const r = await call('GET', `/members/${m.id}/extras`, cookie);
  expect(r.statusCode, r.body).toBe(200);
  return r.json<MemberExtras>();
};
const newField = async (payload: Record<string, unknown>) => {
  const r = await call('POST', '/member-fields', admin, payload);
  expect(r.statusCode, r.body).toBe(201);
  return r.json<MemberField>();
};
beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/db/migrations' });
  await db.execute(sql`truncate table organizations,users cascade`);
  await bootstrap(db, config, {
    name: 'Extras Admin',
    email: 'extras-admin@example.test',
    password,
    organizationName: 'Extras',
    slug: 'extras-a',
  });
  await bootstrap(db, config, {
    name: 'Foreign Admin',
    email: 'extras-foreign@example.test',
    password,
    organizationName: 'Foreign',
    slug: 'extras-b',
  });
  await app.ready();
  admin = await login('extras-admin@example.test');
  foreignAdmin = await login('extras-foreign@example.test');
  for (const role of ['board', 'treasurer', 'member'] as const) {
    const r = await call('POST', '/users', admin, {
      name: role,
      email: `extras-${role}@example.test`,
      password,
      role,
    });
    expect(r.statusCode, r.body).toBe(201);
  }
  board = await login('extras-board@example.test');
  treasurer = await login('extras-treasurer@example.test');
  member = await login('extras-member@example.test');
  const create = async (cookie: string, number: string, dateOfBirth: string) => {
    const r = await call('POST', '/members', cookie, {
      firstName: 'Mia',
      lastName: number,
      membershipNumber: number,
      joinedAt: '2020-01-01',
      dateOfBirth,
    });
    expect(r.statusCode, r.body).toBe(201);
    return r.json<Member>();
  };
  const year = new Date().getFullYear();
  adult = await create(admin, 'X-ADULT', '1980-05-05');
  child = await create(admin, 'X-CHILD', `${year - 10}-01-01`);
  foreignMember = await create(foreignAdmin, 'Y-001', '1990-01-01');
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('custom member fields', () => {
  it('validates definitions and values per type and keeps inactive values visible', async () => {
    const shirt = await newField({
      labelI18n: { de: 'T-Shirt-Größe', it: 'Taglia maglietta' },
      type: 'select',
      options: ['S', 'M', 'L'],
    });
    const allergy = await newField({
      labelI18n: { de: 'Allergien', it: 'Allergie' },
      type: 'text',
    });
    const vegan = await newField({ labelI18n: { de: 'Vegan', it: 'Vegano' }, type: 'boolean' });
    expect(
      (
        await call('POST', '/member-fields', admin, {
          labelI18n: { de: 'Wahl', it: 'Scelta' },
          type: 'select',
          options: ['Nur eine'],
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await call('POST', '/member-fields', treasurer, {
          labelI18n: { de: 'X', it: 'X' },
          type: 'text',
        })
      ).statusCode,
    ).toBe(403);
    const saved = await call('PUT', `/members/${adult.id}/fields`, board, {
      values: { [shirt.id]: 'M', [allergy.id]: '  Nüsse  ', [vegan.id]: true },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const values = Object.fromEntries(
      saved.json<MemberExtras>().fields.map((x) => [x.field.id, x.value]),
    );
    expect(values).toMatchObject({ [shirt.id]: 'M', [allergy.id]: 'Nüsse', [vegan.id]: true });
    for (const bad of [
      { [shirt.id]: 'XXL' },
      { [vegan.id]: 'ja' },
      { [crypto.randomUUID()]: 'x' },
    ]) {
      const r = await call('PUT', `/members/${adult.id}/fields`, admin, { values: bad });
      expect([404, 422]).toContain(r.statusCode);
    }
    // Clearing removes the stored value.
    await call('PUT', `/members/${adult.id}/fields`, admin, { values: { [allergy.id]: '' } });
    expect((await extras(adult)).fields.find((x) => x.field.id === allergy.id)?.value).toBeNull();
    // Deactivated: hidden where empty, still shown where a value exists.
    const off = await call('PATCH', `/member-fields/${shirt.id}`, admin, { active: false });
    expect(off.statusCode, off.body).toBe(200);
    expect((await extras(adult)).fields.some((x) => x.field.id === shirt.id)).toBe(true);
    expect((await extras(child)).fields.some((x) => x.field.id === shirt.id)).toBe(false);
    // The type cannot change and options stay valid.
    expect(
      (await call('PATCH', `/member-fields/${vegan.id}`, admin, { options: ['a', 'b'] }))
        .statusCode,
    ).toBe(422);
  });
  it('keeps field definitions and values within the organization', async () => {
    const [field] = (
      await call('GET', '/member-fields', admin).then((r) => r.json<{ items: MemberField[] }>())
    ).items;
    expect(
      (
        await call('PUT', `/members/${foreignMember.id}/fields`, admin, {
          values: { [field!.id]: 'x' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call('PUT', `/members/${foreignMember.id}/fields`, foreignAdmin, {
          values: { [field!.id]: 'x' },
        })
      ).statusCode,
    ).toBe(404);
    expect((await call('GET', `/members/${adult.id}/extras`, member)).statusCode).toBe(403);
    expect((await call('GET', `/members/${adult.id}/extras`, foreignAdmin)).statusCode).toBe(404);
  });
});

describe('consents and guardians', () => {
  it('records consent decisions append-only with the latest one as current state', async () => {
    const record = (payload: Record<string, unknown>, cookie = admin) =>
      call('POST', `/members/${child.id}/consents`, cookie, payload);
    expect(
      (
        await record({
          kind: 'photos',
          granted: true,
          decidedOn: '2026-01-10',
          givenBy: 'Anna Muster (Mutter)',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await record({ kind: 'photos', granted: false, decidedOn: '2026-03-01', note: 'Widerruf' }))
        .statusCode,
    ).toBe(201);
    expect(
      (await record({ kind: 'data_processing', granted: true, decidedOn: '2026-01-10' }, board))
        .statusCode,
    ).toBe(201);
    expect(
      (await record({ kind: 'photos', granted: true, decidedOn: '2999-01-01' })).json().error.code,
    ).toBe('CONSENT_FUTURE_DATE');
    expect(
      (await record({ kind: 'newsletter', granted: true, decidedOn: '2026-01-10' })).statusCode,
    ).toBe(422);
    expect(
      (await record({ kind: 'photos', granted: true, decidedOn: '2026-01-10' }, treasurer))
        .statusCode,
    ).toBe(403);
    const result = await extras(child, treasurer);
    expect(result.isMinor).toBe(true);
    expect(result.consents.photos).toMatchObject({ granted: false, note: 'Widerruf' });
    expect(result.consents.data_processing).toMatchObject({ granted: true, recordedBy: 'board' });
    expect(result.consentHistory).toHaveLength(3);
    expect((await extras(adult)).isMinor).toBe(false);
    await expect(
      db.update(s.personConsents).set({ granted: true }).where(eq(s.personConsents.kind, 'photos')),
    ).rejects.toThrow();
    await expect(db.delete(s.personConsents)).rejects.toThrow();
  });
  it('manages guardians per member with tenant isolation', async () => {
    const created = await call('POST', `/members/${child.id}/guardians`, admin, {
      name: 'Anna Muster',
      relationship: 'Mutter',
      email: 'anna@example.test',
      phone: '+39 333 000',
    });
    expect(created.statusCode, created.body).toBe(201);
    const guardian = created.json<{ id: string }>();
    expect(
      (await call('POST', `/members/${child.id}/guardians`, admin, { name: 'X', email: 'kaputt' }))
        .statusCode,
    ).toBe(422);
    const patched = await call('PATCH', `/members/${child.id}/guardians/${guardian.id}`, board, {
      phone: '+39 333 111',
    });
    expect(patched.json()).toMatchObject({ name: 'Anna Muster', phone: '+39 333 111' });
    expect(
      (await call('PATCH', `/members/${adult.id}/guardians/${guardian.id}`, admin, { phone: '1' }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call('DELETE', `/members/${foreignMember.id}/guardians/${guardian.id}`, foreignAdmin))
        .statusCode,
    ).toBe(404);
    expect((await extras(child)).guardians).toEqual([
      expect.objectContaining({ id: guardian.id, relationship: 'Mutter' }),
    ]);
    expect(
      (await call('DELETE', `/members/${child.id}/guardians/${guardian.id}`, admin)).statusCode,
    ).toBe(204);
    expect((await extras(child)).guardians).toEqual([]);
  });
});
describe('member list with consents and custom fields', () => {
  type Listed = {
    items: (Member & {
      photoConsent: string | null;
      dataConsent: string | null;
      customFields: Record<string, unknown>;
    })[];
  };
  const list = async (query = '', cookie = admin) =>
    (
      await call('GET', `/members?pageSize=100${query}`, cookie).then((r) => {
        expect(r.statusCode, r.body).toBe(200);
        return r.json<Listed>();
      })
    ).items;
  it('returns the latest consent per kind and filters by it', async () => {
    const all = await list();
    const childRow = all.find((m) => m.id === child.id)!;
    expect(childRow.photoConsent).toBe('refused');
    expect(childRow.dataConsent).toBe('granted');
    expect(all.find((m) => m.id === adult.id)!.photoConsent).toBeNull();
    const ids = async (q: string) => (await list(q)).map((m) => m.id);
    expect(await ids('&photoConsent=refused')).toEqual([child.id]);
    expect(await ids('&photoConsent=granted')).toEqual([]);
    expect(await ids('&photoConsent=missing')).toEqual([adult.id]);
    expect(await ids('&dataConsent=granted&photoConsent=refused')).toEqual([child.id]);
    expect((await call('GET', '/members?photoConsent=maybe')).statusCode).toBe(422);
    // Another club's consents never leak into this list.
    expect((await list('', foreignAdmin)).map((m) => m.id)).toEqual([foreignMember.id]);
  });
  it('includes custom field values in list and detail', async () => {
    const [field] = (
      await call('GET', '/member-fields').then((r) => r.json<{ items: MemberField[] }>())
    ).items.filter((f) => f.type === 'boolean');
    await call('PUT', `/members/${child.id}/fields`, admin, { values: { [field!.id]: true } });
    const row = (await list()).find((m) => m.id === child.id)!;
    expect(row.customFields[field!.id]).toBe(true);
    const detail = await call('GET', `/members/${child.id}`).then((r) =>
      r.json<Listed['items'][number]>(),
    );
    expect(detail.customFields[field!.id]).toBe(true);
  });
});

describe('concurrent guardian limit', () => {
  it('allows only one concurrent request for the fifth guardian', async () => {
    for (let i = 0; i < 4; i++) {
      const response = await call('POST', `/members/${adult.id}/guardians`, admin, {
        name: `Guardian ${i}`,
      });
      expect(response.statusCode, response.body).toBe(201);
    }
    const responses = await Promise.all(
      [0, 1].map((i) =>
        call('POST', `/members/${adult.id}/guardians`, admin, { name: `Concurrent ${i}` }),
      ),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect((await extras(adult)).guardians).toHaveLength(5);
  });
});
