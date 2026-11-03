import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const appOrigin = `http://localhost:${process.env.E2E_WEB_PORT ?? '5174'}`;
test.setTimeout(90_000);

test('sends an event invitation with a working link to authenticated event details', async ({
  page,
  request,
}, info) => {
  await page.goto('/');
  await page.getByLabel('E-Mail', { exact: true }).fill('e2e@example.test');
  await page.getByLabel('Passwort', { exact: true }).fill('E2E-only-Password-2026!');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Abmelden', exact: true })).toBeVisible();
  async function post<T>(path: string, data: unknown): Promise<T> {
    const response = await page.request.post(`/api/v1${path}`, {
      headers: { Origin: appOrigin, 'Idempotency-Key': crypto.randomUUID() },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  const suffix = `${info.project.name}-${Date.now()}`;
  const email = `invitation-${suffix}@example.test`;
  const member = await post<{ personId: string }>('/members', {
    firstName: 'Lena',
    lastName: 'Einladungstest',
    email,
    preferredLanguage: 'de',
    membershipNumber: `INV-${suffix}`,
    joinedAt: '2020-01-01',
  });
  await post('/users', {
    name: 'Einladungstest',
    email,
    password: 'Invitations-test-only-2026!',
    role: 'member',
    personId: member.personId,
  });
  const category = await post<{ id: string }>('/event-categories', {
    nameI18n: { de: 'Einladungstest', it: 'Prova invito' },
  });
  const me = await (await page.request.get('/api/v1/me')).json();
  const future = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const event = await post<{ id: string }>('/events', {
    titleI18n: { de: 'Gemeinsame Waldpflege', it: 'Cura del bosco insieme' },
    descriptionI18n: { de: 'Einladung zum Mitmachen', it: 'Invito a partecipare' },
    categoryId: category.id,
    startLocal: `${future}T09:00`,
    endLocal: `${future}T12:00`,
    organizerId: me.user.id,
    status: 'published',
    visibility: 'members',
  });
  await page.goto('/mail');
  await page.getByLabel('Nachrichtenart', { exact: true }).selectOption('event_invitation');
  await page.getByLabel('Veranstaltung', { exact: true }).selectOption(event.id);
  await page.getByRole('button', { name: 'Versandvorschau', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Versandvorschau' });
  await expect(preview.getByRole('cell', { name: email, exact: true })).toBeVisible();
  await expect(preview.locator('pre')).toContainText('Einladung');
  await preview.getByRole('button', { name: 'Versand bestätigen' }).click();
  const row = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: email, exact: true }) });
  await expect(row).toContainText('Vom Mailserver angenommen', { timeout: 45_000 });
  const inbox = (await (await request.get('http://127.0.0.1:8025/api/v1/messages')).json()) as {
    messages: { ID: string; Subject: string; To: { Address: string }[] }[];
  };
  const mails = inbox.messages.filter((message) => message.To.some((to) => to.Address === email));
  expect(mails).toHaveLength(1);
  const message = await (
    await request.get(`http://127.0.0.1:8025/api/v1/message/${mails[0]!.ID}`)
  ).json();
  expect(message.Text).toContain(`${appOrigin}/events/${event.id}`);
  await page.goto(`/events/${event.id}`);
  await expect(
    page.getByRole('heading', { name: 'Gemeinsame Waldpflege', exact: true }),
  ).toBeVisible();
});

test('previews and sends localized reminders into the local SMTP inbox, manages automation and protects the member view', async ({
  page,
  request,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('E-Mail', { exact: true }).fill('e2e@example.test');
  await page.getByLabel('Passwort', { exact: true }).fill('E2E-only-Password-2026!');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Abmelden', exact: true })).toBeVisible();
  async function post<T>(path: string, data: unknown): Promise<T> {
    const response = await page.request.post(`/api/v1${path}`, {
      headers: { Origin: appOrigin, 'Idempotency-Key': crypto.randomUUID() },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  const suffix = `${info.project.name}-${Date.now()}`;
  const recipient = `mail-${suffix}@example.test`;
  const member = await post<{ id: string }>('/members', {
    firstName: 'Giulia',
    lastName: 'Mailtest',
    preferredLanguage: 'it',
    email: recipient,
    membershipNumber: `MAIL-${suffix}`,
    joinedAt: '2020-01-01',
  });
  const plan = await post<{ id: string }>('/fee-plans', {
    name: 'Mailtest Jahresbeitrag',
    amountCents: 4200,
    interval: 'annual',
  });
  await post('/fee-assessments', {
    membershipId: member.id,
    planId: plan.id,
    fiscalYear: 2026,
    dueDate: '2020-01-01',
  });
  await page.goto('/mail');
  await expect(page.getByRole('heading', { name: 'E-Mail', exact: true })).toBeVisible();
  await expect(page.getByText(/Lokales Testpostfach aktiv/)).toBeVisible();
  await page.getByRole('button', { name: 'Versandvorschau', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Versandvorschau', exact: true });
  await expect(preview.getByRole('cell', { name: recipient, exact: true })).toBeVisible();
  await expect(preview.getByText(/Promemoria quota associativa/)).toBeVisible();
  await expect(preview.locator('pre')).toContainText('42,00');
  await page.screenshot({
    path: `test-results/mail-preview-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await preview.getByRole('button', { name: 'Versand bestätigen', exact: true }).click();
  await expect(preview).not.toBeVisible();
  const row = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: recipient, exact: true }) });
  await expect(row).toContainText('Vom Mailserver angenommen', { timeout: 45_000 });
  const inbox = async () => {
    const response = await request.get('http://127.0.0.1:8025/api/v1/messages');
    expect(response.ok()).toBe(true);
    return response.json() as Promise<{
      messages: { ID: string; Subject: string; To: { Address: string }[] }[];
    }>;
  };
  const mail = (await inbox()).messages.filter((message) =>
    message.To.some((to) => to.Address === recipient),
  );
  expect(mail).toHaveLength(1);
  expect(mail[0]!.Subject).toContain('Promemoria');
  expect(mail[0]!.To).toHaveLength(1);
  const body = await request.get(`http://127.0.0.1:8025/api/v1/message/${mail[0]!.ID}`);
  expect((await body.json()).Text).toContain('42,00');
  await row.getByRole('button', { name: `Details öffnen: ${recipient}` }).click();
  await expect(
    page.getByRole('dialog', { name: 'Nachrichtendetails' }).locator('pre'),
  ).toContainText('Giulia');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Schließen/ })
    .click();
  await page.getByRole('button', { name: 'Automatische Erinnerungen', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Automatische Erinnerungen' });
  await expect(
    settings.getByRole('checkbox', { name: 'Beitragserinnerungen automatisch versenden' }),
  ).not.toBeChecked();
  await settings.getByLabel('Mindestabstand in Tagen (7–90) *', { exact: true }).fill('21');
  await settings.getByRole('button', { name: 'Änderungen speichern' }).click();
  await expect(settings).not.toBeVisible();
  await page.getByRole('button', { name: 'Automatische Erinnerungen', exact: true }).click();
  await expect(
    settings.getByLabel('Mindestabstand in Tagen (7–90) *', { exact: true }),
  ).toHaveValue('21');
  await settings.getByRole('button', { name: 'Abbrechen' }).click();
  await page.getByRole('button', { name: /Sprache:/ }).click();
  await expect(page.getByRole('heading', { name: 'E-mail', exact: true })).toBeVisible();
  await expect(
    page.getByText('Impostazioni dei promemoria salvate.', { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `test-results/mail-outbox-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.getByRole('button', { name: 'Esci', exact: true }).click();
  await page.getByLabel('E-mail', { exact: true }).fill('e2e-member@example.test');
  await page.getByLabel('Password', { exact: true }).fill('E2E-only-Password-2026!');
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Esci' })).toBeVisible();
  await page.goto('/mail');
  expect((await page.request.get('/api/v1/mail/messages')).status()).toBe(403);
  await expect(page.getByRole('heading', { name: 'E-mail', exact: true })).not.toBeVisible();
  expect(errors).toEqual([]);
});
