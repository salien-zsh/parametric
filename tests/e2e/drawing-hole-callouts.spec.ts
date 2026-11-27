import { expect, test } from '@playwright/test';
import { openApp, waitForFeature } from './helpers';

type W = { __parametric: import('../../src/app/app').App };

test('a drawing view can add Fusion-style hole callouts', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /Mounting Bracket/ }).click();
  await waitForFeature(page, 'Fillet1');
  await page.evaluate(() => (window as unknown as W).__parametric.openDrawing());
  await expect(page.locator('.paper g[data-view]')).toHaveCount(4, { timeout: 30_000 });

  const text = () => page.evaluate(() => [...document.querySelectorAll('.paper svg text')].map((t) => t.textContent ?? '').join(' '));
  expect(await text()).not.toContain('Ø');

  // Select the front view and switch its hole callouts on.
  await page.locator('.relations-list').getByRole('button', { name: 'Front', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Hole callouts in Front view' }).check();
  await expect.poll(text).toContain('Ø');
  await expect(page.getByRole('checkbox', { name: 'Hole callouts in Front view' })).toBeChecked();
  expect(errors).toEqual([]);
});
