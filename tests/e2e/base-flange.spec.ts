import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type W = { __parametric: import('../../src/app/app').App };

test('Base Flange turns a sketch into a sheet-metal body', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  // The Sheet Metal tab offers the command.
  await page.getByRole('tab', { name: 'Sheet Metal' }).click();
  await expect(page.getByRole('button', { name: 'Base Flange' }).first()).toBeVisible();
  await page.evaluate(async () => {
    const a = (window as unknown as W).__parametric;
    a.store.change('Flange', (doc) => {
      doc.features.push({
        id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          { id: 'p1', t: 'point', x: 0, y: 0 }, { id: 'p2', t: 'point', x: 30, y: 0 }, { id: 'p3', t: 'point', x: 30, y: 20 }, { id: 'p4', t: 'point', x: 0, y: 20 },
          { id: 'l1', t: 'line', a: 'p1', b: 'p2' }, { id: 'l2', t: 'line', a: 'p2', b: 'p3' }, { id: 'l3', t: 'line', a: 'p3', b: 'p4' }, { id: 'l4', t: 'line', a: 'p4', b: 'p1' },
        ],
      });
    });
    await a.whenBuilt();
    a.selection.set([{ kind: 'feature', id: 's1' }]);
  });
  await page.evaluate(() => (window as unknown as W).__parametric.commands.run('baseFlange'));
  await expect(page.getByRole('heading', { name: 'Base Flange' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Sheet thickness', exact: true }).fill('2');
  await page.getByRole('textbox', { name: 'Sheet thickness', exact: true }).press('Tab');
  await page.locator('.confirm-corner .ok').click();
  await page.waitForTimeout(700);
  await page.evaluate(() => (window as unknown as W).__parametric.whenBuilt());
  const res = await page.evaluate(() => {
    const a = (window as unknown as W).__parametric;
    return {
      feature: a.store.doc.features.some((f) => f.type === 'baseFlange'),
      bodies: a.bodyCount,
      thickness: Math.round((a.bbox!.max[2] - a.bbox!.min[2]) * 100) / 100,
    };
  });
  expect(res.feature).toBe(true);
  expect(res.bodies).toBe(1);
  expect(res.thickness).toBe(2);
  expect(errors).toEqual([]);
});
