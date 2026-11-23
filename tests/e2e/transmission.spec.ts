import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };

test('the mechanical module designs gears, belts and a sprocket', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.getByRole('tab', { name: 'Mechanical' }).click();
  for (const cmd of ['spurGear', 'bevelGear', 'wormGear', 'vBelt', 'syncBelt', 'sprocket']) {
    await expect(page.locator(`[data-cmd="${cmd}"]`)).toBeVisible();
  }

  // A spur gear: the panel reports its pitch diameter and tooth stress.
  await page.locator('[data-cmd="spurGear"]').click();
  await expect(page.getByRole('heading', { name: 'Spur Gear' })).toBeVisible();
  await expect(page.locator('.pm-section').filter({ hasText: 'Gear' })).toBeVisible();
  await expect(page.locator('.pm-msg').filter({ hasText: 'Pitch diameter' })).toContainText('48.00 mm');
  await page.locator('.confirm-corner .ok').click();
  await expect(page.getByRole('treeitem', { name: 'Spur Gear1' })).toBeVisible();
  await page.evaluate(() => (window as unknown as Handle).__parametric.whenBuilt());
  expect(await page.evaluate(() => !!((window as unknown as Handle).__parametric.bbox))).toBe(true);

  // Editing the module changes the reported pitch diameter.
  await page.getByRole('treeitem', { name: 'Spur Gear1' }).dblclick();
  await expect(page.getByRole('heading', { name: 'Spur Gear1' })).toBeVisible();
  const module = page.getByRole('textbox', { name: 'Module' });
  await module.fill('3');
  await module.blur();
  await expect(page.locator('.pm-msg').filter({ hasText: 'Pitch diameter' })).toContainText('72.00 mm');
  await page.locator('.confirm-corner .ok').click();
  await expect.poll(() => page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const f = a.store.doc.features.find((x) => x.type === 'spurGear') as unknown as { module?: unknown };
    return f?.module;
  })).toBe(3);

  // A V-belt drive makes the two sheaves and the belt.
  await page.getByRole('tab', { name: 'Mechanical' }).click();
  await page.locator('[data-cmd="vBelt"]').click();
  await expect(page.getByRole('heading', { name: 'V-Belt Drive' })).toBeVisible();
  await expect(page.locator('.pm-msg').filter({ hasText: 'belt length' })).toContainText('168.5°');
  await page.locator('.confirm-corner .ok').click();
  await expect(page.getByRole('treeitem', { name: 'V-Belt Drive1' })).toBeVisible();
  await page.evaluate(() => (window as unknown as Handle).__parametric.whenBuilt());

  // A sprocket sizes from the chain pitch and tooth count.
  await page.getByRole('tab', { name: 'Mechanical' }).click();
  await page.locator('[data-cmd="sprocket"]').click();
  await expect(page.getByRole('heading', { name: 'Sprocket' })).toBeVisible();
  await expect(page.locator('.pm-msg').filter({ hasText: 'Chain speed' })).toContainText('77.16 mm');
  await page.locator('.confirm-corner .ok').click();
  await expect(page.getByRole('treeitem', { name: 'Sprocket1' })).toBeVisible();
  await page.evaluate(() => (window as unknown as Handle).__parametric.whenBuilt());
  expect(errors).toEqual([]);
});

test('a transmission value that cannot be built keeps the panel open', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.getByRole('tab', { name: 'Mechanical' }).click();
  await page.locator('[data-cmd="vBelt"]').click();
  const center = page.getByRole('textbox', { name: 'Center distance' });
  await center.fill('50');
  await center.blur();
  await page.locator('.confirm-corner .ok').click();
  await expect(page.locator('.pm-msg.error')).toContainText('centre distance');
  await expect(page.getByRole('heading', { name: 'V-Belt Drive' })).toBeVisible();
  expect(errors).toEqual([]);
});
