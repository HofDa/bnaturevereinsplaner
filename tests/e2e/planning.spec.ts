import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.setTimeout(120_000);
async function a11y(page: Page) {
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
}
test('customizes, saves, reopens and exports a project cost plan', async ({ page }, info) => {
  await page.goto('/');
  await page.getByLabel('E-Mail', { exact: true }).fill('e2e@example.test');
  await page.getByLabel('Passwort', { exact: true }).fill('E2E-only-Password-2026!');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Abmelden', exact: true })).toBeVisible();
  await page.goto('/planning');
  await expect(page.getByRole('heading', { name: 'Projektplanung', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Kostenplan erstellen', exact: true }).first().click();
  const editor = page.getByRole('dialog', { name: 'Kostenplan erstellen' });
  const name = `Waldpflege ${info.project.name} ${Date.now()}`;
  await editor.getByLabel('Projekt / Name des Kostenplans', { exact: true }).fill(name);
  await editor.getByLabel('Beschreibung', { exact: true }).fill('Kosten für das Vereinsprojekt');
  await editor.getByRole('button', { name: 'Position hinzufügen', exact: true }).click();
  await editor.getByLabel('Position · 1', { exact: true }).fill('Pflanzen');
  await editor.getByLabel('Kategorie · 1', { exact: true }).fill('Material');
  await editor.getByLabel('Menge · 1', { exact: true }).fill('2.5');
  await editor.getByLabel('Einheit · 1', { exact: true }).fill('kg');
  await editor.getByLabel('Einzelpreis (€) · 1', { exact: true }).fill('12.35');
  await editor.getByLabel('Ist (€) · 1', { exact: true }).fill('32');
  await editor.getByLabel('Notizen · 1', { exact: true }).fill('Grün & nachhaltig');
  await editor.getByText('Spalten anpassen', { exact: true }).click();
  await editor.getByRole('button', { name: 'Spalte hinzufügen', exact: true }).click();
  await editor.getByLabel('Zusatzspalte 1', { exact: true }).fill('Lieferant');
  await editor.getByLabel('Lieferant · 1', { exact: true }).fill('Biogärtnerei');
  await a11y(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await editor.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const table = page.locator('.cost-table');
  await expect(table.getByRole('columnheader', { name: 'Lieferant', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'Biogärtnerei', exact: true })).toBeAttached();
  await expect(table.getByRole('cell', { name: /30,88/ })).toBeAttached();
  await page.reload();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  for (const format of ['CSV', 'Excel (.xlsx)']) {
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: format, exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe(`${name}.${format === 'CSV' ? 'csv' : 'xlsx'}`);
    expect(await download.failure()).toBeNull();
  }
  await a11y(page);
  await page.getByRole('button', { name: 'Kostenplan bearbeiten', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Kostenplan bearbeiten' });
  await expect(edit.getByLabel('Lieferant · 1', { exact: true })).toHaveValue('Biogärtnerei');
  await edit.getByRole('button', { name: 'Position duplizieren · 1', exact: true }).click();
  await edit.getByLabel('Position · 2', { exact: true }).fill('Werkzeuge');
  await edit.getByRole('button', { name: 'Nach oben · 2', exact: true }).click();
  await expect(edit.getByLabel('Position · 1', { exact: true })).toHaveValue('Werkzeuge');
  await edit.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await expect(edit).not.toBeVisible();
  await expect(table.getByRole('rowheader').first()).toHaveText('Werkzeuge');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/planning-${info.project.name}.png`, fullPage: true });
});
