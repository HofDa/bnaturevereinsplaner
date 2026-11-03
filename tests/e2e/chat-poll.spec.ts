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
async function a11y(page: Page) {
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
}
test('creates a poll from the chat, publishes it after confirmation and shares it', async ({
  page,
}, info) => {
  await login(page);
  await page.goto('/community?kind=chat');
  const suffix = `${info.project.name}-${Date.now()}`;
  await page
    .getByRole('button', { name: 'Umfrage oder Veranstaltung teilen', exact: true })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Umfrage erstellen' }).click();
  const editor = page.getByRole('dialog', { name: 'Umfrage erstellen' });
  await editor.getByLabel('Frage (DE)', { exact: true }).fill(`Treffpunkt ${suffix}?`);
  await editor.getByLabel('Frage (IT)', { exact: true }).fill(`Punto d'incontro ${suffix}?`);
  await editor.getByLabel('Antwort 1 (DE)', { exact: true }).fill('Parkplatz');
  await editor.getByLabel('Antwort 1 (IT)', { exact: true }).fill('Parcheggio');
  await editor.getByLabel('Antwort 2 (DE)', { exact: true }).fill('Bahnhof');
  await editor.getByLabel('Antwort 2 (IT)', { exact: true }).fill('Stazione');
  await editor.getByRole('button', { name: 'Entwurf speichern', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Umfrage veröffentlichen und teilen' });
  await expect(confirm).toContainText('Frage, Antworten und Zielgruppe sind danach fest.');
  await a11y(page);
  await confirm.getByRole('button', { name: 'Veröffentlichen und teilen', exact: true }).click();
  await expect(page.getByText('Umfrage:', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Deine Nachricht', { exact: true })).toHaveValue(
    `Treffpunkt ${suffix}?`,
  );
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  const card = page.locator('.chat-card').filter({ hasText: `Treffpunkt ${suffix}?` });
  await expect(card.getByRole('link', { name: 'Abstimmen' })).toBeVisible();
  await card.getByRole('link', { name: 'Abstimmen' }).click();
  await expect(page.getByRole('radio', { name: 'Parkplatz', exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/chat-poll-${info.project.name}.png` });
});
test('stores the e-mail digest preference in the profile', async ({ page }, info) => {
  await login(page, 'e2e-member@example.test');
  await page.goto('/profile');
  const panel = page.locator('.digest-settings');
  await expect(panel.getByRole('radio', { name: /^Aus/ })).toBeChecked();
  await panel.getByRole('radio', { name: /^Wöchentlich/ }).check();
  await expect(panel.getByText('Änderungen gespeichert.', { exact: true })).toBeVisible();
  await a11y(page);
  await panel.screenshot({ path: `test-results/profile-digest-${info.project.name}.png` });
  await page.reload();
  await expect(panel.getByRole('radio', { name: /^Wöchentlich/ })).toBeChecked();
  await panel.getByRole('radio', { name: /^Aus/ }).check();
  await expect(panel.getByText('Änderungen gespeichert.', { exact: true })).toBeVisible();
});
