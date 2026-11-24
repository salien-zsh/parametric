import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };
const app = (page: import('@playwright/test').Page) => page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);

test('a coil sweeps an offset circle into a spring', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await app(page);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.store.change('Sketch', (doc) => {
      doc.features.push({
        id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          { id: 'p1', t: 'point', x: 10, y: 0 }, { id: 'c1', t: 'circle', c: 'p1', r: 3 },
        ],
      });
    });
    await a.whenBuilt();
    a.selection.set([{ kind: 'feature', id: 's1' }]);
  });
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('coil'));
  await expect(page.getByRole('heading', { name: 'Coil' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Pitch', exact: true }).fill('5');
  await page.getByRole('textbox', { name: 'Revolutions', exact: true }).fill('4');
  await page.getByRole('textbox', { name: 'Revolutions', exact: true }).press('Tab');
  await page.locator('.confirm-corner .ok').click();
  await page.waitForTimeout(600);
  await page.evaluate(() => (window as unknown as Handle).__parametric.whenBuilt());
  await page.waitForTimeout(400);
  const state = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const feature = a.store.doc.features.find((f) => f.type === 'coil');
    return {
      coil: feature ? { pitch: feature.pitch, revolutions: feature.revolutions, profile: feature.profile } : null,
      bbox: a.bbox ? [Math.round(a.bbox.min[2]), Math.round(a.bbox.max[2])] : null,
    };
  });
  expect(state.coil).toMatchObject({ pitch: 5, revolutions: 4, profile: 's1' });
  // Four turns of 5 mm: about 20 mm plus the profile's diameter.
  expect(state.bbox![1] - state.bbox![0]).toBeGreaterThan(18);
  expect(state.bbox![1] - state.bbox![0]).toBeLessThan(30);
  expect(errors).toEqual([]);
});
