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
test('admin creates fees; treasurer allocates partial and complete payments with real PDFs', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await page.goto('/finance');
  await expect(page.getByRole('heading', { name: 'Finanzen', level: 1 })).toBeVisible();
  await page.getByRole('tab', { name: 'Beitragstarife', exact: true }).click();
  await page.getByRole('button', { name: 'Tarif anlegen', exact: true }).click();
  let dialog = page.getByRole('dialog');
  const tariff = `Jahresbeitrag ${info.project.name}`;
  await dialog.getByLabel('Tarifname *', { exact: true }).fill(tariff);
  await dialog.getByLabel('Betrag (EUR) *', { exact: true }).fill('50,00');
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page.getByRole('cell', { name: tariff, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  // Wait for the login form so the next navigation cannot cancel the sign-out.
  await expect(page.getByLabel('E-Mail', { exact: true })).toBeVisible();
  await login(page, 'e2e-treasurer@example.test');
  await page.goto('/finance');
  await page.getByRole('tab', { name: 'Beitragstarife', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tarif anlegen', exact: true })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: tariff, exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Forderungen', exact: true }).click();
  for (const year of ['2026', '2027']) {
    await page.getByRole('button', { name: 'Forderung anlegen', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog
      .getByLabel('Mitglied *', { exact: true })
      .selectOption({ label: 'Lena Testperson · TEST-001' });
    await dialog
      .getByLabel('Beitragstarif *', { exact: true })
      .selectOption({ label: `${tariff} · 50,00 € · Jährlich` });
    await dialog.getByLabel('Beitragsjahr *', { exact: true }).fill(year);
    await dialog.getByLabel('Fälligkeit *', { exact: true }).fill('2020-01-01');
    await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  }
  await page.getByRole('tab', { name: 'Zahlungen', exact: true }).click();
  await page.getByRole('button', { name: 'Zahlung erfassen', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Zahlende Person *', { exact: true }).fill('Familie E2E');
  await dialog.getByLabel('Zahlungsdatum *', { exact: true }).fill('2026-10-29');
  await dialog
    .getByLabel('Forderung auswählen 1', { exact: true })
    .selectOption({ label: `Lena Testperson · ${tariff} · 2026 · 50,00 €` });
  await dialog.getByLabel('Zugeordneter Betrag (EUR) 1', { exact: true }).fill('20,00');
  await dialog.getByRole('button', { name: 'Weitere Forderung zuordnen', exact: true }).click();
  await dialog
    .getByLabel('Forderung auswählen 2', { exact: true })
    .selectOption({ label: `Lena Testperson · ${tariff} · 2027 · 50,00 €` });
  await dialog.getByLabel('Zugeordneter Betrag (EUR) 2', { exact: true }).fill('10,00');
  await expect(dialog.getByText('30,00 €', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('tab', { name: 'Forderungen', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: tariff });
  await expect(row.getByText('Teilbezahlt', { exact: true })).toBeVisible();
  await expect(row.getByText('30,00 €', { exact: true })).toBeVisible();
  const reminderDownload = page.waitForEvent('download');
  await row.getByRole('button', { name: /Erinnerung vorbereiten/ }).click();
  expect((await reminderDownload).suggestedFilename()).toMatch(/^bnature-reminder-.*\.pdf$/);
  await expect(
    page.getByText('Erinnerungsentwurf vorbereitet. Er wird nicht automatisch versendet.', {
      exact: true,
    }),
  ).toBeVisible();
  await row.getByRole('button', { name: 'Zahlung erfassen', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Zahlungsdatum *', { exact: true }).fill('2026-10-29');
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const receiptDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF-Zahlungsbestätigung', exact: true }).first().click();
  expect((await receiptDownload).suggestedFilename()).toMatch(/^bnature-payment-.*\.pdf$/);
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV exportieren', exact: true }).click();
  expect((await csvDownload).suggestedFilename()).toBe('bnature-payments.csv');
  await page.getByRole('tab', { name: 'Forderungen', exact: true }).click();
  await expect(
    page.getByRole('row').filter({ hasText: tariff }).getByText('Bezahlt', { exact: true }),
  ).toBeVisible();
  // Batch claims for every active member: preview first, then confirm once.
  await page.getByRole('button', { name: 'Sammelvorschreibung', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Sammelvorschreibung' });
  await dialog
    .getByLabel('Beitragstarif', { exact: true })
    .selectOption({ label: `${tariff} · 50,00 €` });
  await dialog.getByLabel('Beitragsjahr', { exact: true }).fill('2028');
  await dialog.getByLabel('Fälligkeit', { exact: true }).fill('2028-03-31');
  await dialog.getByRole('button', { name: 'Vorschau anzeigen', exact: true }).click();
  const previewed = dialog.getByRole('region', { name: 'Vorschau der Sammelvorschreibung' });
  await expect(previewed.getByRole('cell', { name: 'Lena Testperson', exact: true })).toBeVisible();
  await expect(previewed).toContainText(/\d+ Forderung(en)? über insgesamt/);
  await checkAccessibility(page);
  await dialog.getByRole('button', { name: /^\d+ Forderung(en)? anlegen$/ }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(/^\d+ Forderung(en)? angelegt\.$/)).toBeVisible();
  await page.getByRole('button', { name: 'Sammelvorschreibung', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Sammelvorschreibung' });
  await dialog
    .getByLabel('Beitragstarif', { exact: true })
    .selectOption({ label: `${tariff} · 50,00 €` });
  await dialog.getByLabel('Beitragsjahr', { exact: true }).fill('2028');
  await dialog.getByLabel('Fälligkeit', { exact: true }).fill('2028-03-31');
  await dialog.getByRole('button', { name: 'Vorschau anzeigen', exact: true }).click();
  await expect(
    dialog.getByText('Für diese Auswahl sind keine neuen Forderungen anzulegen.', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await checkAccessibility(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: `test-results/finance-${info.project.name}.png`, fullPage: true });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Dunkel', exact: true }).click();
  await page.getByRole('button', { name: 'Italiano', exact: true }).click();
  await page.goto('/finance');
  await expect(page.getByRole('heading', { name: 'Finanze', level: 1 })).toBeVisible();
  await page.getByRole('tab', { name: 'Pagamenti', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Conferma di pagamento PDF', exact: true }).first(),
  ).toBeVisible();
  await checkAccessibility(page);
  await page.getByRole('tab', { name: 'Quote dovute', exact: true }).click();
  await page.getByRole('button', { name: 'Crea quota dovuta', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Socio *', { exact: true })).toBeVisible();
  await checkAccessibility(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Annulla', exact: true }).click();
  expect(errors).toEqual([]);
});
test('ordinary members and board cannot discover or open finance views', async ({ page }) => {
  for (const email of ['e2e-member@example.test', 'e2e-board@example.test']) {
    await login(page, email);
    await expect(page.getByRole('link', { name: 'Finanzen', exact: true })).toHaveCount(0);
    await page.goto('/finance');
    await expect(
      page.getByText('Für diese Ansicht fehlt Ihnen die Berechtigung.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Finanzen', exact: true })).toHaveCount(0);
    const response = await page.request.get('/api/v1/payments');
    expect(response.status()).toBe(403);
    await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
    // Wait for the login form so the next navigation cannot cancel the sign-out.
    await expect(page.getByLabel('E-Mail', { exact: true })).toBeVisible();
  }
});
