import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
const secret = () => randomBytes(32).toString('hex');
if (!existsSync('.env')) {
  const dbPassword = secret(),
    testPassword = secret();
  await writeFile(
    '.env',
    `POSTGRES_PASSWORD=${dbPassword}\nTEST_POSTGRES_PASSWORD=${testPassword}\nDATABASE_URL=postgres://bnature:${dbPassword}@127.0.0.1:55439/bnature\nAUTH_SECRET=${secret()}\nAPP_URL=http://localhost:5173\nPORT=3000\nNODE_ENV=development\n`,
    { mode: 0o600, flag: 'wx' },
  );
  console.log('Created .env with independent random secrets.');
} else console.log('Existing .env preserved.');
if (!existsSync('.env.test')) {
  const env = await readFile('.env', 'utf8');
  const testPassword = env.match(/^TEST_POSTGRES_PASSWORD=(.+)$/m)?.[1];
  if (!testPassword) throw new Error('Set TEST_POSTGRES_PASSWORD in .env first');
  await writeFile(
    '.env.test',
    `DATABASE_URL=postgres://bnature_test:${testPassword}@127.0.0.1:55440/bnature_test\nAUTH_SECRET=${secret()}\nAPP_URL=http://localhost:5174\nPORT=3002\nNODE_ENV=test\n`,
    { mode: 0o600, flag: 'wx' },
  );
  console.log('Created isolated test configuration.');
} else console.log('Existing .env.test preserved.');
