// Crawls the real app (seeded by scripts/demo/seed.ts) and saves every JSON API response as
// demo fixtures for the static, backend-free demo build (apps/web/src/demo).
// Usage: web preview on APP_URL proxied to the seeded API, then
//   bun --env-file=.env.test scripts/demo/record.ts
import { chromium, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { DEMO_ADMIN, DEMO_PASSWORD } from './accounts';

const app = new URL(process.env.APP_URL ?? 'http://localhost:5195').origin;
const roles = { admin: DEMO_ADMIN, member: 'sofia.pernter@demo.bnature.example' } as const;
const skip = /\/(pdf|csv|content|export|receipt|calendar\.ics|files\/)|\/attendance\/prepare/;
const openapi = JSON.parse(await readFile('docs/api/openapi.json', 'utf8')) as {
  paths: Record<string, Record<string, unknown>>;
};

type Fixtures = Record<string, unknown>;
const keyOf = (url: URL) => {
  const params = [...url.searchParams].sort(([a], [b]) => a.localeCompare(b));
  const query = new URLSearchParams(params).toString();
  return `GET ${url.pathname.replace(/^\/api\/v1/, '')}${query ? `?${query}` : ''}`;
};

async function crawl(page: Page, fixtures: Fixtures) {
  const seen = new Set<string>(),
    queue = ['/'];
  while (queue.length && seen.size < 220) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    await page.goto(path);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    // Open every tab and segmented filter once so their queries are captured as well.
    for (const tab of await page.getByRole('tab').all()) {
      await tab.click({ timeout: 2000 }).catch(() => undefined);
      await page.waitForLoadState('networkidle').catch(() => undefined);
    }
    const links = await page.$$eval('a[href^="/"]', (as) =>
      as.map((a) => (a as HTMLAnchorElement).getAttribute('href')!),
    );
    for (const href of links) {
      const clean = href.split('#')[0]!;
      if (!clean || clean.startsWith('/api') || seen.has(clean)) continue;
      // Detail pages: at most four per list, enough to click through without a huge bundle.
      const parent = clean.replace(/\/[0-9a-f-]{36}$/, '/:id');
      const siblings = [...seen, ...queue].filter(
        (p) => p.replace(/\/[0-9a-f-]{36}$/, '/:id') === parent,
      );
      if (parent !== clean && siblings.length >= 4) continue;
      queue.push(clean);
    }
  }
  console.log(`  pages crawled: ${seen.size}, responses: ${Object.keys(fixtures).length}`);
}

// Fill gaps: every read endpoint of the API, ids substituted from what was already recorded.
async function sweep(page: Page, fixtures: Fixtures) {
  const organizationId = (fixtures['GET /me'] as { activeOrganizationId?: string } | undefined)
    ?.activeOrganizationId;
  const ids = (prefix: string) => {
    const list = fixtures[`GET ${prefix}`] as
      { items?: { id?: string }[] } | { id?: string }[] | undefined;
    const rows = Array.isArray(list) ? list : (list?.items ?? []);
    return rows
      .map((r) => r?.id)
      .filter((v): v is string => !!v)
      .slice(0, 6);
  };
  const urls: string[] = [];
  for (const [path, methods] of Object.entries(openapi.paths)) {
    if (!('get' in methods)) continue;
    const short = path.replace(/^\/api\/v1/, '');
    if (skip.test(short) || short === '/health') continue;
    const params = short.match(/\{[^}]+\}/g) ?? [];
    if (!params.length) urls.push(short);
    else if (params.length === 1) {
      const parent = short.slice(0, short.indexOf(params[0]!) - 1);
      for (const id of ids(parent)) urls.push(short.replace(params[0]!, id));
    }
  }
  // Reports that need parameters the crawl may not have sent.
  const year = new Date().getFullYear();
  for (const model of ['D', 'E'])
    for (const language of ['de', 'it'])
      urls.push(
        `/finance/reports/ets?fiscalYear=${year}&language=${language}&legalPersonality=unknown&model=${model}`,
      );
  urls.push(`/reports/annual-overview?year=${year}`, `/reports/annual-overview?year=${year - 1}`);
  urls.push(`/register-snapshots/validation?cutoffDate=${new Date().toISOString().slice(0, 10)}`);
  const statuses: Record<string, number> = {};
  for (const url of urls) {
    if (fixtures[`GET ${url}`]) continue;
    for (let attempt = 0; attempt < 3; attempt++) {
      const status = await page.evaluate(
        ([u, org]) =>
          fetch(`/api/v1${u}`, { headers: org ? { 'X-Organization-Id': org } : {} }).then(
            async (r) => (await r.text(), r.status),
          ),
        [url, organizationId] as const,
      );
      statuses[status] = (statuses[status] ?? 0) + 1;
      if (status >= 400 && status !== 403) console.log(`    ${status} ${url}`);
      if (status !== 429) break;
      await page.waitForTimeout(61_000);
    }
  }
  console.log(`  sweep: ${urls.length} endpoints`, statuses);
  await page.waitForTimeout(500);
}

await mkdir('apps/web/src/demo/fixtures', { recursive: true });
const browser = await chromium.launch({
  executablePath: existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined,
});
for (const [role, email] of Object.entries(roles)) {
  console.log(`Recording ${role} …`);
  const context = await browser.newContext({
    baseURL: app,
    locale: 'de-DE',
    timezoneId: 'Europe/Rome',
  });
  // Local recording only: spread requests over synthetic client addresses so the API's
  // per-IP rate limit (TRUST_PROXY=true in .env.test) does not drop crawl responses.
  let client = 0;
  await context.route('**/api/**', (route) =>
    route.continue({
      headers: {
        ...route.request().headers(),
        'x-forwarded-for': `10.9.${(client >> 8) & 255}.${client++ & 255}`,
      },
    }),
  );
  const page = await context.newPage();
  const fixtures: Fixtures = {};
  page.on('response', async (response) => {
    const url = new URL(response.url());
    if (response.request().method() !== 'GET' || !response.ok()) return;
    if (!url.pathname.startsWith('/api/')) return;
    if (!(response.headers()['content-type'] ?? '').includes('json')) return;
    const body = await response.json().catch(() => undefined);
    if (body === undefined) return;
    if (url.pathname.startsWith('/api/auth/')) fixtures[`AUTH ${url.pathname}`] = body;
    else fixtures[keyOf(url)] = body;
  });
  await page.goto('/');
  await page.getByLabel('E-Mail', { exact: true }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await page.getByRole('button', { name: 'Abmelden', exact: true }).waitFor({ timeout: 30_000 });
  await crawl(page, fixtures);
  await sweep(page, fixtures);
  const sorted = Object.fromEntries(
    Object.entries(fixtures).sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(
    `apps/web/src/demo/fixtures/${role}.json`,
    JSON.stringify({ recordedAt: new Date().toISOString(), responses: sorted }),
  );
  console.log(`  saved ${Object.keys(sorted).length} responses`);
  await context.close();
}
await browser.close();
