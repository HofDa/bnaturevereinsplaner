import { createDatabase } from '@bnature/db';
import { createApp } from './app';
import { readConfig } from './plugins/config';
const config = readConfig();
const { db, pool } = createDatabase(config.DATABASE_URL);
const app = await createApp(db, config);
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await app.close();
  await pool.end();
};
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch {
  app.log.error('Server could not start.');
  await close();
  process.exitCode = 1;
}
