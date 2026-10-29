import { writeFile } from 'node:fs/promises';
import { createDatabase } from '../packages/db/src';
import { createApp } from '../apps/api/src/app';
import { readConfig } from '../apps/api/src/plugins/config';
const config = readConfig({
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://unused:unused@localhost/unused',
  AUTH_SECRET: process.env.AUTH_SECRET ?? 'openapi-generation-only-not-a-runtime-secret',
});
const { db, pool } = createDatabase(config.DATABASE_URL);
const app = await createApp(db, config);
try {
  await app.ready();
  await writeFile('docs/api/openapi.json', JSON.stringify(app.swagger(), null, 2) + '\n');
} finally {
  await app.close();
  await pool.end();
}
