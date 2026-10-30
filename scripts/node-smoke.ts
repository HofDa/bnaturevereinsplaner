import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
const child = spawn('node', ['--env-file=.env', 'apps/api/dist/server.js'], {
  env: { ...process.env, PORT: '3003', HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => {
  output += String(chunk);
});
child.stderr.on('data', (chunk) => {
  output += String(chunk);
});
try {
  let ready = false;
  // Cold imports and route/schema registration may exceed five seconds on a busy host.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Node API exited before readiness');
    try {
      const response = await fetch('http://127.0.0.1:3003/api/v1/health', {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        assert.deepEqual(await response.json(), { status: 'ok' });
        ready = true;
        break;
      }
    } catch {
      /* wait for server */
    }
    await delay(100);
  }
  assert(ready, 'Node API did not become ready');
  const response = await fetch('http://127.0.0.1:3003/api/v1/members');
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  console.log(
    'Node runtime smoke passed: database health, unauthenticated access and cache policy.',
  );
} catch (error) {
  console.error('Node runtime smoke failed.', error instanceof Error ? error.message : '');
  if (output)
    console.error('Server produced diagnostic output; inspect locally without publishing secrets.');
  process.exitCode = 1;
} finally {
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await Promise.race([exited, delay(5000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
