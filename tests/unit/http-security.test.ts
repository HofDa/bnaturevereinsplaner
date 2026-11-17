import { expect, it } from 'vitest';
import { createDatabase } from '../../packages/db/src';
import { createApp } from '../../apps/api/src/app';
import { readConfig } from '../../apps/api/src/plugins/config';

it('keeps early IP rate-limit responses out of caches', async () => {
  const config = readConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://localhost/unused',
    AUTH_SECRET: 'test-only-secret-more-than-32-characters',
  });
  const { db, pool } = createDatabase(config.DATABASE_URL);
  const app = await createApp(db, config, null, null);
  try {
    for (let n = 0; n < 3000; n++) await app.inject('/missing');
    const response = await app.inject('/missing');
    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe('RATE_LIMITED');
    expect(response.headers['retry-after']).toBeDefined();
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.pragma).toBe('no-cache');
  } finally {
    await app.close();
    await pool.end();
  }
}, 15_000);
