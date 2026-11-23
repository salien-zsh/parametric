import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };

test('the mechanical module designs a stepped shaft and adds a keyway', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.getByRole('tab', { name: 'Mechanical' }).click();
  await page.locator('[data-cmd="shaft"]').click();
  await expect(page.getByRole('heading', { name: 'Shaft Design' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Shaft Segments' })).toBeVisible();
  await expect(page.locator('.pm-section').filter({ hasText: 'Shaft Check' })).toContainText('Design torque');
  await page.locator('.confirm-corner .ok').click();
  await expect(page.getByRole('treeitem', { name: 'Shaft1' })).toBeVisible();
  await page.evaluate(() => (window as unknown as Handle).__parametric.whenBuilt());
  expect(await page.evaluate(() => !!((window as unknown as Handle).__parametric.bbox))).toBe(true);

  await page.getByRole('treeitem', { name: 'Shaft1' }).dblclick();
  await expect(page.getByRole('heading', { name: 'Shaft1' })).toBeVisible();
  const keyway = page.getByRole('checkbox', { name: 'Keyway' });
  await keyway.check();
  await expect(page.getByRole('combobox', { name: 'Keyway segment' })).toBeVisible();
  await page.locator('.confirm-corner .ok').click();
  await expect.poll(() => page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const f = a.store.doc.features.find((x) => x.type === 'shaft') as unknown as { keyway?: unknown };
    return !!f?.keyway;
  })).toBe(true);
  expect(errors).toEqual([]);
});
