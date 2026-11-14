import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
// Includes account provisioning, two sign-ins and a full-profile accessibility scan.
test.setTimeout(90_000);
async function login(page: Page, email = 'e2e@example.test') {
  await page.goto('/');
  await page.getByLabel('E-Mail', { exact: true }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill('E2E-only-Password-2026!');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Abmelden', exact: true })).toBeVisible();
}
// Waits for the login form, so the next navigation cannot cancel the sign-out request.
async function logout(page: Page) {
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await expect(page.getByLabel('E-Mail', { exact: true })).toBeVisible();
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

test('volunteers see their engagement and report their own hours for confirmation', async ({
  page,
}, info) => {
  const origin = `http://localhost:${process.env.E2E_WEB_PORT ?? '5174'}`;
  const api = async (path: string, data: unknown) => {
    const r = await page.request.post(`/api/v1${path}`, {
      headers: { Origin: origin, 'Idempotency-Key': crypto.randomUUID() },
      data,
    });
    expect(r.status(), await r.text()).toBe(201);
    return (await r.json()) as { id: string; personId: string };
  };
  await login(page);
  const suffix = `${info.project.name}-${Date.now()}`;
  const email = `vol-self-${suffix}@example.test`;
  const engagement = await api('/volunteers', {
    person: { firstName: 'Paul', lastName: `Pflege ${suffix}` },
    volunteerType: 'occasional',
    startedOn: '2026-01-01',
    activity: 'Biotoppflege',
  });
  await api('/users', {
    name: 'Paul Pflege',
    email,
    password: 'E2E-only-Password-2026!',
    role: 'member',
    personId: engagement.personId,
  });
  await logout(page);
  await login(page, email);
  await page.goto('/profile');
  const panel = page.locator('.own-volunteering');
  await expect(panel.getByRole('heading', { name: 'Mein freiwilliges Engagement' })).toBeVisible();
  await panel.getByRole('button', { name: 'Stunden melden', exact: true }).click();
  const form = dialog(page);
  await form.getByLabel('Datum', { exact: true }).fill('2026-10-15');
  await form.getByLabel('Beginn', { exact: true }).fill('09:00');
  await form.getByLabel('Ende', { exact: true }).fill('11:30');
  await form.getByLabel('Pause (Minuten)', { exact: true }).fill('30');
  await form.getByLabel('Was wurde gemacht?', { exact: true }).fill('Neophyten entfernt');
  await form.getByRole('button', { name: 'Zur Bestätigung einreichen', exact: true }).click();
  await expect(form).not.toBeVisible();
  await expect(panel.getByText(/Stunden gemeldet/)).toBeVisible();
  const entry = panel.getByRole('listitem').filter({ hasText: 'Neophyten entfernt' });
  await expect(entry).toContainText('Eingereicht');
  await expect(entry).toContainText('2 h');
  await a11y(page);
  // Members still cannot open the club-wide volunteer administration.
  expect((await page.request.get('/api/v1/volunteers')).status()).toBe(403);
});
