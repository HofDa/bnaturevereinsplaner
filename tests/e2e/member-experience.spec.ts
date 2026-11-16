import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login } from './helpers/login';

const password = 'E2E-only-Password-2026!';
const appOrigin = `http://localhost:${process.env.E2E_WEB_PORT ?? '5174'}`;

async function a11yAndOverflow(page: Page) {
  const report = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    report.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    })),
  ).toEqual([]);
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(noOverflow).toBe(true);
}

async function apiPost<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const res = await request.post(`${appOrigin}/api/v1${path}`, {
    headers: { origin: appOrigin, 'idempotency-key': crypto.randomUUID() },
    data,
  });
  expect(res.ok(), `${path} -> ${res.status()}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function apiPut<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const res = await request.put(`${appOrigin}/api/v1${path}`, {
    headers: { origin: appOrigin, 'idempotency-key': crypto.randomUUID() },
    data,
  });
  expect(res.ok(), `${path} -> ${res.status()}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

function localOffset(days: number, hour: number) {
  const target = new Date(Date.now() + days * 86_400_000);
  const datePart = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(target);
  return `${datePart}T${String(hour).padStart(2, '0')}:00`;
}

test('member self-service dashboard, digital card, receipt download, groups, events and safe links', async ({
  browser,
  page,
}, info) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const suffix = `${info.project.name}-${Date.now()}`;
  const memberEmail = `e2e-self-${suffix}@example.test`;
  const membershipNumber = `SLF-${info.project.name.slice(0, 1).toUpperCase()}-${String(Date.now()).slice(-5)}`;
  const groupName = `Biotop-${suffix}`;
  const planName = `Mitgliedstarif-${suffix}`;
  const newsTitle = `Vereinsnews ${suffix}`;
  const eventTitle = `Wiesenpflege ${suffix}`;
  const draftTitle = `Interner Entwurf ${suffix}`;

  // Provision realistic member fixtures using an isolated admin browser context.
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await login(adminPage);
  const adminApi = adminContext.request;

  const member = await apiPost<{ id: string; personId: string }>(adminApi, '/members', {
    firstName: 'Klara',
    lastName: `See-${info.project.name}`,
    email: `klara-${suffix}@example.test`,
    membershipNumber,
    joinedAt: '2024-05-01',
  });
  await apiPost(adminApi, '/users', {
    name: `Klara See ${info.project.name}`,
    email: memberEmail,
    password,
    role: 'member',
    personId: member.personId,
  });

  const group = await apiPost<{ id: string }>(adminApi, '/groups', {
    name: groupName,
    description: 'Aktive Biotoppflege vor Ort.',
  });
  await apiPut(adminApi, `/groups/${group.id}/members`, { personIds: [member.personId] });

  await apiPost(adminApi, `/members/${member.id}/consents`, {
    kind: 'data_processing',
    granted: true,
    decidedOn: '2024-05-01',
  });

  const plan = await apiPost<{ id: string }>(adminApi, '/fee-plans', {
    name: planName,
    amountCents: 4500,
    interval: 'annual',
  });
  const paidAssess = await apiPost<{ id: string }>(adminApi, '/fee-assessments', {
    planId: plan.id,
    membershipId: member.id,
    fiscalYear: 2025,
    dueDate: '2025-01-31',
  });
  await apiPost(adminApi, '/fee-assessments', {
    planId: plan.id,
    membershipId: member.id,
    fiscalYear: 2026,
    dueDate: '2020-02-01',
  });
  await apiPost(adminApi, '/payments', {
    payerName: `Klara See-${info.project.name}`,
    paidOn: '2025-02-15',
    method: 'bank_transfer',
    reference: `REF-${suffix}`,
    amountCents: 4500,
    allocations: [{ assessmentId: paidAssess.id, amountCents: 4500 }],
  });

  const newsCreated = await apiPost<{ id: string }>(adminApi, '/community/posts', {
    kind: 'news',
    titleI18n: { de: newsTitle, it: `Notizie ${suffix}` },
    bodyI18n: {
      de: 'Weitere Hinweise unter https://example.org/verein-info.',
      it: 'Ulteriori info su https://example.org/verein-info.',
    },
  });
  const newsDetail = (await (
    await adminApi.get(`${appOrigin}/api/v1/community/posts/${newsCreated.id}`)
  ).json()) as { id: string; version: number };
  await apiPost(adminApi, `/community/posts/${newsDetail.id}/publish`, {
    version: newsDetail.version,
  });

  const pollCreated = await apiPost<{ id: string }>(adminApi, '/community/posts', {
    kind: 'poll',
    titleI18n: { de: `Umfrage ${suffix}`, it: `Sondaggio ${suffix}` },
    bodyI18n: { de: 'Wann passt es besser?', it: 'Quando preferisci?' },
    options: [
      { de: 'Samstag', it: 'Sabato' },
      { de: 'Sonntag', it: 'Domenica' },
    ],
  });
  const pollDetail = (await (
    await adminApi.get(`${appOrigin}/api/v1/community/posts/${pollCreated.id}`)
  ).json()) as { id: string; version: number };
  await apiPost(adminApi, `/community/posts/${pollDetail.id}/publish`, {
    version: pollDetail.version,
  });

  const meRes = (await (await adminApi.get(`${appOrigin}/api/v1/me`)).json()) as {
    user: { id: string };
  };
  const cats = await apiPost<{ items: { id: string }[] }>(
    adminApi,
    '/event-categories/initialize',
    {},
  );
  await apiPost(adminApi, '/events', {
    titleI18n: { de: eventTitle, it: `Prato ${suffix}` },
    descriptionI18n: { de: 'Treffpunkt am Parkplatz.', it: 'Ritrovo al parcheggio.' },
    categoryId: cats.items[0]!.id,
    startLocal: localOffset(7, 9),
    endLocal: localOffset(7, 12),
    timezone: 'Europe/Rome',
    location: `Naturpark ${suffix}`,
    latitude: 46.498,
    longitude: 11.354,
    status: 'published',
    visibility: 'members',
    organizerId: meRes.user.id,
  });
  await apiPost(adminApi, '/events', {
    titleI18n: { de: draftTitle, it: draftTitle },
    descriptionI18n: { de: 'Entwurf', it: 'Bozza' },
    categoryId: cats.items[0]!.id,
    startLocal: localOffset(8, 9),
    endLocal: localOffset(8, 12),
    timezone: 'Europe/Rome',
    status: 'draft',
    visibility: 'internal',
    organizerId: meRes.user.id,
  });

  await adminContext.close();

  // Log in as the freshly linked simple member.
  await login(page, memberEmail, password);

  // 1. Live Member Home Dashboard
  const home = page.getByRole('main');
  await expect(
    home.getByRole('heading', { name: `Hallo, Klara See-${info.project.name}`, level: 1 }),
  ).toBeVisible();
  await expect(home).toContainText(membershipNumber);
  await expect(home).toContainText(/45,00\s*€/);
  await expect(home).toContainText(eventTitle);
  await a11yAndOverflow(page);

  // 2. Navigate to /profile (via mobile bottom nav on mobile viewport)
  if (info.project.name === 'mobile') {
    // Profile sits in the bar when everything fits, otherwise in the "more" sheet.
    const more = page.locator('.bottom-nav .nav-more');
    if (await more.isVisible()) await more.click();
    await page.locator('.bottom-nav a[href="/profile"]').click();
  } else {
    await page.goto('/profile');
  }
  await expect(page.locator('.member-id-card')).toContainText(membershipNumber);
  await expect(page.locator('.member-id-card')).toContainText(`Klara See-${info.project.name}`);
  await expect(page.getByText(groupName)).toBeVisible();
  await expect(page.getByRole('cell', { name: planName }).first()).toBeVisible();
  await expect(page.locator('.member-payment-list')).toContainText('45,00');

  const receiptBtn = page.locator('.member-payment-actions button').first();
  await expect(receiptBtn).toBeVisible();
  const [pdfDownload] = await Promise.all([page.waitForEvent('download'), receiptBtn.click()]);
  expect(pdfDownload.suggestedFilename()).toMatch(/^receipt-\d+\.pdf$/);
  await a11yAndOverflow(page);

  // 3. Groups membership badge & deep links inside modal
  await page.goto('/groups');
  const myCard = page.locator('article').filter({ hasText: groupName });
  await expect(myCard).toBeVisible();
  await expect(myCard).toContainText('Dein Bereich');
  await myCard.getByRole('button', { name: `Details öffnen: ${groupName}` }).click();
  const groupDialog = page.getByRole('dialog');
  await expect(groupDialog).toBeVisible();
  const chatLink = groupDialog.getByRole('link', { name: 'Zum Gruppenchat' });
  await expect(chatLink).toBeVisible();
  await expect(chatLink).toHaveAttribute('href', `/community?kind=chat&groupId=${group.id}`);
  await a11yAndOverflow(page);
  await page.keyboard.press('Escape');
  await expect(groupDialog).toHaveCount(0);

  // 4. Events UX: unauthorized tabs & draft filter hidden, list upcoming default, map link & single .ics
  await page.goto('/events?view=list');
  await expect(page.locator('a[href="/events/categories"]')).toHaveCount(0);
  await expect(page.locator('a[href="/events/series"]')).toHaveCount(0);
  await expect(page.locator('select option[value="draft"]')).toHaveCount(0);
  await expect(page.getByText(draftTitle)).toHaveCount(0);

  const eventLink = page.getByRole('link', { name: eventTitle }).first();
  await expect(eventLink).toBeVisible();
  await eventLink.click();

  const osmLink = page.locator('.event-location-fact a[href*="openstreetmap.org"]');
  await expect(osmLink).toBeVisible();
  await expect(osmLink).toHaveAttribute('target', '_blank');
  await expect(osmLink).toHaveAttribute('rel', /noopener/);

  const singleIcsBtn = page
    .getByRole('button', { name: /kalender|\.ics|termin/i })
    .or(page.getByRole('link', { name: /kalender|\.ics|termin/i }))
    .first();
  await expect(singleIcsBtn).toBeVisible();
  const [icsDownload] = await Promise.all([page.waitForEvent('download'), singleIcsBtn.click()]);
  expect(icsDownload.suggestedFilename()).toMatch(/\.ics$/);
  await a11yAndOverflow(page);

  // 5. Community safe plain-text link rendering
  await page.goto('/community');
  await page.getByRole('link', { name: newsTitle }).first().click();
  const safeUrl = page.locator('a.linked-url[href="https://example.org/verein-info"]');
  await expect(safeUrl).toBeVisible();
  await expect(safeUrl).toHaveAttribute('target', '_blank');
  await expect(safeUrl).toHaveAttribute('rel', /noopener/);
  await a11yAndOverflow(page);

  expect(pageErrors).toEqual([]);
});
