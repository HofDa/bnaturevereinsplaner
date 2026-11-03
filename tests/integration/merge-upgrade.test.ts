import { it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, schema as s } from '../../packages/db/src';
import { readConfig } from '../../apps/api/src/plugins/config';

it.each(['inventory', 'community'] as const)(
  'merges the applied %s migration history without losing data',
  async (branch) => {
    const config = readConfig();
    if (config.NODE_ENV !== 'test' || new URL(config.DATABASE_URL).pathname !== '/bnature_test')
      throw new Error('Dedicated test database required');
    const databaseName = `bnature_test_merge_${crypto.randomUUID().replaceAll('-', '')}`;
    const admin = createDatabase(config.DATABASE_URL);
    let target: ReturnType<typeof createDatabase> | undefined;
    let created = false;
    const folder = await mkdtemp(join(tmpdir(), 'bnature-merge-'));
    try {
      await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
      created = true;
      const connection = new URL(config.DATABASE_URL);
      connection.pathname = `/${databaseName}`;
      target = createDatabase(connection.toString());
      await mkdir(join(folder, 'meta'));
      const journal = JSON.parse(
        await readFile('packages/db/migrations/meta/_journal.json', 'utf8'),
      );
      // Keep the actual timestamps: Drizzle selects pending migrations by timestamp.
      journal.entries = journal.entries.filter(
        (entry: { idx: number }) =>
          entry.idx <= 12 ||
          (branch === 'inventory' ? entry.idx === 13 : entry.idx >= 14 && entry.idx <= 16),
      );
      for (const entry of journal.entries)
        await writeFile(
          join(folder, `${entry.tag}.sql`),
          await readFile(`packages/db/migrations/${entry.tag}.sql`),
        );
      await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
      await migrate(target.db, { migrationsFolder: folder });
      const orgId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      await target.db
        .insert(s.organizations)
        .values({ id: orgId, name: 'Existing', slug: 'existing' });
      await target.db
        .insert(s.user)
        .values({ id: userId, name: 'Existing', email: 'merge@example.test' });
      const rowId = crypto.randomUUID();
      if (branch === 'inventory') {
        await target.db.insert(s.inventoryItems).values({
          id: rowId,
          organizationId: orgId,
          name: 'Historical item',
          createdBy: userId,
        });
      } else {
        await target.db
          .insert(s.organizationUserRoles)
          .values({ organizationId: orgId, userId, role: 'admin' });
        await target.db.insert(s.communityPosts).values({
          id: rowId,
          organizationId: orgId,
          kind: 'news',
          createdBy: userId,
          titleI18n: { de: 'Historisch', it: 'Storico' },
          bodyI18n: { de: 'Nachricht', it: 'Notizia' },
        });
        // Raw SQL with the historical columns: the current schema has columns added later.
        await target.pool.query(
          'insert into community_chat_messages (organization_id, created_by, body) values ($1, $2, $3)',
          [orgId, userId, 'Historical message'],
        );
        await target.db.insert(s.persons).values({
          organizationId: orgId,
          firstName: 'Existing',
          lastName: 'Subscriber',
          newsletterOptOut: true,
        });
      }
      await migrate(target.db, { migrationsFolder: 'packages/db/migrations' });
      // A second run must be a no-op for both histories.
      await migrate(target.db, { migrationsFolder: 'packages/db/migrations' });
      expect(await target.db.select().from(s.inventoryLoans)).toEqual([]);
      expect(await target.db.select().from(s.communityOptions)).toEqual([]);
      expect(await target.db.select().from(s.communityVotes)).toEqual([]);
      expect(await target.db.select().from(s.mailNewsletters)).toEqual([]);
      expect((await target.db.select().from(s.persons)).map((row) => row.newsletterOptOut)).toEqual(
        branch === 'community' ? [true] : [],
      );
      const items = await target.db.select().from(s.inventoryItems);
      const posts = await target.db.select().from(s.communityPosts);
      const chat = await target.db.select().from(s.communityChatMessages);
      expect(items.map((row) => row.id)).toEqual(branch === 'inventory' ? [rowId] : []);
      expect(posts.map((row) => row.id)).toEqual(branch === 'community' ? [rowId] : []);
      expect(chat.map((row) => row.body)).toEqual(
        branch === 'community' ? ['Historical message'] : [],
      );
      const triggers = await target.pool.query(
        "select tgname from pg_trigger where tgname in ('inventory_items_guard','inventory_loans_guard','community_post_guard')",
      );
      expect(triggers.rows.map((row) => row.tgname).sort()).toEqual([
        'community_post_guard',
        'inventory_items_guard',
        'inventory_loans_guard',
      ]);
    } finally {
      await target?.pool.end();
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
  },
  30_000,
);
