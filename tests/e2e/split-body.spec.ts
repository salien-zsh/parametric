import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };

test('Split Body keeps one side of the plane', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.store.change('Plate', (doc) => {
      doc.features.push(
        { id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          { id: 'p1', t: 'point', x: 0, y: 0 }, { id: 'p2', t: 'point', x: 40, y: 0 }, { id: 'p3', t: 'point', x: 40, y: 40 }, { id: 'p4', t: 'point', x: 0, y: 40 },
          { id: 'l1', t: 'line', a: 'p1', b: 'p2' }, { id: 'l2', t: 'line', a: 'p2', b: 'p3' }, { id: 'l3', t: 'line', a: 'p3', b: 'p4' }, { id: 'l4', t: 'line', a: 'p4', b: 'p1' },
        ] },
        { id: 'e1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth: 10, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null },
      );
    });
    await a.whenBuilt();
  });
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('splitBody'));
  await expect(page.getByRole('heading', { name: 'Split Body' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Split offset', exact: true }).fill('20');
  await page.getByRole('textbox', { name: 'Split offset', exact: true }).press('Tab');
  await page.locator('.confirm-corner .ok').click();
  await page.waitForTimeout(700);
  await page.evaluate(() => (window as unknown as Handle).__parametric.whenBuilt());
  const res = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    return {
      feature: a.store.doc.features.some((f) => f.type === 'splitBody'),
      minX: Math.round(a.bbox!.min[0]),
      maxX: Math.round(a.bbox!.max[0]),
    };
  });
  expect(res.feature).toBe(true);
  expect(res.minX).toBe(20);
  expect(res.maxX).toBe(40);
  expect(errors).toEqual([]);
});
