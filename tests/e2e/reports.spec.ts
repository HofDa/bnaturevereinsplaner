import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
async function login(page: Page, email = 'e2e@example.test') {
  await page.goto('/');
  await page.getByLabel('E-Mail', { exact: true }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill('E2E-only-Password-2026!');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Abmelden', exact: true })).toBeVisible();
}
// Waits for the login form, so the next navigation cannot cancel the sign-out request.
async function logout(page: Page) {
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await expect(page.getByLabel('E-Mail', { exact: true })).toBeVisible();
}
async function a11y(page: Page) {
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
}
test('shows the annual overview with charts, tooltips and tables', async ({ page }, info) => {
  await login(page);
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Auswertungen', level: 1 })).toBeVisible();
  const members = page.locator('.report-chart').filter({ hasText: 'Mitgliederentwicklung' });
  await expect(members.getByRole('img', { name: 'Mitgliederentwicklung' })).toBeVisible();
  for (const title of ['Eintritte und Austritte', 'Veranstaltungen', 'Freiwilligenstunden'])
    await expect(page.getByRole('heading', { name: title, level: 2 })).toBeVisible();
  const flow = page.locator('.report-chart').filter({ hasText: 'Eintritte und Austritte' });
  await expect(flow.locator('.report-legend')).toContainText('Eintritte');
  await flow.locator('.report-hit').first().hover();
  await expect(flow.getByRole('status')).toContainText('Eintritte:');
  await members.getByText('Als Tabelle anzeigen', { exact: true }).click();
  await expect(members.getByRole('cell').first()).toBeVisible();
  await a11y(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/reports-${info.project.name}.png`, fullPage: true });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Dunkel', exact: true }).click();
  await page.goto('/reports');
  await expect(members.getByRole('img')).toBeVisible();
  await a11y(page);
  await page.screenshot({ path: `test-results/reports-dark-${info.project.name}.png` });
  await logout(page);
  await login(page, 'e2e-member@example.test');
  await expect(page.getByRole('link', { name: 'Auswertungen' })).toHaveCount(0);
  expect((await page.request.get('/api/v1/reports/annual-overview?year=2026')).status()).toBe(403);
});
