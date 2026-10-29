import { it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import { createDatabase, schema as s } from '../../packages/db/src';
import { readConfig } from '../../apps/api/src/plugins/config';
it('upgrades a real Phase-1 database without losing existing persons or memberships', async () => {
  const config = readConfig();
  if (
    config.NODE_ENV !== 'test' ||
    !new URL(config.DATABASE_URL).pathname.endsWith('/bnature_test')
  )
    throw new Error('Dedicated test database required');
  const databaseName = `bnature_test_upgrade_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = createDatabase(config.DATABASE_URL);
  let upgraded: ReturnType<typeof createDatabase> | undefined;
  let created = false;
  const folder = await mkdtemp(join(tmpdir(), 'bnature-migration-'));
  try {
    // The name consists only of a fixed test prefix plus a locally generated UUID.
    await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    const connection = new URL(config.DATABASE_URL);
    connection.pathname = `/${databaseName}`;
    upgraded = createDatabase(connection.toString());
    await mkdir(join(folder, 'meta'));
    await writeFile(
      join(folder, '0000_conscious_thing.sql'),
      await readFile('packages/db/migrations/0000_conscious_thing.sql'),
    );
    const journal = JSON.parse(await readFile('packages/db/migrations/meta/_journal.json', 'utf8'));
    journal.entries = journal.entries.slice(0, 1);
    await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
    await migrate(upgraded.db, { migrationsFolder: folder });
    const orgId = crypto.randomUUID(),
      personId = crypto.randomUUID(),
      membershipId = crypto.randomUUID();
    await upgraded.db
      .insert(s.organizations)
      .values({ id: orgId, name: 'Existing association', slug: 'existing' });
    await upgraded.db
      .insert(s.persons)
      .values({ id: personId, organizationId: orgId, firstName: 'Existing', lastName: 'Member' });
    await upgraded.db.insert(s.memberships).values({
      id: membershipId,
      organizationId: orgId,
      personId,
      membershipNumber: 'OLD-001',
      joinedAt: '2020-01-01',
    });
    await migrate(upgraded.db, { migrationsFolder: 'packages/db/migrations' });
    const [member] = await upgraded.db
      .select()
      .from(s.memberships)
      .where(eq(s.memberships.id, membershipId));
    expect(member?.membershipNumber).toBe('OLD-001');
    expect(member?.personId).toBe(personId);
    const [person] = await upgraded.db.select().from(s.persons).where(eq(s.persons.id, personId));
    expect(person?.firstName).toBe('Existing');
    expect(await upgraded.db.select().from(s.membershipFeePlans)).toEqual([]);
    const triggers = await upgraded.db.execute(
      sql`select tgname from pg_trigger where tgname='payment_balanced_after_insert'`,
    );
    expect(triggers.rowCount).toBe(1);
    expect(await upgraded.db.select().from(s.cashbookEntries)).toEqual([]);
    const ledgerTriggers = await upgraded.db.execute(
      sql`select tgname from pg_trigger where tgname in ('cashbook_entry_insert_guard','payment_reversal_balanced_after_insert','payment_reference_guard')`,
    );
    expect(ledgerTriggers.rowCount).toBe(3);
    expect(await upgraded.db.select().from(s.documents)).toEqual([]);
    const documentTriggers = await upgraded.db.execute(
      sql`select tgname from pg_trigger where tgname in ('document_versions_immutable','document_update_guard','document_version_insert_guard')`,
    );
    expect(documentTriggers.rowCount).toBe(3);
  } finally {
    await upgraded?.pool.end();
    if (created) await admin.pool.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await admin.pool.end();
    await rm(folder, { recursive: true, force: true });
  }
}, 30_000);
