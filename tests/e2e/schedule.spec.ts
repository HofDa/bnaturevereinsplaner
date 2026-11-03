import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test.setTimeout(120_000);
const password = 'E2E-only-Password-2026!';
async function login(page: Page, email = 'e2e@example.test', pass = password) {
  await page.goto('/');
  await page.getByLabel('E-Mail', { exact: true }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(pass);
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
test('finds a date: proposes slots, collects answers and fixes the best slot', async ({
  page,
}, info) => {
  const suffix = `${info.project.name}-${Date.now()}`;
  const title = `Heckenpflege ${suffix}`;
  await login(page);
  await page.goto('/community?kind=schedule');
  await page.getByRole('button', { name: 'Terminfindung erstellen', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Terminfindung erstellen' });
  await editor.getByLabel('Titel (DE)', { exact: true }).fill(title);
  await editor.getByLabel('Titel (IT)', { exact: true }).fill(`Siepe ${suffix}`);
  await editor.getByLabel('Ort', { exact: true }).fill('Biotop');
  await editor.getByRole('button', { name: 'Weiteren Termin', exact: true }).click();
  await expect(editor.getByLabel('Datum 3', { exact: true })).toBeVisible();
  await a11y(page);
  await editor.getByRole('button', { name: 'Erstellen und teilen', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await page.goto('/community?kind=schedule');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: title, exact: true }).click();
  const slots = page.locator('.sched-list > li');
  await expect(slots).toHaveCount(3);
  await slots.nth(0).getByText('Ja', { exact: true }).click();
  await slots.nth(1).getByText('Wenn nötig', { exact: true }).click();
  await slots.nth(2).getByText('Nein', { exact: true }).click();
  await page.getByRole('button', { name: 'Antworten speichern', exact: true }).click();
  await expect(page.getByText('Antworten gespeichert.', { exact: true })).toBeVisible();
  await expect(slots.nth(0)).toContainText('Beste Option');
  await a11y(page);
  const url = page.url();
  await logout(page);
  await login(page, 'e2e-member@example.test');
  await page.goto('/community?kind=schedule');
  await page.getByRole('link', { name: title, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Abschließen' })).toHaveCount(0);
  await slots.nth(1).getByText('Ja', { exact: true }).click();
  await slots.nth(0).getByText('Ja', { exact: true }).click();
  await page.getByRole('button', { name: 'Antworten speichern', exact: true }).click();
  await expect(page.getByText('2 Personen haben geantwortet')).toBeVisible();
  const matrix = page.locator('.sched-matrix');
  await expect(matrix.getByRole('row')).toHaveCount(3);
  const [scroll, viewport] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    innerWidth,
  ]);
  expect(scroll, 'no horizontal page scroll').toBeLessThanOrEqual(viewport!);
  await page.screenshot({ path: `test-results/schedule-${info.project.name}.png`, fullPage: true });
  await logout(page);
  await login(page);
  await page.goto(url);
  await page.getByRole('button', { name: 'Abschließen', exact: true }).click();
  const close = page.getByRole('dialog', { name: 'Abschließen' });
  await close.getByRole('button', { name: 'Abschließen', exact: true }).click();
  await expect(close).not.toBeVisible();
  await expect(page.getByText(/^Termin festgelegt:/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Antworten speichern' })).toHaveCount(0);
  await a11y(page);
  // Turn the fixed slot into the club event.
  const category = await page.request.post('/api/v1/event-categories', {
    headers: { Origin: new URL(page.url()).origin, 'Idempotency-Key': crypto.randomUUID() },
    data: { nameI18n: { de: `Pflege ${suffix}`, it: `Cura ${suffix}` } },
  });
  expect(category.status()).toBe(201);
  await page.reload();
  await page.getByRole('button', { name: 'Als Veranstaltung anlegen', exact: true }).click();
  const toEvent = page.getByRole('dialog', { name: 'Als Veranstaltung anlegen' });
  await toEvent
    .getByLabel('Kategorie', { exact: true })
    .selectOption({ label: `Pflege ${suffix}` });
  await toEvent.getByText('Sofort veröffentlichen (sonst als Entwurf)').click();
  await a11y(page);
  await toEvent.getByRole('button', { name: 'Veranstaltung anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await page.goto(url);
  await expect(page.getByRole('link', { name: 'Zur Veranstaltung' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Als Veranstaltung anlegen' })).toHaveCount(0);
});
