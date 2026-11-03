import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test.setTimeout(90_000);
const appOrigin = `http://localhost:${process.env.E2E_WEB_PORT ?? '5174'}`;
async function login(page: Page, email = 'e2e@example.test') {
  await page.goto('/');
  await page.getByLabel('E-Mail', { exact: true }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill('E2E-only-Password-2026!');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Abmelden', exact: true })).toBeVisible();
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
test('defines extra fields and records consents and guardians for a minor', async ({
  page,
}, info) => {
  await login(page);
  const suffix = `${info.project.name}-${Date.now()}`;
  // 1. Define a club-specific choice field.
  await page.goto('/organization');
  const settings = page.locator('.member-field-settings');
  const label = `T-Shirt ${suffix}`;
  await settings.getByLabel('Bezeichnung (DE)', { exact: true }).fill(label);
  await settings.getByLabel('Bezeichnung (IT)', { exact: true }).fill(`Maglietta ${suffix}`);
  await settings.getByLabel('Art', { exact: true }).selectOption({ label: 'Auswahl' });
  await settings.getByLabel('Auswahlmöglichkeiten', { exact: true }).fill('S, M, L');
  await settings.getByRole('button', { name: 'Feld hinzufügen', exact: true }).click();
  await expect(settings.getByText(label, { exact: true })).toBeVisible();
  await a11y(page);
  // 2. A ten-year-old member.
  const birth = `${new Date().getFullYear() - 10}-06-15`;
  const created = await page.request.post('/api/v1/members', {
    headers: { Origin: appOrigin },
    data: {
      firstName: 'Kim',
      lastName: `Kind ${suffix}`,
      membershipNumber: `KID-${suffix}`,
      joinedAt: '2024-01-01',
      dateOfBirth: birth,
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  await page.goto(`/members/${id}`);
  await expect(
    page.getByText('Minderjährig: Bitte mindestens eine erziehungsberechtigte Person hinterlegen.'),
  ).toBeVisible();
  // 3. Guardian.
  await page.getByRole('button', { name: 'Person hinzufügen', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Anna Kind');
  await dialog.getByLabel('Beziehung', { exact: true }).fill('Mutter');
  await dialog.getByLabel('E-Mail', { exact: true }).fill('anna.kind@example.test');
  await dialog.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Anna Kind', { exact: true })).toBeVisible();
  await expect(page.getByText(/Minderjährig: Bitte/)).not.toBeVisible();
  // 4. Photo consent declared by the guardian (pre-filled).
  await page
    .getByRole('button', { name: 'Erklärung erfassen: Fotos und Veröffentlichung' })
    .click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Erklärt durch', { exact: true })).toHaveValue('Anna Kind');
  await dialog.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const photos = page.locator('.consent-list li').filter({ hasText: 'Fotos und Veröffentlichung' });
  await expect(photos).toContainText('Erteilt');
  await expect(photos).toContainText('durch Anna Kind');
  // ...and its withdrawal, which keeps the history.
  await page
    .getByRole('button', { name: 'Erklärung erfassen: Fotos und Veröffentlichung' })
    .click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Erklärung', { exact: true })
    .selectOption({ label: 'Verweigert oder widerrufen' });
  await dialog.getByLabel('Notiz', { exact: true }).fill('Widerruf per E-Mail');
  await dialog.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(photos).toContainText('Verweigert oder widerrufen');
  await page.getByText('Verlauf (2 Einträge)', { exact: true }).click();
  await expect(page.getByText(/Widerruf per E-Mail/)).toBeVisible();
  // 5. Extra field value.
  const fieldsPanel = page.locator('.detail-panel').filter({ hasText: 'Zusatzangaben' });
  await fieldsPanel.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(label, { exact: true }).selectOption('M');
  await dialog.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(fieldsPanel.locator('dd').filter({ hasText: /^M$/ })).toBeVisible();
  await a11y(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `test-results/member-extras-${info.project.name}.png`,
    fullPage: true,
  });
});
