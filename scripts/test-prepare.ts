import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { createDatabase, schema as s } from '../packages/db/src';
import { bootstrap } from '../apps/api/src/services/bootstrap';
import { readConfig } from '../apps/api/src/plugins/config';
const config = readConfig();
if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('/bnature_test'))
  throw new Error('Only the dedicated bnature_test database may be reset');
const { db, pool } = createDatabase(config.DATABASE_URL);
try {
  await migrate(db, { migrationsFolder: 'packages/db/migrations' });
  await db.execute(sql`truncate table organizations, users cascade`);
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
  console.log('Isolated E2E fixtures prepared.');
} finally {
  await pool.end();
}
