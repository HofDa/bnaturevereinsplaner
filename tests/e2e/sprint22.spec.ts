import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('uses starter accounts, non-calendar years, transfers, project entries, dashboard and ETS exports in DE/IT', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('E-Mail', { exact: true }).fill('e2e@example.test');
  await page.getByLabel('Passwort', { exact: true }).fill('E2E-only-Password-2026!');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Abmelden', exact: true })).toBeVisible();
  await page.goto('/finance');
  await page
    .getByRole('button', { name: 'Startkategorien und Zahlungskonten einrichten', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Konten & Jahre', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Bankkonto', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Geschäftsjahr eröffnen', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Geschäftsjahr *', { exact: true }).fill('2026');
  await dialog.getByLabel('Beginn des Geschäftsjahres', { exact: true }).fill('2026-04-01');
  await dialog.getByLabel('Ende des Geschäftsjahres', { exact: true }).fill('2027-03-31');
  await dialog.getByLabel('Bankkonto (EUR)', { exact: true }).fill('500,00');
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('tab', { name: 'Überträge', exact: true }).click();
  await page.getByRole('button', { name: 'Übertrag erfassen', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Von Konto *', { exact: true }).selectOption({ label: 'Bankkonto' });
  await dialog.getByLabel('Auf Konto *', { exact: true }).selectOption({ label: 'Barkasse' });
  await dialog.getByLabel('Betrag (EUR) *', { exact: true }).fill('50,00');
  await dialog.getByLabel('Buchungsdatum *', { exact: true }).fill('2026-05-01');
  await dialog.getByLabel('Beschreibung *', { exact: true }).fill('Bargeld für Waldpflege');
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Bargeld für Waldpflege', { exact: false })).toBeVisible();
  await page.getByRole('tab', { name: 'Kassabuch', exact: true }).click();
  await page.getByRole('button', { name: 'Buchung erfassen', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Kategorie *', { exact: true })
    .selectOption({ label: 'Einnahmen · Spenden' });
  await dialog.getByLabel('Konto *', { exact: true }).selectOption({ label: 'Bankkonto' });
  await dialog.getByLabel('Betrag (EUR) *', { exact: true }).fill('30,00');
  await dialog.getByLabel('Buchungsdatum *', { exact: true }).fill('2027-02-01');
  await dialog.getByLabel('Belegdatum *', { exact: true }).fill('2027-02-01');
  await dialog.getByLabel('Beschreibung *', { exact: true }).fill('Spende Waldpflege');
  await dialog.getByLabel('Projekt', { exact: true }).fill('Waldpflege');
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Buchungshistorie: 2026/1', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Waldpflege');
  await dialog.getByRole('button', { name: /^Schließen/ }).click();
  await page.getByRole('tab', { name: 'Übersicht', exact: true }).click();
  await expect(page.locator('.stat-card').filter({ hasText: 'Gesamtbestand' })).toContainText(
    '530,00 €',
  );
  await expect(page.locator('.stat-card').filter({ hasText: 'Kasse (bar)' })).toContainText(
    '50,00 €',
  );
  await page.getByRole('tab', { name: 'Jahresabschluss', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'ETS-Jahresabschluss vorbereiten' }),
  ).toBeVisible();
  await page.getByLabel('Berichtsmodell', { exact: true }).selectOption('E');
  await expect(page.getByText(/Keine rechtliche Prüfung oder Zertifizierung/)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ETS-Tabelle herunterladen', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('bnature-ETS-E-2026.csv');
  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(a11y.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual(
    [],
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Sprache: DE', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Prepara rendiconto ETS', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Nessuna revisione o certificazione/)).toBeVisible();
  const italianDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Scarica PDF ETS', exact: true }).click();
  expect((await italianDownload).suggestedFilename()).toBe('bnature-ETS-E-2026.pdf');
  expect(errors).toEqual([]);
});
