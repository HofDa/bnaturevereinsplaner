import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
async function login(page: Page, email = 'e2e@example.test') {
  await page.goto('/');
  await page.getByLabel('E-Mail', { exact: true }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill('E2E-only-Password-2026!');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Abmelden', exact: true })).toBeVisible();
}
async function checkAccessibility(page: Page) {
  const report = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(report.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual(
    [],
  );
}
async function noHorizontalScroll(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).click();
test('sets up the ledger, books, reverses, reports and closes a fiscal year', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await page.goto('/finance');
  await tab(page, 'Kassabuch');
  await expect(page.getByText('Kein Geschäftsjahr eröffnet', { exact: true })).toBeVisible();

  await tab(page, 'Konten & Jahre');
  for (const [name, kind] of [
    ['Handkasse', 'Kasse (bar)'],
    ['Vereinskonto', 'Bankkonto'],
  ]) {
    await page.getByRole('button', { name: 'Konto anlegen', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name *', { exact: true }).fill(name!);
    await dialog.getByLabel('Kontoart', { exact: true }).selectOption({ label: kind! });
    await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  }
  for (const [name, direction, classification] of [
    ['Mitgliedsbeiträge', 'Einnahmen', 'Mitgliedsbeiträge'],
    ['Bürobedarf', 'Ausgaben', 'Sonstige'],
  ]) {
    await page.getByRole('button', { name: 'Kategorie anlegen', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name *', { exact: true }).fill(name!);
    await dialog.getByLabel('Richtung', { exact: true }).selectOption({ label: direction! });
    await dialog
      .getByLabel('Klassifizierung', { exact: true })
      .selectOption({ label: classification! });
    await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  }
  await page.getByRole('button', { name: 'Geschäftsjahr eröffnen', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Geschäftsjahr *', { exact: true }).fill('2026');
  await dialog.getByLabel('Handkasse (EUR)', { exact: true }).fill('100,00');
  await dialog.getByLabel('Vereinskonto (EUR)', { exact: true }).fill('-20,00');
  await checkAccessibility(page);
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const yearRow = page.getByRole('row').filter({ hasText: '2026' });
  await expect(yearRow.getByText('Offen', { exact: true })).toBeVisible();
  await expect(yearRow).toContainText('100,00 € →');
  await checkAccessibility(page);
  await noHorizontalScroll(page);

  await tab(page, 'Kassabuch');
  for (const [amount, text] of [
    ['12,50', 'Druckerpapier'],
    ['5,00', 'Fehlbuchung Porto'],
  ]) {
    await page.getByRole('button', { name: 'Buchung erfassen', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog
      .getByLabel('Kategorie *', { exact: true })
      .selectOption({ label: 'Ausgaben · Bürobedarf' });
    await dialog.getByLabel('Konto *', { exact: true }).selectOption({ label: 'Handkasse' });
    await dialog.getByLabel('Betrag (EUR) *', { exact: true }).fill(amount!);
    await dialog.getByLabel('Buchungsdatum *', { exact: true }).fill('2026-03-01');
    await dialog.getByLabel('Belegdatum *', { exact: true }).fill('2026-02-28');
    await dialog.getByLabel('Beschreibung *', { exact: true }).fill(text!);
    await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  }
  await expect(page.getByRole('row').filter({ hasText: 'Druckerpapier' })).toContainText(
    '− 12,50 €',
  );
  await page.getByRole('button', { name: /^Buchung stornieren: 2026\/2$/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Stornodatum *', { exact: true }).fill('2026-03-02');
  await dialog.getByLabel('Begründung *', { exact: true }).fill('Doppelt erfasst');
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Stornobuchung gespeichert.', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('row').filter({ hasText: 'Storno 2026/2' }).getByText('Storno', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /^Buchung stornieren: 2026\/2$/ })).toHaveCount(0);
  await checkAccessibility(page);
  await noHorizontalScroll(page);
  await page.getByRole('button', { name: 'Belege: 2026/1', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Zu dieser Buchung ist noch kein Beleg abgelegt.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Beleg hochladen', exact: true }).click();
  await dialog.getByLabel('Datei *', { exact: true }).setInputFiles({
    name: 'quittung-papier.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% Quittung\n%%EOF\n'),
  });
  await expect(dialog.getByLabel('Titel *', { exact: true })).toHaveValue('Druckerpapier');
  await checkAccessibility(page);
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(dialog.getByRole('row').filter({ hasText: 'quittung-papier.pdf' })).toBeVisible();
  await dialog.getByRole('button', { name: /^Schließen/ }).click();
  await expect(dialog).not.toBeVisible();
  const csv = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV exportieren', exact: true }).click();
  expect((await csv).suggestedFilename()).toBe('bnature-cashbook-2026.csv');

  await tab(page, 'Beitragstarife');
  await page.getByRole('button', { name: 'Tarif anlegen', exact: true }).click();
  dialog = page.getByRole('dialog');
  const tariff = `Kassabuch ${info.project.name}`;
  await dialog.getByLabel('Tarifname *', { exact: true }).fill(tariff);
  await dialog.getByLabel('Betrag (EUR) *', { exact: true }).fill('50,00');
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await tab(page, 'Forderungen');
  await page.getByRole('button', { name: 'Forderung anlegen', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Mitglied *', { exact: true })
    .selectOption({ label: 'Lena Testperson · TEST-001' });
  await dialog
    .getByLabel('Beitragstarif *', { exact: true })
    .selectOption({ label: `${tariff} · 50,00 € · Jährlich` });
  await dialog.getByLabel('Beitragsjahr *', { exact: true }).fill('2026');
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  for (let attempt = 0; attempt < 2; attempt++) {
    await tab(page, 'Forderungen');
    await page
      .getByRole('row')
      .filter({ hasText: tariff })
      .getByRole('button', { name: 'Zahlung erfassen', exact: true })
      .click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Zahlungsdatum *', { exact: true }).fill('2026-10-29');
    await dialog.getByLabel('Konto', { exact: true }).selectOption({ label: 'Handkasse' });
    await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    if (attempt === 1) break;
    await page.getByRole('button', { name: 'Zahlungsdetails: BN-000001', exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Verbucht', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Zahlung stornieren', exact: true }).click();
    await dialog.getByLabel('Stornodatum *', { exact: true }).fill('2026-10-30');
    await dialog.getByLabel('Begründung *', { exact: true }).fill('Falsche Person');
    await checkAccessibility(page);
    await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText('Zahlung storniert.', { exact: true })).toBeVisible();
    await tab(page, 'Zahlungen');
    await expect(
      page
        .getByRole('row')
        .filter({ hasText: 'BN-000001' })
        .getByText('Storniert', { exact: true }),
    ).toBeVisible();
  }
  await tab(page, 'Forderungen');
  await expect(
    page.getByRole('row').filter({ hasText: tariff }).getByText('Bezahlt', { exact: true }),
  ).toBeVisible();

  await tab(page, 'Jahresabschluss');
  const summary = page.getByRole('region', { name: 'Jahresübersicht' });
  await expect(summary.getByRole('article').filter({ hasText: 'Ergebnis' })).toContainText(
    '37,50 €',
  );
  await expect(summary.getByRole('article').filter({ hasText: 'Mitgliedsbeiträge' })).toContainText(
    '50,00 €',
  );
  await expect(
    page.getByText('Das Geschäftsjahr ist noch offen; die Werte sind vorläufig.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Vorlage anlegen', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name *', { exact: true }).fill('Vereinsgliederung');
  await dialog.getByLabel('Schwellenwert Einnahmen (EUR, optional)', { exact: true }).fill('40,00');
  await dialog.getByLabel('Code 1', { exact: true }).fill('A1');
  await dialog.getByLabel('Bezeichnung 1', { exact: true }).fill('Quote associative');
  await dialog
    .getByRole('group', { name: 'Kategorien 1', exact: true })
    .getByLabel('Mitgliedsbeiträge', { exact: true })
    .check();
  await checkAccessibility(page);
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole('combobox', { name: 'Berichtsvorlage', exact: true })
    .selectOption({ label: 'Vereinsgliederung · v1' });
  await expect(page.getByText(/überschreiten den Schwellenwert von 40,00 €/)).toBeVisible();
  await expect(page.getByText(/ohne Zeile in der Vorlage: Bürobedarf/)).toBeVisible();
  const pdf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF-Bericht', exact: true }).click();
  expect((await pdf).suggestedFilename()).toBe('bnature-report-2026.pdf');
  await checkAccessibility(page);
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/ledger-${info.project.name}.png`, fullPage: true });

  await tab(page, 'Konten & Jahre');
  await page.getByRole('button', { name: 'Jahr abschließen 2026', exact: true }).click();
  dialog = page.getByRole('dialog');
  await checkAccessibility(page);
  await dialog.getByRole('button', { name: '2026 endgültig abschließen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('row').filter({ hasText: '2026' }).getByText('Geschlossen', { exact: true }),
  ).toBeVisible();
  await tab(page, 'Kassabuch');
  await expect(page.getByRole('button', { name: 'Buchung erfassen', exact: true })).toBeDisabled();

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Dunkel', exact: true }).click();
  await page.getByRole('button', { name: 'Italiano', exact: true }).click();
  await page.goto('/finance');
  await tab(page, 'Rendiconto annuale');
  await expect(
    page.getByRole('heading', { name: 'Modelli di rendiconto', level: 2 }),
  ).toBeVisible();
  await checkAccessibility(page);
  await tab(page, 'Conti ed esercizi');
  await expect(page.getByText('Chiuso', { exact: true }).first()).toBeVisible();
  await checkAccessibility(page);
  expect(errors).toEqual([]);
});
test('treasurer manages the ledger but cannot close fiscal years', async ({ page }) => {
  await login(page, 'e2e-treasurer@example.test');
  await page.goto('/finance');
  await tab(page, 'Konten & Jahre');
  await expect(page.getByRole('button', { name: 'Konto anlegen', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Jahr abschließen/ })).toHaveCount(0);
  const response = await page.request.post('/api/v1/finance/fiscal-years/2030/close', {
    headers: { 'Idempotency-Key': crypto.randomUUID(), Origin: new URL(page.url()).origin },
    data: { confirm: true },
  });
  expect(response.status()).toBe(403);
});
