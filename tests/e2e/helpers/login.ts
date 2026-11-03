import { expect, type Page } from '@playwright/test';
export async function login(
  page: Page,
  email = 'e2e@example.test',
  password = 'E2E-only-Password-2026!',
) {
  await page.goto('/');
  await page.getByLabel('E-Mail', { exact: true }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  const signedIn = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/auth/sign-in/email') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  const response = await signedIn;
  expect(response.ok(), await response.text()).toBe(true);
  await expect(page.getByRole('button', { name: 'Abmelden', exact: true })).toBeVisible({
    timeout: 30_000,
  });
}
