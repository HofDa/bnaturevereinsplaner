import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test.setTimeout(120_000);
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
test('writes a bilingual newsletter, skips opt-outs and delivers it to the local inbox', async ({
  page,
  request,
}, info) => {
  await login(page);
  const suffix = `${info.project.name}-${Date.now()}`;
  const api = async (path: string, data: unknown, method: 'POST' | 'PUT' = 'POST') => {
    const r = await page.request.fetch(`/api/v1${path}`, {
      method,
      headers: { Origin: appOrigin, 'Idempotency-Key': crypto.randomUUID() },
      data,
    });
    expect(r.ok(), await r.text()).toBe(true);
    return (await r.json()) as { id: string };
  };
  const reader = `reader-${suffix}@example.test`;
  const quitter = `quitter-${suffix}@example.test`;
  await api('/members', {
    firstName: 'Rita',
    lastName: `Leserin ${suffix}`,
    email: reader,
    preferredLanguage: 'it',
    membershipNumber: `NL-R-${suffix}`,
    joinedAt: '2020-01-01',
  });
  const opted = await api('/members', {
    firstName: 'Otto',
    lastName: `Abbesteller ${suffix}`,
    email: quitter,
    membershipNumber: `NL-Q-${suffix}`,
    joinedAt: '2020-01-01',
  });
  await api(`/members/${opted.id}/newsletter`, { optOut: true }, 'PUT');
  await page.goto('/mail');
  await page.getByLabel('Nachrichtenart', { exact: true }).selectOption({ label: 'Newsletter' });
  await page.getByRole('button', { name: 'Neuer Newsletter', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Neuer Newsletter' });
  await editor.getByLabel('Betreff (DE)', { exact: true }).fill(`Frühjahr ${suffix}`);
  await editor.getByLabel('Betreff (IT)', { exact: true }).fill(`Primavera ${suffix}`);
  await editor.getByLabel('Text (DE)', { exact: true }).fill('Wir pflanzen Hecken.');
  await editor.getByLabel('Text (IT)', { exact: true }).fill('Piantiamo siepi.');
  await a11y(page);
  await editor.getByRole('button', { name: 'Entwurf speichern', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByLabel('Newsletter-Entwurf', { exact: true })).toHaveValue(/[0-9a-f-]{36}/);
  await page.getByRole('button', { name: 'Versandvorschau', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Versandvorschau', exact: true });
  await expect(preview.getByRole('cell', { name: reader, exact: true })).toBeVisible();
  await expect(preview.getByRole('cell', { name: quitter, exact: true })).toHaveCount(0);
  await expect(preview).toContainText(
    /hat den Newsletter abbestellt|haben den Newsletter abbestellt/,
  );
  await a11y(page);
  await preview.getByRole('button', { name: 'Versand bestätigen', exact: true }).click();
  await expect(preview).not.toBeVisible();
  const row = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: reader, exact: true }) });
  await expect(row).toContainText('Vom Mailserver angenommen', { timeout: 45_000 });
  const inbox = (await (await request.get('http://127.0.0.1:8025/api/v1/messages')).json()) as {
    messages: { ID: string; Subject: string; To: { Address: string }[] }[];
  };
  const mails = inbox.messages.filter((m) => m.To.some((to) => to.Address === reader));
  expect(mails).toHaveLength(1);
  expect(mails[0]!.Subject).toContain(`Primavera ${suffix}`);
  const body = (await (
    await request.get(`http://127.0.0.1:8025/api/v1/message/${mails[0]!.ID}`)
  ).json()) as { Text: string };
  expect(body.Text).toContain('Piantiamo siepi.');
  expect(body.Text).toContain('/profile');
  expect(inbox.messages.some((m) => m.To.some((to) => to.Address === quitter))).toBe(false);
  // The sent newsletter is no longer offered as a draft.
  await expect(
    page
      .getByLabel('Newsletter-Entwurf', { exact: true })
      .getByRole('option', { name: `Frühjahr ${suffix}` }),
  ).toHaveCount(0);
});
