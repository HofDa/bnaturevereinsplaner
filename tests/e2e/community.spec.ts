import { login } from './helpers/login';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const appOrigin = `http://localhost:${process.env.E2E_WEB_PORT ?? '5174'}`;
test.setTimeout(120_000);
const password = 'E2E-only-Password-2026!';
async function post<T>(
  page: Page,
  path: string,
  data: unknown,
  method: 'POST' | 'PUT' = 'POST',
): Promise<T> {
  const r = await page.request.fetch(`/api/v1${path}`, {
    method,
    headers: { Origin: appOrigin, 'Idempotency-Key': crypto.randomUUID() },
    data,
  });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
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
test('publishes bilingual news as a separate step and displays plain text to members', async ({
  page,
}, info) => {
  await login(page);
  await page.goto('/community');
  await page.getByRole('button', { name: 'News erstellen', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'News erstellen' });
  await editor
    .getByLabel('Titel (DE)', { exact: true })
    .fill(`Vereinsnachricht ${info.project.name}`);
  await editor.getByLabel('Titel (IT)', { exact: true }).fill('Notizia associativa');
  await editor
    .getByLabel('Nachricht (DE)', { exact: true })
    .fill('Gemeinsam für die Natur.\n<script>window.communityXss=true</script>');
  await editor.getByLabel('Nachricht (IT)', { exact: true }).fill('Insieme per la natura.');
  await a11y(page);
  await editor.getByRole('button', { name: 'Entwurf speichern', exact: true }).click();
  await expect(page).toHaveURL(/\/community\/[0-9a-f-]+$/);
  const url = page.url();
  await expect(page.getByText('Entwurf', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Veröffentlichen', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Veröffentlichen' })
    .getByRole('button', { name: 'Bestätigen', exact: true })
    .click();
  await expect(page.getByText('Entwurf', { exact: true })).not.toBeVisible();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  const bdaySuffix = `${info.project.name}-${Date.now()}`;
  await post(page, '/members', {
    firstName: 'Greta',
    lastName: `Geburtstag ${bdaySuffix}`,
    membershipNumber: `BDAY-${bdaySuffix}`,
    joinedAt: '2020-01-01',
    dateOfBirth: `1996${today.slice(4)}`,
  });
  await page.goto('/');
  const card = page.locator('.occasions-panel');
  await expect(card.getByRole('heading', { name: 'Geburtstage und Jubiläen' })).toBeVisible();
  const row = card.getByRole('listitem').filter({ hasText: `Geburtstag ${bdaySuffix}` });
  await expect(row).toContainText('wird 30 Jahre alt');
  await expect(row).toContainText('heute');
  await a11y(page);
  await card.screenshot({ path: `test-results/dashboard-occasions-${info.project.name}.png` });
  await row.getByRole('link', { name: /Im Vereinschat gratulieren/ }).click();
  await expect(page.getByRole('tab', { name: /Vereinschat/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel('Deine Nachricht', { exact: true })).toHaveValue(
    'Alles Gute zum Geburtstag, Greta! 🎉',
  );
  await expect(page).not.toHaveURL(/draft=/);
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await login(page, 'e2e-member@example.test');
  await page.goto(url);
  await expect(
    page.getByRole('heading', { name: `Vereinsnachricht ${info.project.name}`, exact: true }),
  ).toBeVisible();
  await expect(page.locator('.community-body')).toContainText('<script>');
  expect(
    await page.evaluate(() => Boolean((window as unknown as Record<string, unknown>).communityXss)),
  ).toBe(false);
  await expect(page.getByRole('button', { name: 'Bearbeiten', exact: true })).not.toBeVisible();
  await a11y(page);
  await page.getByRole('button', { name: /Sprache:/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Notizia associativa', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.community-body')).toHaveText('Insieme per la natura.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `test-results/community-news-${info.project.name}.png`,
    fullPage: true,
  });
});
test('lets members vote, change their answer and see the final results after closing', async ({
  page,
  browser,
}, info) => {
  await login(page);
  await page.goto('/community?kind=poll');
  await page.getByRole('button', { name: 'Abstimmung erstellen', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Abstimmung erstellen' });
  await editor.getByLabel('Frage (DE)', { exact: true }).fill('Welcher Tag passt?');
  await editor.getByLabel('Frage (IT)', { exact: true }).fill('Quale giorno preferisci?');
  await editor.getByLabel('Beschreibung (DE)', { exact: true }).fill('Gemeinsam entscheiden.');
  await editor.getByLabel('Beschreibung (IT)', { exact: true }).fill('Decidiamo insieme.');
  await editor.getByLabel('Antwort 1 (DE)', { exact: true }).fill('Samstag');
  await editor.getByLabel('Antwort 1 (IT)', { exact: true }).fill('Sabato');
  await editor.getByLabel('Antwort 2 (DE)', { exact: true }).fill('Sonntag');
  await editor.getByLabel('Antwort 2 (IT)', { exact: true }).fill('Domenica');
  await editor.getByRole('button', { name: 'Entwurf speichern', exact: true }).click();
  await expect(page).toHaveURL(/\/community\/[0-9a-f-]+$/);
  const url = page.url();
  await page.getByRole('button', { name: 'Veröffentlichen', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Bestätigen', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await login(page, 'e2e-member@example.test');
  await page.goto(url);
  await expect(page.getByText(/Die Ergebnisse werden nach deiner Abstimmung/)).toBeVisible();
  await page.getByRole('radio', { name: 'Samstag', exact: true }).check();
  await page.getByRole('button', { name: 'Stimme abgeben', exact: true }).click();
  await expect(page.getByText('Abgegebene Stimmen insgesamt: 1', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Sonntag', exact: true }).check();
  await page.getByRole('button', { name: 'Stimme ändern', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Sonntag', exact: true })).toBeChecked();
  await expect(page.getByText('Abgegebene Stimmen insgesamt: 1', { exact: true })).toBeVisible();
  await a11y(page);
  const adminContext = await browser.newContext({ baseURL: appOrigin });
  try {
    const admin = await adminContext.newPage();
    await login(admin);
    await admin.goto(url);
    await admin.getByRole('button', { name: 'Abstimmung schließen', exact: true }).click();
    await admin
      .getByRole('dialog')
      .getByRole('button', { name: 'Bestätigen', exact: true })
      .click();
    await expect(admin.getByRole('dialog')).not.toBeVisible();
  } finally {
    await adminContext.close();
  }
  await page.reload();
  await expect(page.getByText('Abgeschlossen', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByText('Abgegebene Stimmen insgesamt: 1', { exact: true })).toBeVisible();
  await a11y(page);
  await page.screenshot({
    path: `test-results/community-poll-${info.project.name}.png`,
    fullPage: true,
  });
});
