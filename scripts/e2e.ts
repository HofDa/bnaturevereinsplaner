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
  'inventory',
  'community',
  'community-chat',
  'member-extras',
  'member-experience',
  'volunteer-self',
  'reports',
  'chat-poll',
  'schedule',
  'newsletter',
  'planning',
];
// Suites whose layout differs on phones (navigation, tabs, wide tables, charts, dialogs).
// CI runs only these on mobile for pull requests; the nightly run covers all of them.
const mobileSuites = [
  'planning',
  'platform',
  'community',
  'community-chat',
  'schedule',
  'reports',
  'member-extras',
  'member-experience',
];
const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a === name || a.startsWith(`${name}=`));
const projectArg = flag('--project')?.split('=')[1];
if (projectArg && !['desktop', 'mobile'].includes(projectArg)) throw new Error('Unknown project');
const mobileSubset = !!flag('--mobile-subset');
const requested = args.filter((a) => !a.startsWith('--'));
if (requested.some((s) => !suites.includes(s))) throw new Error('Unknown E2E suite');
const build = spawn('bun', ['run', '--filter', '@bnature/web', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
});
const [buildCode] = await once(build, 'exit');
if (buildCode !== 0) process.exit(typeof buildCode === 'number' ? buildCode : 1);
// Each suite gets the real rate limits and a fresh API process; fast synthetic sessions do not share IP counters.
for (const project of projectArg ? [projectArg] : ['desktop', 'mobile']) {
  const selected = requested.length
    ? requested
    : project === 'mobile' && mobileSubset
      ? mobileSuites
      : suites;
  for (const suite of selected) {
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
        env: {
          ...process.env,
          E2E_PREBUILT: 'true',
          EMAIL_MODE: suite === 'mail' || suite === 'newsletter' ? 'local' : 'disabled',
        },
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
