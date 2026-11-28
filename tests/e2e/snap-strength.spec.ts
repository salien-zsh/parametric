import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type W = { __parametric: import('../../src/app/app').App };

test('the sketch palette switches the point snap strength', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.getByRole('treeitem', { name: 'Front Plane' }).click();
  await page.getByRole('tab', { name: 'Sketch' }).click();
  await page.locator('[data-cmd="sketch"]').first().click();
  const strength = page.getByRole('combobox', { name: 'Point snap strength' });
  await expect(strength).toHaveValue('normal');
  await strength.selectOption('strong');
  expect(await page.evaluate(() => (window as unknown as W).__parametric.settings.snapStrength)).toBe('strong');
  await strength.selectOption('weak');
  expect(await page.evaluate(() => (window as unknown as W).__parametric.settings.snapStrength)).toBe('weak');
  expect(errors).toEqual([]);
});
