import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
async function login(page: Page, email = 'e2e@example.test') {
  await page.goto('/');
  await page.getByLabel('E-Mail', { exact: true }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill('E2E-only-Password-2026!');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Abmelden', exact: true })).toBeVisible();
}
async function a11y(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    })),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}
const dialog = (page: Page) => page.getByRole('dialog');
const local = (offsetDays: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );
const row = (page: Page, text: string) => page.getByRole('row').filter({ hasText: text });

test('manages items, lends, extends and returns them in DE/IT', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page);
  await page.getByRole('link', { name: 'Inventar' }).click();
  await expect(page.getByRole('heading', { name: 'Inventar', exact: true })).toBeVisible();
  await expect(page.getByText('Keine Gegenstände gefunden.')).toBeVisible();

  await page.getByRole('button', { name: 'Gegenstand anlegen' }).click();
  let form = dialog(page);
  await form.getByLabel(/^Bezeichnung/).fill('Spektiv');
  await form.getByLabel('Inventarnummer').fill('INV-0001');
  await form.getByLabel('Kategorie').fill('Optik');
  await form.getByLabel('Lagerort').fill('Vereinsraum');
  await form.getByLabel('Stückwert (EUR)').fill('899,00');
  await a11y(page);
  await form.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(row(page, 'Spektiv')).toContainText('1 von 1');

  await page.getByRole('button', { name: 'Gegenstand anlegen' }).click();
  form = dialog(page);
  await form.getByLabel(/^Bezeichnung/).fill('Warnwesten');
  await form.getByLabel('Kategorie').fill('Sicherheit');
  await form.getByLabel(/^Bestand/).fill('5');
  await form.getByRole('button', { name: 'Speichern' }).click();
  await expect(row(page, 'Warnwesten')).toContainText('5 von 5');
  await expect(page.getByText('Erfasster Wert')).toBeVisible();
  await a11y(page);

  await row(page, 'Spektiv').getByRole('button', { name: 'Ausleihen: Spektiv' }).click();
  form = dialog(page);
  await form
    .getByLabel(/^Ausleihende Person/)
    .selectOption({ label: 'Testperson Lena · Mitglied' });
  await form.getByLabel(/^Ausgegeben am/).fill(local(-10));
  await form.getByLabel(/^Rückgabe bis/).fill(local(-3));
  await a11y(page);
  await form.getByRole('button', { name: 'Ausleihen' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(row(page, 'Spektiv')).toContainText('0 von 1');
  await expect(row(page, 'Spektiv')).toContainText('1 Ausleihe überfällig');
  await expect(
    row(page, 'Spektiv').getByRole('button', { name: 'Ausleihen: Spektiv' }),
  ).toHaveCount(0);

  await row(page, 'Warnwesten').getByRole('button', { name: 'Ausleihen: Warnwesten' }).click();
  form = dialog(page);
  await form
    .getByLabel(/^Ausleihende Person/)
    .selectOption({ label: 'Testperson Lena · Mitglied' });
  await form.getByLabel(/^Bestand/).fill('3');
  await form.getByRole('button', { name: 'Ausleihen' }).click();
  await expect(row(page, 'Warnwesten')).toContainText('2 von 5');

  await page.getByRole('link', { name: 'Ausleihen', exact: true }).click();
  await expect(row(page, 'Spektiv')).toContainText('seit 3 Tagen überfällig');
  await page.getByLabel('Status').selectOption('overdue');
  await expect(page.getByRole('row')).toHaveCount(2);
  await a11y(page);
  await row(page, 'Spektiv')
    .getByRole('button', { name: 'Rückgabedatum verlängern: Spektiv, Lena Testperson' })
    .click();
  await dialog(page)
    .getByLabel(/^Rückgabe bis/)
    .fill(local(7));
  await dialog(page).getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Keine Ausleihen in dieser Auswahl.')).toBeVisible();
  await page.getByLabel('Status').selectOption('open');
  await row(page, 'Spektiv')
    .getByRole('button', { name: 'Rückgabe erfassen: Spektiv, Lena Testperson' })
    .click();
  form = dialog(page);
  await expect(form.getByText(/Bei Einzelstücken wird der Zustand/)).toBeVisible();
  await form.getByLabel(/^Zustand bei Rückgabe/).selectOption('damaged');
  await form.getByLabel('Bemerkungen zur Rückgabe').fill('Okular zerkratzt');
  await a11y(page);
  await form.getByRole('button', { name: 'Rückgabe erfassen' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await page.getByLabel('Status').selectOption('returned');
  await expect(row(page, 'Spektiv')).toContainText('zurück am');

  await page.getByRole('link', { name: 'Gegenstände', exact: true }).click();
  await expect(row(page, 'Spektiv')).toContainText('beschädigt');
  await row(page, 'Spektiv').getByRole('button', { name: 'Details öffnen: Spektiv' }).click();
  await expect(dialog(page).getByText('Okular zerkratzt')).toBeVisible();
  await a11y(page);
  await dialog(page)
    .getByRole('button', { name: /Schließen/ })
    .click();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV exportieren' }).click();
  expect((await download).suggestedFilename()).toBe('inventar.csv');

  await row(page, 'Spektiv').getByRole('button', { name: 'Ausmustern: Spektiv' }).click();
  await dialog(page)
    .getByLabel(/^Grund/)
    .fill('Optik irreparabel');
  await dialog(page).getByRole('button', { name: 'Ausmustern' }).click();
  await expect(row(page, 'Spektiv')).toHaveCount(0);
  await expect(
    row(page, 'Warnwesten').getByRole('button', { name: 'Ausmustern: Warnwesten' }),
  ).toBeDisabled();

  await page.getByRole('button', { name: 'Sprache: DE' }).click();
  await expect(page.getByRole('heading', { name: 'Inventario', exact: true })).toBeVisible();
  await expect(row(page, 'Warnwesten')).toContainText('2 di 5');
  await page.getByRole('link', { name: 'Prestiti', exact: true }).click();
  await expect(row(page, 'Warnwesten')).toContainText('in prestito');
  await a11y(page);
  await page.getByRole('button', { name: /Lingua|Sprache/ }).click();
});

test('limits inventory actions by role', async ({ page }) => {
  await login(page, 'e2e-lead@example.test');
  await page.goto('/inventory');
  await expect(page.getByRole('heading', { name: 'Inventar', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gegenstand anlegen' })).toHaveCount(0);
  expect(
    (
      await page.request.post('/api/v1/inventory/items', {
        data: { name: 'Unerlaubt' },
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      })
    ).status(),
  ).toBe(403);
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  // Wait for the login form so the next navigation cannot cancel the sign-out.
  await expect(page.getByLabel('E-Mail', { exact: true })).toBeVisible();
  await login(page, 'e2e-member@example.test');
  await expect(page.getByRole('link', { name: 'Inventar' })).toHaveCount(0);
  expect((await page.request.get('/api/v1/inventory/items')).status()).toBe(403);
  expect((await page.request.get('/api/v1/inventory/my-loans')).status()).toBe(200);
  await page.goto('/inventory');
  await expect(page.getByText('Für diese Ansicht fehlt Ihnen die Berechtigung.')).toBeVisible();
});
