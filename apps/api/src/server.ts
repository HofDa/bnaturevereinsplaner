import { createDatabase } from '@bnature/db';
import { createApp } from './app';
import { readConfig } from './plugins/config';
import { startMailWorker } from './services/mail-worker';
const config = readConfig();
const { db, pool } = createDatabase(config.DATABASE_URL);
const app = await createApp(db, config);
let closing = false;
let stopMail: (() => Promise<void>) | undefined;
const close = async () => {
  if (closing) return;
  closing = true;
  await stopMail?.();
  await app.close();
  await pool.end();
};
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
try {
  await app.listen({ port: config.PORT, host: config.HOST });
  stopMail = startMailWorker(db, config, () =>
    app.log.error('Email worker failed; inspect queue status.'),
  );
} catch {
  app.log.error('Server could not start.');
  await close();
  process.exitCode = 1;
}
