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
    // Raw SQL: the current schema has columns that Phase 1 did not have yet.
    await upgraded.db.execute(
      sql`insert into persons(id,organization_id,first_name,last_name,fiscal_code,city) values(${personId},${orgId},'Existing','Member','XSTMMB80A01A952K','Brixen')`,
    );
    await upgraded.db.insert(s.memberships).values({
      id: membershipId,
      organizationId: orgId,
      personId,
      membershipNumber: 'OLD-001',
      joinedAt: '2020-01-01',
    });
    // Upgrade through the previous Sprint-2.2 schema and preserve a closed ledger too.
    const priorJournal = JSON.parse(
      await readFile('packages/db/migrations/meta/_journal.json', 'utf8'),
    );
    priorJournal.entries = priorJournal.entries.slice(0, 4);
    for (const migration of priorJournal.entries)
      await writeFile(
        join(folder, `${migration.tag}.sql`),
        await readFile(`packages/db/migrations/${migration.tag}.sql`),
      );
    await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(priorJournal));
    await migrate(upgraded.db, { migrationsFolder: folder });
    const actorId = crypto.randomUUID(),
      accountId = crypto.randomUUID(),
      categoryId = crypto.randomUUID(),
      entryId = crypto.randomUUID(),
      yearId = crypto.randomUUID();
    await upgraded.db
      .insert(s.user)
      .values({ id: actorId, name: 'Existing treasurer', email: 'upgrade@example.test' });
    await upgraded.db.execute(
      sql`insert into finance_accounts(id,organization_id,name,kind) values(${accountId},${orgId},'Existing bank','bank')`,
    );
    await upgraded.db.execute(
      sql`insert into cashbook_categories(id,organization_id,name,direction) values(${categoryId},${orgId},'Original category','income')`,
    );
    await upgraded.db.execute(
      sql`insert into fiscal_years(id,organization_id,year,opened_by) values(${yearId},${orgId},2025,${actorId})`,
    );
    await upgraded.db.execute(
      sql`insert into cashbook_entries(id,organization_id,fiscal_year,entry_number,account_id,category_id,direction,amount_cents,booking_date,document_date,description,created_by) values(${entryId},${orgId},2025,1,${accountId},${categoryId},'income',1234,'2025-03-01','2025-03-01','Historical income',${actorId})`,
    );
    await upgraded.db.execute(
      sql`update fiscal_years set status='closed',closed_by=${actorId},closed_at=now() where id=${yearId}`,
    );
    await upgraded.db.execute(
      sql`insert into finance_operations(organization_id,idempotency_key,operation,request_hash,response,actor_user_id) values(${orgId},${crypto.randomUUID()},'cashbook-entries:create',${'a'.repeat(64)},${JSON.stringify({ id: entryId, categoryName: 'Original category' })}::jsonb,${actorId})`,
    );
    await upgraded.db.execute(
      sql`insert into finance_operations(organization_id,idempotency_key,operation,request_hash,response,actor_user_id) values(${orgId},${crypto.randomUUID()},'fiscal-years:create',${'b'.repeat(64)},${JSON.stringify({ id: yearId, year: 2025, balances: [] })}::jsonb,${actorId})`,
    );
    await upgraded.db.execute(
      sql`update cashbook_categories set name='Renamed later' where id=${categoryId}`,
    );
    await migrate(upgraded.db, { migrationsFolder: 'packages/db/migrations' });
    const [member] = await upgraded.db
      .select()
      .from(s.memberships)
      .where(eq(s.memberships.id, membershipId));
    expect(member?.membershipNumber).toBe('OLD-001');
    expect(member?.personId).toBe(personId);
    const [person] = await upgraded.db.select().from(s.persons).where(eq(s.persons.id, personId));
    expect(person?.firstName).toBe('Existing');
    // Sprint 2.4 extends persons in place; existing data stays and register fields start empty.
    expect([person?.fiscalCode, person?.city, person?.birthPlace, person?.domicile]).toEqual([
      'XSTMMB80A01A952K',
      'Brixen',
      '',
      '',
    ]);
    const volunteerTriggers = await upgraded.db.execute(
      sql`select tgname from pg_trigger where tgname in ('volunteer_register_entry_insert','volunteer_snapshot_guard','compliance_deadline_evidence','register_document_guard')`,
    );
    expect(volunteerTriggers.rowCount).toBe(4);
    expect(await upgraded.db.select().from(s.membershipFeePlans)).toEqual([]);
    const triggers = await upgraded.db.execute(
      sql`select tgname from pg_trigger where tgname='payment_balanced_after_insert'`,
    );
    expect(triggers.rowCount).toBe(1);
    const [historical] = await upgraded.db.select().from(s.cashbookEntries);
    expect(historical?.id).toBe(entryId);
    expect(historical?.amountCents).toBe(1234);
    expect(historical?.categoryName).toBe('Original category');
    expect(historical?.etsPosition).toBeNull();
    const [year] = await upgraded.db.select().from(s.fiscalYears);
    expect(year?.startsOn).toBe('2025-01-01');
    expect(year?.endsOn).toBe('2025-12-31');
    expect(year?.status).toBe('closed');
    const replay = (
      await upgraded.db.execute<{ response: { startsOn: string; endsOn: string } }>(
        sql`select response from finance_operations where operation='fiscal-years:create'`,
      )
    ).rows[0]!.response;
    expect(replay.startsOn).toBe('2025-01-01');
    expect(replay.endsOn).toBe('2025-12-31');
    await expect(
      upgraded.db.execute(sql`update cashbook_entries set amount_cents=1 where id=${entryId}`),
    ).rejects.toThrow();
    await expect(
      upgraded.db.execute(sql`update fiscal_years set ends_on='2025-11-30' where id=${yearId}`),
    ).rejects.toThrow();
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
    if (created) {
      // pool.end() can resolve before the server closed the session; a forced drop would then
      // terminate it mid-close and surface as an unhandled client error. Wait for it first.
      for (let i = 0; i < 50; i++) {
        const { rows } = await admin.pool.query(
          'select count(*)::int as n from pg_stat_activity where datname = $1',
          [databaseName],
        );
        if (rows[0].n === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await admin.pool.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    }
    await admin.pool.end();
    await rm(folder, { recursive: true, force: true });
  }
}, 30_000);
