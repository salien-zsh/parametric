import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };

test('the local project manager keeps its project name and actions readable', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('projectManager'));
  await expect(page.getByRole('heading', { name: 'Local Project Manager' })).toBeVisible();

  // A project with a long name must not be squeezed into a vertical column.
  await page.getByRole('textbox', { name: 'New project name' }).fill('Gearbox Redesign Project');
  await page.getByRole('button', { name: 'Create Project' }).click();
  await page.locator('.file-item').filter({ hasText: 'Gearbox Redesign Project' }).first().click();

  const title = page.locator('.pm-title');
  await expect(title).toHaveText('Gearbox Redesign Project');
  const titleBox = (await title.boundingBox())!;
  expect(titleBox.width).toBeGreaterThan(150);
  expect(titleBox.height).toBeLessThan(40);

  // The project actions wrap under the title instead of crushing it.
  const actions = page.locator('.pm-actions');
  await expect(actions).toBeVisible();
  await expect(actions.getByRole('button', { name: 'Rename' })).toBeVisible();
  const actionsBox = (await actions.boundingBox())!;
  expect(actionsBox.width).toBeGreaterThan(200);

  // The project list keeps a usable column width.
  const list = page.locator('.dialog .file-list');
  const listBox = (await list.boundingBox())!;
  expect(listBox.width).toBeGreaterThan(150);

  await page.locator('.dialog-foot').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('heading', { name: 'Local Project Manager' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
