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
// Waits for the login form, so the next navigation cannot cancel the sign-out request.
async function logout(page: Page) {
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await expect(page.getByLabel('E-Mail', { exact: true })).toBeVisible();
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
  const category = await post<{ id: string }>(page, '/event-categories', {
    nameI18n: { de: `Natur ${suffix}`, it: `Natura ${suffix}` },
  });
  const eventDay = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  await post(page, '/events', {
    titleI18n: { de: `Krötenwanderung ${suffix}`, it: `Migrazione ${suffix}` },
    descriptionI18n: { de: '', it: '' },
    categoryId: category.id,
    startLocal: `${eventDay}T18:00`,
    endLocal: `${eventDay}T20:00`,
    status: 'published',
    visibility: 'members',
    location: 'Seeufer',
  });
  await logout(page);
  await login(page, email);
  await page.goto(`/community?groupId=${group.id}`);
  await expect(page.getByRole('link', { name: 'Waldgruppen-News', exact: true })).toBeVisible();
  // New group news and the group chat message are unread for the freshly added member.
  const communityNav = page.getByRole('link', { name: /^Vereinsleben/ }).first();
  await expect(communityNav).toContainText('2 ungelesen');
  await expect(page.getByRole('tab', { name: /Vereinschat/ })).toContainText('1 ungelesen');
  await page.getByRole('tab', { name: /Vereinschat/ }).click();
  // Opening the channel marks it read; the filtered news list does not.
  await expect(page.getByRole('tab', { name: /Vereinschat/ })).not.toContainText('ungelesen');
  await expect(communityNav).toContainText('1 ungelesen');
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
  // Reply with a mention picked from the suggestions.
  await welcome.getByRole('button', { name: /^Antworten:/ }).click();
  await expect(page.getByText('Antwort an E2E Administrator:')).toBeVisible();
  await compose.fill('Danke @E2E');
  await compose.press('End');
  await expect(page.getByRole('option', { name: '@E2E Administrator' })).toBeVisible();
  await compose.press('Enter');
  await expect(compose).toHaveValue('Danke @E2E Administrator ');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  const reply = page
    .locator('.community-chat-message')
    .filter({ hasText: 'Danke @E2E Administrator' });
  await expect(reply.locator('.chat-quote')).toContainText('Willkommen im Gruppenchat!');
  // Share an upcoming event as a card.
  await page
    .getByRole('button', { name: 'Umfrage oder Veranstaltung teilen', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: new RegExp(`Krötenwanderung ${suffix}`) })
    .click();
  await expect(page.getByLabel('Deine Nachricht', { exact: true })).toHaveValue(
    `Krötenwanderung ${suffix}`,
  );
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  const card = page.locator('.chat-card').filter({ hasText: `Krötenwanderung ${suffix}` });
  await expect(card).toContainText('Seeufer');
  await expect(card.getByRole('link', { name: 'Zur Anmeldung' })).toHaveAttribute(
    'href',
    /\/events\/[0-9a-f-]+$/,
  );
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
    // The mention is highlighted for the mentioned account.
    await expect(
      moderator.locator('.community-chat-mention').filter({ hasText: 'Danke @E2E Administrator' }),
    ).toBeVisible();
  } finally {
    await moderatorContext.close();
  }
  await expect(page.getByText('Nachricht entfernt', { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await a11y(page);
  await page.screenshot({
    path: `test-results/community-chat-${info.project.name}.png`,
    fullPage: true,
  });
  await logout(page);
  await login(page, 'e2e-member@example.test');
  expect((await page.request.get(`/api/v1/community/chat?groupId=${group.id}`)).status()).toBe(404);
  expect((await page.request.get(`/api/v1/community/posts/${news.id}`)).status()).toBe(404);
  await page.goto('/community?kind=chat');
  await expect(page.getByText('Willkommen im Gruppenchat!', { exact: true })).not.toBeVisible();
});
