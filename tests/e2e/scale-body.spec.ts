import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };

test('Scale Body scales the part from the panel', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.store.change('Plate', (doc) => {
      doc.features.push(
        { id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          { id: 'p1', t: 'point', x: 0, y: 0 }, { id: 'p2', t: 'point', x: 20, y: 0 }, { id: 'p3', t: 'point', x: 20, y: 20 }, { id: 'p4', t: 'point', x: 0, y: 20 },
          { id: 'l1', t: 'line', a: 'p1', b: 'p2' }, { id: 'l2', t: 'line', a: 'p2', b: 'p3' }, { id: 'l3', t: 'line', a: 'p3', b: 'p4' }, { id: 'l4', t: 'line', a: 'p4', b: 'p1' },
        ] },
        { id: 'e1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth: 10, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null },
      );
    });
    await a.whenBuilt();
  });
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('scaleBody'));
  await expect(page.getByRole('heading', { name: 'Scale Body' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Scale factor', exact: true }).fill('2');
  await page.getByRole('textbox', { name: 'Scale factor', exact: true }).press('Tab');
  await page.locator('.confirm-corner .ok').click();
  await page.waitForTimeout(700);
  await page.evaluate(() => (window as unknown as Handle).__parametric.whenBuilt());
  const res = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    return {
      feature: a.store.doc.features.some((f) => f.type === 'scaleBody'),
      x: Math.round(a.bbox!.max[0]),
      z: Math.round(a.bbox!.max[2]),
    };
  });
  expect(res.feature).toBe(true);
  expect(res.x).toBe(40);
  expect(res.z).toBe(20);
  expect(errors).toEqual([]);
});
