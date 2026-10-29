import { spawn } from 'node:child_process';
import { once } from 'node:events';
// Each suite gets the real rate limits and a fresh API process; fast synthetic sessions do not share IP counters.
for (const project of ['desktop', 'mobile']) {
  for (const suite of ['platform', 'finance', 'ledger', 'documents']) {
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
      { stdio: 'inherit', env: process.env },
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
