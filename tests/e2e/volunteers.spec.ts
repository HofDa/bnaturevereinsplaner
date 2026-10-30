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
const pdf = (name: string) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from(`%PDF-1.4\n${name}\n%%EOF`),
});

test('registers a member as volunteer, keeps the register, insurance, hours and deadlines in DE/IT', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page);
  await page.goto('/volunteers');
  await expect(page.getByRole('heading', { name: 'Freiwillige', exact: true })).toBeVisible();
  await expect(page.getByText('Aktive regelmäßige Freiwillige')).toBeVisible();
  await a11y(page);

  await page.goto('/volunteers/list');
  await page.getByRole('button', { name: 'Freiwillige Person registrieren' }).click();
  const form = dialog(page);
  await form
    .getByRole('combobox', { name: /^Person/ })
    .selectOption({ label: 'Lena Testperson · Mitglied' });
  await form.getByLabel(/^Eintritt/).fill('2026-01-15');
  await form.getByLabel('Tätigkeitsschwerpunkte').fill('Biotoppflege, Umweltbildung');
  await form.getByLabel('Steuernummer').fill('TSTLNE90A41A952X');
  await form.getByLabel('Straße und Hausnummer').fill('Domplatz 1');
  await form.getByLabel('Ort', { exact: true }).fill('Brixen');
  await form.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByRole('heading', { name: 'Lena Testperson' })).toBeVisible();
  await expect(page.getByText('Aufnahme ausstehend').first()).toBeVisible();
  await expect(page.getByText('Keine Zuordnung').first()).toBeVisible();
  await a11y(page);

  await page.goto('/volunteers/register');
  await expect(page.getByText('Ausstehende Registervorgänge')).toBeVisible();
  await page.getByRole('button', { name: 'Eintragen' }).click();
  await expect(page.getByText('Eingetragene Personen (1)')).toBeVisible();
  await expect(page.getByText(/Hash-Kette geprüft: 1 Einträge/)).toBeVisible();
  await page.getByRole('button', { name: 'Registerdaten prüfen' }).click();
  await expect(page.getByText(/Bereit: 1 regelmäßige/)).toBeVisible();
  await page.getByRole('button', { name: 'Registerstand festschreiben' }).click();
  await expect(page.getByText('Signatur ausstehend', { exact: true })).toBeVisible();
  await expect(page.getByText('Rechtliche Freigabe des Verfahrens ausstehend')).toBeVisible();
  await expect(page.getByText(/zertifiziert/i)).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF' }).click();
  expect((await download).suggestedFilename()).toMatch(/^register-1-snapshot\.pdf$/);
  await a11y(page);

  await page.goto('/volunteers/insurance');
  await page.getByRole('button', { name: 'Police erfassen' }).click();
  await dialog(page)
    .getByLabel(/^Versicherer/)
    .fill('Versicherung Südtirol');
  await dialog(page)
    .getByLabel(/^Policennummer/)
    .fill('FW-2026');
  await dialog(page)
    .getByLabel(/^Beginn/)
    .fill('2026-01-01');
  await dialog(page).getByLabel(/^Ende/).fill('2026-12-31');
  await dialog(page).getByRole('button', { name: 'Speichern' }).click();
  await page.getByRole('button', { name: 'Öffnen' }).click();
  const policy = dialog(page);
  await policy
    .locator('label', { hasText: 'Policendokument hochladen' })
    .locator('input')
    .setInputFiles(pdf('police.pdf'));
  await expect(policy.getByRole('button', { name: 'police.pdf' })).toBeVisible();
  await policy.getByRole('button', { name: 'Personen zuordnen' }).click();
  const assign = page.getByRole('dialog', { name: 'Personen zuordnen' });
  await assign.getByLabel(/Lena Testperson/).check();
  await assign.getByLabel(/^Zugeordnet ab/).fill('2026-01-15');
  await assign.getByRole('button', { name: 'Speichern' }).click();
  await expect(policy.getByRole('cell', { name: /Lena Testperson/ })).toBeVisible();
  await policy.getByRole('button', { name: 'Meldung dokumentieren' }).click();
  const notify = page.getByRole('dialog', { name: 'Meldung dokumentieren' });
  await notify.getByLabel(/^Übermittlungsweg/).fill('PEC');
  await notify.getByRole('button', { name: 'Speichern' }).click();
  await expect(policy.getByText(/PEC · 1 Personen/)).toBeVisible();
  await policy.getByRole('button', { name: /Schließen/ }).click();
  await expect(page.getByText('Zeitlich möglicherweise gedeckt').first()).toBeVisible();
  await expect(page.getByText(/keinen rechtsverbindlichen Versicherungsschutz/)).toBeVisible();
  await a11y(page);

  await page.goto('/volunteers/hours');
  await page.getByRole('button', { name: 'Zeit erfassen' }).click();
  const time = dialog(page);
  await time.getByLabel(/^Freiwillige Person/).selectOption({ label: 'Lena Testperson' });
  await time.getByLabel(/^Beginn/).fill('2026-05-02T08:00');
  await time.getByLabel(/^Ende/).fill('2026-05-02T11:00');
  await time.getByLabel('Pause (Minuten)').fill('30');
  await time.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('td').getByText('Eingereicht', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bestätigen' }).click();
  await expect(page.locator('td').getByText('2:30 h')).toBeVisible();
  await expect(page.locator('.totals-row')).toContainText('Bestätigte Stunden: 2:30 h');
  await a11y(page);

  await page.goto('/compliance');
  await page.getByRole('tab', { name: 'Fristregeln' }).click();
  const initialized = page.waitForResponse((r) =>
    r.url().endsWith('/api/v1/compliance-rules/initialize'),
  );
  await page.getByRole('button', { name: 'Startregeln einrichten' }).click();
  expect((await initialized).status()).toBe(200);
  await expect(page.getByText('RUNTS: Hinterlegung Jahresabschluss')).toBeVisible();
  await expect(page.getByText('fachliche Prüfung erforderlich').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Fristen', exact: true }).click();
  await page.getByRole('button', { name: 'Fristen berechnen' }).click();
  await dialog(page).getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText(/neue Fristen/)).toBeVisible();
  await page.getByRole('button', { name: /Freiwilligenversicherung: Laufzeitende/ }).click();
  const deadline = dialog(page);
  await expect(deadline.getByRole('button', { name: 'Als erledigt markieren' })).toBeDisabled();
  await deadline.getByRole('button', { name: 'Referenz als Nachweis' }).click();
  await page
    .getByRole('dialog', { name: 'Referenz als Nachweis' })
    .getByLabel(/^Referenz/)
    .fill('Verlängerungsangebot 2027');
  await page
    .getByRole('dialog', { name: 'Referenz als Nachweis' })
    .getByRole('button', { name: 'Speichern' })
    .click();
  await expect(deadline.getByText(/Verlängerungsangebot 2027/).first()).toBeVisible();
  await deadline.getByRole('button', { name: 'Als erledigt markieren' }).click();
  await page
    .getByRole('dialog', { name: 'Als erledigt markieren' })
    .getByLabel('Protokollnummer')
    .fill('P-17');
  await page
    .getByRole('dialog', { name: 'Als erledigt markieren' })
    .getByRole('button', { name: 'Speichern' })
    .click();
  await page.getByLabel('Status').selectOption('done');
  await expect(page.locator('td').getByText('Erledigt', { exact: true }).first()).toBeVisible();
  await a11y(page);

  await page.getByRole('button', { name: /Sprache/ }).click();
  await expect(page.getByRole('heading', { name: 'Compliance e scadenze' })).toBeVisible();
  await page.goto('/volunteers/register');
  await expect(page.getByRole('heading', { name: 'Registro', exact: true })).toBeVisible();
  await expect(page.getByText('Firma in attesa', { exact: true })).toBeVisible();
  await page.goto('/volunteers/list');
  await expect(page.getByRole('cell', { name: 'Non occasionale' })).toBeVisible();
  await a11y(page);
});

test('limits volunteer data by role', async ({ page }) => {
  await login(page, 'e2e-treasurer@example.test');
  await page.goto('/volunteers');
  await expect(page.getByRole('heading', { name: 'Freiwillige', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Register', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Versicherungen', exact: true })).toBeVisible();
  expect((await page.request.get('/api/v1/volunteer-register')).status()).toBe(403);
  await page.goto('/volunteers/register');
  await expect(page.getByText('Für diese Ansicht fehlt Ihnen die Berechtigung.')).toBeVisible();
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await login(page, 'e2e-member@example.test');
  await expect(page.getByRole('link', { name: 'Freiwillige' })).toHaveCount(0);
  expect((await page.request.get('/api/v1/volunteers')).status()).toBe(403);
  expect((await page.request.get('/api/v1/compliance-deadlines')).status()).toBe(403);
});
