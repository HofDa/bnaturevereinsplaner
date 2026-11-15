// Smoke check of the static demo build: every page for both roles, no crashes or missing fixtures.
// Usage: VITE_DEMO=1 vite build --outDir dist-demo && vite preview --outDir dist-demo --port 5196,
// then  DEMO_URL=http://localhost:5196 bun scripts/demo/check.ts
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';

const base = process.env.DEMO_URL ?? 'http://localhost:5196';
const baseUrl = base.endsWith('/') ? base : `${base}/`;
const basePath = new URL(baseUrl).pathname.replace(/\/$/, '');
const shots = process.env.DEMO_SCREENSHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({
  executablePath: existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined,
});
let problems = 0;
for (const role of ['admin', 'member'] as const) {
  const context = await browser.newContext({
    baseURL: baseUrl,
    locale: 'de-DE',
    serviceWorkers: 'block',
  });
  await context.addInitScript((r) => sessionStorage.setItem('bnature-demo-role', r), role);
  const page = await context.newPage();
  const issues: string[] = [];
  page.on('pageerror', (e) => issues.push(`pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.text().startsWith('[demo]'))
      issues.push(`${m.type()} ${m.text()}`);
  });
  const seen = new Set<string>(),
    queue = ['/'];
  while (queue.length && seen.size < 120) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const before = issues.length;
    await page.goto(new URL(path.replace(/^\//, ''), baseUrl).toString());
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(700);
    for (const tab of await page.getByRole('tab').all()) {
      await tab.click({ timeout: 2000 }).catch(() => undefined);
      await page.waitForTimeout(500);
    }
    // Domain warnings that are expected with the demo data (no prior-year ledger for ETS reports).
    const expected = /Vorjahreswerte oder Rechtspersönlichkeit fehlen/;
    const alerts = await page.locator('[role="alert"]').allInnerTexts();
    const errorShown = alerts.filter((text) => !expected.test(text)).length;
    if (errorShown)
      issues.push(
        `error visible on ${path}: ${alerts.find((text) => !expected.test(text))!.slice(0, 120)}`,
      );
    if (shots)
      await page.screenshot({
        path: `${shots}/${role}${path.replaceAll('/', '_') || '_home'}.png`,
      });
    for (const issue of issues.slice(before)) console.log(`  [${role}] ${path}: ${issue}`);
    for (const rawHref of await page.$$eval('a[href^="/"]', (as) =>
      as.map((a) => a.getAttribute('href')!),
    )) {
      const href =
        basePath && rawHref === basePath
          ? '/'
          : basePath && rawHref.startsWith(`${basePath}/`)
            ? rawHref.slice(basePath.length)
            : rawHref;
      if (
        !seen.has(href) &&
        !href.startsWith('/api') &&
        queue.filter((q) => q.split('/')[1] === href.split('/')[1]).length < 3
      )
        queue.push(href);
    }
  }
  console.log(`${role}: ${seen.size} pages, ${issues.length} issue(s)`);
  problems += issues.length;
  await context.close();
}
await browser.close();
process.exit(problems ? 1 : 0);
