import { spawn } from 'node:child_process';
import { once } from 'node:events';
const suites = [
  'platform',
  'finance',
  'ledger',
  'documents',
  'sprint22',
  'events',
  'volunteers',
  'mail',
  'community',
];
const requested = process.argv.slice(2);
if (requested.some((s) => !suites.includes(s))) throw new Error('Unknown E2E suite');
// Each suite gets the real rate limits and a fresh API process; fast synthetic sessions do not share IP counters.
for (const project of ['desktop', 'mobile']) {
  for (const suite of requested.length ? requested : suites) {
    console.log(`\nBrowser suite: ${suite} / ${project}`);
    const child = spawn(
      'bun',
      [
        '--env-file=.env.test',
        'run',
        'playwright',
        'test',
        `tests/e2e/${suite}.spec.ts`,
        `--project=${project}`,
        `--output=test-results/${project}/${suite}`,
      ],
      {
        stdio: 'inherit',
        env: { ...process.env, EMAIL_MODE: suite === 'mail' ? 'local' : 'disabled' },
      },
    );
    const interrupt = () => child.kill('SIGTERM');
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    const [code] = await once(child, 'exit');
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (code !== 0) {
      process.exitCode = typeof code === 'number' ? code : 1;
      break;
    }
  }
  if (process.exitCode) break;
}
