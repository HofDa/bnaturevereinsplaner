import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test.setTimeout(120_000);
const password = 'E2E-only-Password-2026!';
const appOrigin = `http://localhost:${process.env.E2E_WEB_PORT ?? '5174'}`;
async function login(page: Page, email = 'e2e@example.test', pass = password) {
  await page.goto('/');
  await page.getByLabel('E-Mail', { exact: true }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(pass);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Abmelden', exact: true })).toBeVisible();
}
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
async function publish(page: Page, id: string) {
  const data = await (await page.request.get(`/api/v1/community/posts/${id}`)).json();
  await post(page, `/community/posts/${id}/publish`, { version: data.version });
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
  await page.getByRole('button', { name: 'Umfrage erstellen', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Umfrage erstellen' });
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
    await admin.getByRole('button', { name: 'Umfrage schließen', exact: true }).click();
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
test('shows group news and chat only to assigned users and supports live moderation', async ({
  page,
  browser,
}, info) => {
  await login(page);
  const suffix = `${info.project.name}-${Date.now()}`;
  const email = `community-${suffix}@example.test`;
  const member = await post<{ personId: string }>(page, '/members', {
    firstName: 'Lena',
    lastName: 'Chat-Test',
    email,
    membershipNumber: `CHAT-${suffix}`,
    joinedAt: '2020-01-01',
  });
  await post(page, '/users', {
    name: 'Lena Chat-Test',
    email,
    password,
    role: 'member',
    personId: member.personId,
  });
  const group = await post<{ id: string }>(page, '/groups', { name: `Waldgruppe ${suffix}` });
  await post(page, `/groups/${group.id}/members`, { personIds: [member.personId] }, 'PUT');
  const news = await post<{ id: string }>(page, '/community/posts', {
    kind: 'news',
    groupId: group.id,
    titleI18n: { de: 'Waldgruppen-News', it: 'Notizie del gruppo bosco' },
    bodyI18n: { de: 'Nur für unsere Waldgruppe.', it: 'Solo per il nostro gruppo.' },
  });
  await publish(page, news.id);
  await post(page, '/community/chat', { groupId: group.id, body: 'Willkommen im Gruppenchat!' });
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await login(page, email);
  await page.goto(`/community?groupId=${group.id}`);
  await expect(page.getByRole('link', { name: 'Waldgruppen-News', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Vereinschat', exact: true }).click();
  await expect(page.getByText('Willkommen im Gruppenchat!', { exact: true })).toBeVisible();
  await page.getByLabel('Deine Nachricht', { exact: true }).fill('Hallo aus dem Browser!');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(page.getByText('Hallo aus dem Browser!', { exact: true })).toHaveCount(1);
  await page.getByLabel('Deine Nachricht', { exact: true }).fill('Hallo aus dem Browser!');
  await page.getByLabel('Deine Nachricht', { exact: true }).press('Control+Enter');
  await expect(page.getByText('Hallo aus dem Browser!', { exact: true })).toHaveCount(2);
  const compose = page.getByLabel('Deine Nachricht', { exact: true });
  await compose.fill('Ab in den Wald');
  await page.getByRole('button', { name: 'Emoji einfügen', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Emoji einfügen' })).toBeInViewport({ ratio: 0.5 });
  await page.screenshot({ path: `test-results/community-emoji-${info.project.name}.png` });
  await page
    .getByRole('group', { name: 'Emoji einfügen' })
    .getByRole('button', { name: '🌲', exact: true })
    .click();
  await expect(compose).toHaveValue('Ab in den Wald🌲');
  await expect(compose).toBeFocused();
  await compose.press('Escape');
  await expect(page.getByRole('group', { name: 'Emoji einfügen' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(page.getByText('Ab in den Wald🌲', { exact: true })).toBeVisible();
  const welcome = page
    .locator('.community-chat-message')
    .filter({ hasText: 'Willkommen im Gruppenchat!' });
  await welcome.getByRole('button', { name: /Reaktion hinzufügen/ }).click();
  await welcome
    .getByRole('group', { name: 'Reaktion hinzufügen' })
    .getByRole('button', { name: '👍', exact: true })
    .click();
  const thumbs = welcome.getByRole('button', { name: '👍 von Lena Chat-Test', exact: true });
  await expect(thumbs).toHaveAttribute('aria-pressed', 'true');
  await a11y(page);
  await thumbs.click();
  await expect(thumbs).not.toBeVisible();
  await welcome.getByRole('button', { name: /Reaktion hinzufügen/ }).click();
  await welcome
    .getByRole('group', { name: 'Reaktion hinzufügen' })
    .getByRole('button', { name: '🎉', exact: true })
    .click();
  await expect(
    welcome.getByRole('button', { name: '🎉 von Lena Chat-Test', exact: true }),
  ).toBeVisible();
  await a11y(page);
  const moderatorContext = await browser.newContext({ baseURL: appOrigin });
  try {
    const moderator = await moderatorContext.newPage();
    await login(moderator);
    await moderator.goto(`/community?kind=chat&groupId=${group.id}`);
    const message = moderator
      .locator('.community-chat-message')
      .filter({ hasText: 'Hallo aus dem Browser!' })
      .first();
    await message.getByRole('button', { name: /Nachricht entfernen/ }).click();
    await moderator
      .getByRole('dialog')
      .getByRole('button', { name: 'Bestätigen', exact: true })
      .click();
    await expect(moderator.getByRole('dialog')).not.toBeVisible();
  } finally {
    await moderatorContext.close();
  }
  await expect(page.getByText('Nachricht entfernt', { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await page.screenshot({
    path: `test-results/community-chat-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await login(page, 'e2e-member@example.test');
  expect((await page.request.get(`/api/v1/community/chat?groupId=${group.id}`)).status()).toBe(404);
  expect((await page.request.get(`/api/v1/community/posts/${news.id}`)).status()).toBe(404);
  await page.goto('/community?kind=chat');
  await expect(page.getByText('Willkommen im Gruppenchat!', { exact: true })).not.toBeVisible();
});
