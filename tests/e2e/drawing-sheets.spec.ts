import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { openApp, waitForFeature } from './helpers';

type W = { __parametric: import('../../src/app/app').App };

test('drawings have several sheets and export one PDF page each', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /Mounting Bracket/ }).click();
  await waitForFeature(page, 'Fillet1');
  await page.evaluate(() => (window as unknown as W).__parametric.openDrawing());
  await expect(page.locator('.paper g[data-view]')).toHaveCount(4, { timeout: 30_000 });

  // A second sheet starts empty and becomes the active one.
  await page.getByRole('button', { name: 'Add sheet' }).click();
  await expect(page.getByRole('button', { name: 'Sheet 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.paper g[data-view]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as W).__parametric.store.doc.drawing!.sheets?.length ?? 0)).toBe(1);

  // Put a front view on it.
  await page.getByRole('combobox', { name: 'View to add' }).selectOption('front');
  await page.getByRole('button', { name: 'Add view' }).click();
  await expect(page.locator('.paper g[data-view]')).toHaveCount(1, { timeout: 30_000 });

  // Switching back to the first sheet shows its four views again.
  await page.getByRole('button', { name: 'Sheet 1', exact: true }).click();
  await expect(page.locator('.paper g[data-view]')).toHaveCount(4, { timeout: 30_000 });

  // The PDF has both sheets.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  const file = await download;
  const bytes = await readFile((await file.path())!);
  const text = new TextDecoder('latin1').decode(bytes);
  expect(text).toContain('/Count 2');
  expect(text.split('\n').filter((line) => line === 'stream').length).toBe(2);
  expect(errors).toEqual([]);
});
