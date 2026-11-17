import { login } from './helpers/login';
import { test, expect } from '@playwright/test';
test('recovers when an authenticated session read fails once', async ({ page }) => {
  let failed = false;
  await page.route('**/api/v1/me', async (route) => {
    const response = await route.fetch();
    if (!failed && response.status() === 200) {
      failed = true;
      await route.fulfill({
        status: 500,
        json: { error: { code: 'INTERNAL_ERROR', message: 'Transient test failure' } },
      });
    } else await route.fulfill({ response });
  });
  await login(page);
  expect(failed).toBe(true);
  await expect(page.getByRole('heading', { name: 'Gemeinsam mehr bewegen.' })).toBeVisible();
});
test('logs in, creates and edits a membership, searches, exports, changes language and logs out', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  await page.getByRole('link', { name: 'Mitglied anlegen', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Vorname *', { exact: true }).fill('Nora');
  await dialog.getByLabel('Nachname *', { exact: true }).fill('E2E');
  await dialog.getByLabel('Mitgliedsnummer *', { exact: true }).fill(`E2E-${info.project.name}`);
  await dialog.getByLabel('E-Mail', { exact: true }).fill(`nora-${info.project.name}@example.test`);
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Nora E2E', exact: true, level: 1 }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Telefon', { exact: true }).fill('+39 000 123');
  await page.getByRole('dialog').getByRole('button', { name: 'Änderungen speichern' }).click();
  await expect(page.getByText('+39 000 123', { exact: true })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'Mitglieder', exact: true }).click();
  await page.getByRole('searchbox').fill(`E2E-${info.project.name}`);
  await expect(
    page.getByRole('cell', { name: `E2E-${info.project.name}`, exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV exportieren' }).click();
  expect((await download).suggestedFilename()).toBe('bnature-mitglieder.csv');
  await expect(
    page.getByRole('cell', { name: `E2E-${info.project.name}`, exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (info.project.name === 'mobile') {
    const widths = await page
      .locator('.member-toolbar select')
      .evaluateAll((controls) => controls.map((control) => control.getBoundingClientRect().width));
    expect(widths.every((width) => width >= 250)).toBe(true);
  }
  await page.screenshot({ path: `test-results/members-${info.project.name}.png`, fullPage: false });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Dunkel', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Italiano', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Impostazioni', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Esci', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accedi', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test('manages groups, mandates and organization settings with real persistence', async ({
  page,
}, info) => {
  await login(page);
  await page.goto('/groups');
  await page.getByRole('button', { name: 'Gruppe anlegen', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Gruppenname *', { exact: true }).fill(`Biotop ${info.project.name}`);
  await dialog.getByLabel('Beschreibung', { exact: true }).fill('Pflege und Austausch');
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: `Biotop ${info.project.name}`, exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: `Details öffnen: Biotop ${info.project.name}`, exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: 'Lena Testperson TEST-001' }).check();
  await dialog.getByRole('button', { name: 'Änderungen speichern', exact: true }).last().click();
  await page.goto('/board');
  await page.getByRole('button', { name: 'Amtszeit anlegen', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Person auswählen *', { exact: true })
    .selectOption({ label: 'Lena Testperson · TEST-001' });
  await dialog.getByLabel('Funktion *', { exact: true }).fill(`Vorstand ${info.project.name}`);
  await dialog.getByLabel('Beginn *', { exact: true }).fill('2026-01-01');
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: `Vorstand ${info.project.name}`, exact: true }),
  ).toBeVisible();
  await page.goto('/organization');
  await page.getByLabel('Ort', { exact: true }).fill('Brixen');
  await page.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await expect(page.getByText('Änderungen gespeichert.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Ort', { exact: true })).toHaveValue('Brixen');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Gemeinsam mehr bewegen.' })).toBeVisible();
  await page.screenshot({
    path: `test-results/dashboard-${info.project.name}.png`,
    fullPage: true,
  });
});
test('installs an app-shell service worker and never caches API responses', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await login(page);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).name).toBe('b*nature Vereinsplattform');
  const cached = await page.evaluate(async () => {
    const result: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) result.push(request.url);
    }
    return result;
  });
  expect(cached.some((url) => url.includes('/api/'))).toBe(false);
  expect(cached.some((url) => url.includes('index.html'))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByText('Die Daten konnten nicht geladen werden.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Die Verbindung zum Server ist fehlgeschlagen.', { exact: true }),
  ).toBeVisible();
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Gemeinsam mehr bewegen.' })).toBeVisible();
});

test('validates CSV import before writing and clears other tabs on logout', async ({
  page,
  context,
}, info) => {
  await login(page);
  await page.goto('/members');
  await page.getByRole('button', { name: 'CSV-Import', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('CSV', { exact: true }).setInputFiles({
    name: 'members.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      `firstName;lastName;membershipNumber;joinedAt\nMira;Import;IMPORT-${info.project.name};2026-01-01\nInvalid;Row;;2026-01-01`,
    ),
  });
  await expect(dialog.getByText('1 gültige Zeilen', { exact: true })).toBeVisible();
  await expect(dialog.getByText('1 fehlerhafte Zeilen', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Gültige Zeilen importieren', exact: true }).click();
  await expect(dialog.getByText('Import abgeschlossen', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Schließen / Chiudi', exact: true }).click();
  await page.getByRole('searchbox').fill(`IMPORT-${info.project.name}`);
  await expect(
    page.getByRole('cell', { name: `IMPORT-${info.project.name}`, exact: true }),
  ).toBeVisible();
  const other = await context.newPage();
  await other.goto('/members');
  await expect(other.getByRole('button', { name: 'Abmelden', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  // Wait for the login form so the next navigation cannot cancel the sign-out.
  await expect(page.getByLabel('E-Mail', { exact: true })).toBeVisible();
  await expect(other.getByRole('button', { name: 'Anmelden', exact: true })).toBeVisible();
  await expect(other.getByRole('table')).toHaveCount(0);
  await other.close();
});

test('passes automated WCAG checks on core views in both themes', async ({ page }) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  await login(page);
  const check = async () => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
  };
  await check();
  await page.goto('/members');
  await expect(page.getByRole('heading', { name: 'Mitglieder', level: 1 })).toBeVisible();
  await check();
  await page.getByRole('button', { name: 'Mitglied anlegen', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await check();
  await page.getByRole('dialog').getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Dunkel', exact: true }).click();
  await check();
  await page.getByRole('button', { name: 'Italiano', exact: true }).click();
  await check();
});

test('keeps the session visible when the server rejects sign-out', async ({ page }) => {
  await login(page);
  await page.route('**/api/auth/sign-out', (route) =>
    route.fulfill({
      status: 500,
      json: { error: { code: 'INTERNAL_ERROR', message: 'Test sign-out failure' } },
    }),
  );
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Abmelden', exact: true })).toBeVisible();
  await expect(
    page.getByText(
      'Die Abmeldung konnte nicht bestätigt werden. Bitte mit Verbindung erneut versuchen.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.unroute('**/api/auth/sign-out');
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeVisible();
});

test('loads and changes preferences when browser storage is blocked', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem'])
      Object.defineProperty(Storage.prototype, method, {
        configurable: true,
        value: () => {
          throw new DOMException('Storage unavailable', 'SecurityError');
        },
      });
  });
  await login(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Dunkel', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Italiano', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Impostazioni', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  expect(errors).toEqual([]);
});
