import { rm } from 'node:fs/promises';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { createDatabase, schema as s } from '../packages/db/src';
import { bootstrap } from '../apps/api/src/services/bootstrap';
import { createAuth } from '../apps/api/src/auth';
import { readConfig } from '../apps/api/src/plugins/config';
const config = readConfig();
if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('/bnature_test'))
  throw new Error('Only the dedicated bnature_test database may be reset');
const { db, pool } = createDatabase(config.DATABASE_URL);
try {
  await migrate(db, { migrationsFolder: 'packages/db/migrations' });
  await db.execute(sql`truncate table organizations, users cascade`);
  // Stored files belong to the truncated rows; only the disposable test directory is cleared.
  if (config.DOCUMENT_STORAGE_DIR.startsWith('test-results/'))
    await rm(config.DOCUMENT_STORAGE_DIR, { recursive: true, force: true });
  const result = await bootstrap(db, config, {
    name: 'E2E Administrator',
    email: 'e2e@example.test',
    password: 'E2E-only-Password-2026!',
    organizationName: 'b*nature · Test',
    slug: 'bnature-e2e',
  });
  const [person] = await db
    .insert(s.persons)
    .values({
      organizationId: result.organizationId,
      firstName: 'Lena',
      lastName: 'Testperson',
      email: 'lena@example.test',
      city: 'Brixen',
    })
    .returning();
  await db.insert(s.memberships).values({
    organizationId: result.organizationId,
    personId: person!.id,
    membershipNumber: 'TEST-001',
    joinedAt: '2026-01-01',
  });
  await db.insert(s.groups).values({
    organizationId: result.organizationId,
    name: 'Lebensräume',
    description: 'Gemeinsam Lebensräume erhalten.',
  });
  const provision = createAuth(db, config, true);
  for (const [role, email] of [
    ['treasurer', 'e2e-treasurer@example.test'],
    ['member', 'e2e-member@example.test'],
    ['board', 'e2e-board@example.test'],
    ['project_lead', 'e2e-lead@example.test'],
  ] as const) {
    const created = await provision.api.signUpEmail({
      body: { name: `E2E ${role}`, email, password: 'E2E-only-Password-2026!' },
    });
    await db
      .insert(s.organizationUserRoles)
      .values({ organizationId: result.organizationId, userId: created.user.id, role });
  }
  console.log('Isolated E2E fixtures prepared.');
} finally {
  await pool.end();
}
