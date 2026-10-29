import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createDatabase, schema as s, type Database } from '@bnature/db';
import { createAuth } from '../auth';
import { readConfig, type Config } from '../plugins/config';
export async function bootstrap(
  db: Database,
  config: Config,
  input: { name: string; email: string; password: string; organizationName: string; slug: string },
) {
  const value = z
    .object({
      name: z.string().trim().min(1).max(100),
      email: z.email(),
      password: z.string().min(12).max(128),
      organizationName: z.string().min(1).max(200),
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    })
    .parse(input);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(748502911)`);
    const existing = await tx
      .select({ id: s.organizations.id })
      .from(s.organizations)
      .where(eq(s.organizations.slug, value.slug));
    if (existing.length)
      throw new Error(
        'Organisation existiert bereits. Bootstrap ist nur für eine neue Organisation erlaubt.',
      );
    const provision = createAuth(tx, config, true);
    const result = await provision.api.signUpEmail({
      body: { name: value.name, email: value.email, password: value.password },
    });
    const [org] = await tx
      .insert(s.organizations)
      .values({ name: value.organizationName, slug: value.slug })
      .returning();
    await tx
      .insert(s.organizationUserRoles)
      .values({ organizationId: org!.id, userId: result.user.id, role: 'admin' });
    await tx.insert(s.auditLogs).values({
      organizationId: org!.id,
      actorUserId: result.user.id,
      action: 'bootstrap',
      entityType: 'organization',
      entityId: org!.id,
      changeMetadata: { fields: ['organization', 'administrator'] },
    });
    return { organizationId: org!.id, userId: result.user.id };
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = readConfig();
  const { db, pool } = createDatabase(config.DATABASE_URL);
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    const name =
      process.env.BOOTSTRAP_NAME ?? (await terminal.question('Name des Administrators: '));
    const email = process.env.BOOTSTRAP_EMAIL ?? (await terminal.question('E-Mail: '));
    const password = process.env.BOOTSTRAP_PASSWORD ?? randomBytes(24).toString('base64url');
    const result = await bootstrap(db, config, {
      name,
      email,
      password,
      organizationName: process.env.BOOTSTRAP_ORGANIZATION ?? 'b*nature',
      slug: process.env.BOOTSTRAP_SLUG ?? 'bnature',
    });
    console.log('Administrator angelegt. Organisation:', result.organizationId);
    if (!process.env.BOOTSTRAP_PASSWORD)
      console.log('Einmalig angezeigtes Passwort (sicher verwahren):', password);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Bootstrap fehlgeschlagen.');
    process.exitCode = 1;
  } finally {
    terminal.close();
    await pool.end();
  }
}
