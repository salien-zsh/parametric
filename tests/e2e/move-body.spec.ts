import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };

test('Move Body shifts the whole part by the offsets', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.store.change('Plate', (doc) => {
      doc.features.push(
        { id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          { id: 'p1', t: 'point', x: 0, y: 0 }, { id: 'p2', t: 'point', x: 60, y: 0 }, { id: 'p3', t: 'point', x: 60, y: 40 }, { id: 'p4', t: 'point', x: 0, y: 40 },
          { id: 'l1', t: 'line', a: 'p1', b: 'p2' }, { id: 'l2', t: 'line', a: 'p2', b: 'p3' }, { id: 'l3', t: 'line', a: 'p3', b: 'p4' }, { id: 'l4', t: 'line', a: 'p4', b: 'p1' },
        ] },
        { id: 'e1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth: 10, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null },
      );
    });
    await a.whenBuilt();
  });
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('moveBody'));
  await expect(page.getByRole('heading', { name: 'Move Body' })).toBeVisible();
  await page.getByRole('textbox', { name: 'X offset', exact: true }).fill('10');
  await page.getByRole('textbox', { name: 'Z rotation', exact: true }).fill('90');
  await page.getByRole('textbox', { name: 'Z rotation', exact: true }).press('Tab');
  await page.locator('.confirm-corner .ok').click();
  await page.waitForTimeout(600);
  await page.evaluate(() => (window as unknown as Handle).__parametric.whenBuilt());
  await page.waitForTimeout(300);
  const state = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    return {
      feature: a.store.doc.features.some((f) => f.type === 'moveBody'),
      minX: a.bbox ? Math.round(a.bbox.min[0]) : null,
      maxY: a.bbox ? Math.round(a.bbox.max[1]) : null,
    };
  });
  expect(state.feature).toBe(true);
  expect(state.minX).toBe(-40);
  expect(state.maxY).toBe(70);
  expect(errors).toEqual([]);
});
