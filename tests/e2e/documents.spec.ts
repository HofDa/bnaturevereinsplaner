import { login } from './helpers/login';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
async function checkAccessibility(page: Page) {
  const report = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(report.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual(
    [],
  );
}
const pdf = (text: string) => ({
  name: `${text}.pdf`,
  mimeType: 'application/pdf',
  buffer: Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`),
});
test('uploads, versions, downloads and archives private documents', async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, 'e2e-board@example.test');
  // Mobile reaches secondary areas through the settings overview.
  if (info.project.name === 'mobile') await page.goto('/settings');
  await page
    .getByRole('link', { name: /^Dokumente/ })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Dokumente', level: 1 })).toBeVisible();
  await expect(page.getByText('Noch keine Dokumente abgelegt.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dokument hochladen', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Datei *', { exact: true }).setInputFiles({
    name: 'tarnung.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('<html>kein PDF</html>'),
  });
  await dialog.getByLabel('Titel *', { exact: true }).fill('Statut 2026');
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(
    dialog.getByText('Nur PDF-, PNG- und JPEG-Dateien mit passendem Inhalt sind erlaubt.'),
  ).toBeVisible();
  await dialog.getByLabel('Datei *', { exact: true }).setInputFiles(pdf('statut-entwurf'));
  await dialog.getByLabel('Kategorie', { exact: true }).selectOption({ label: 'Statut' });
  await dialog
    .getByLabel('Mitglied', { exact: true })
    .selectOption({ label: 'Lena Testperson · TEST-001' });
  await checkAccessibility(page);
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Statut 2026' });
  await expect(row).toContainText('statut-entwurf.pdf');
  await expect(row).toContainText('Lena Testperson');
  await row.getByRole('button', { name: 'Dokumentdetails: Statut 2026', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Neue Version', { exact: true }).setInputFiles({
    name: 'statut-final.png',
    mimeType: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  });
  await dialog.getByRole('button', { name: 'Version hochladen', exact: true }).click();
  await expect(page.getByText('Neue Version gespeichert.', { exact: true })).toBeVisible();
  await expect(dialog.getByText('statut-final.png')).toBeVisible();
  const download = page.waitForEvent('download');
  await dialog
    .getByRole('button', { name: 'Herunterladen: statut-entwurf.pdf v1', exact: true })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('statut-entwurf.pdf');
  await checkAccessibility(page);
  await dialog.getByRole('button', { name: 'Archivieren', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Dokument archiviert.', { exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Statut 2026' })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('true');
  await expect(page.getByRole('row').filter({ hasText: 'Statut 2026' })).toContainText(
    'statut-final.png',
  );
  await checkAccessibility(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/documents-${info.project.name}.png`,
    fullPage: true,
  });
  // Document contents never land in the service worker caches.
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys())
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    return urls.filter((url) => url.includes('/api/'));
  });
  expect(cached).toEqual([]);
  expect(errors).toEqual([]);
});
test('ordinary members cannot discover or download documents', async ({ page }) => {
  await login(page, 'e2e-member@example.test');
  await expect(page.getByRole('link', { name: 'Dokumente', exact: true })).toHaveCount(0);
  await page.goto('/documents');
  await expect(
    page.getByText('Für diese Ansicht fehlt Ihnen die Berechtigung.', { exact: true }),
  ).toBeVisible();
  expect((await page.request.get('/api/v1/documents')).status()).toBe(403);
});
