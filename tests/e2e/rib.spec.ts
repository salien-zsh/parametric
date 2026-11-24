import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };
const app = (page: import('@playwright/test').Page) => page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);

test('a rib thickens a sketch line into a wall on the plate', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await app(page);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.store.change('Plate and line', (doc) => {
      doc.features.push(
        {
          id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
            { id: 'p1', t: 'point', x: 0, y: 0 }, { id: 'p2', t: 'point', x: 60, y: 0 }, { id: 'p3', t: 'point', x: 60, y: 40 }, { id: 'p4', t: 'point', x: 0, y: 40 },
            { id: 'l1', t: 'line', a: 'p1', b: 'p2' }, { id: 'l2', t: 'line', a: 'p2', b: 'p3' }, { id: 'l3', t: 'line', a: 'p3', b: 'p4' }, { id: 'l4', t: 'line', a: 'p4', b: 'p1' },
          ],
        },
        { id: 'e1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth: 10, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null },
        {
          id: 's2', name: 'RibLine', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
            { id: 'ra', t: 'point', x: 0, y: 20 }, { id: 'rb', t: 'point', x: 60, y: 20 }, { id: 'rl', t: 'line', a: 'ra', b: 'rb' },
          ],
        },
      );
    });
    await a.whenBuilt();
    a.selection.set([{ kind: 'feature', id: 's2' }]);
  });
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('rib'));
  await expect(page.getByRole('heading', { name: 'Rib' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Thickness', exact: true }).fill('4');
  await page.getByRole('textbox', { name: 'Depth', exact: true }).fill('20');
  await page.getByRole('textbox', { name: 'Depth', exact: true }).press('Tab');
  await page.locator('.confirm-corner .ok').click();
  await page.waitForTimeout(600);
  await page.evaluate(() => (window as unknown as Handle).__parametric.whenBuilt());
  await page.waitForTimeout(400);
  const state = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const feature = a.store.doc.features.find((f) => f.type === 'rib');
    return {
      rib: feature ? { thickness: feature.thickness, depth: feature.depth, sketch: feature.sketch } : null,
      bbox: a.bbox ? [Math.round(a.bbox.min[2] * 10) / 10, Math.round(a.bbox.max[2] * 10) / 10] : null,
    };
  });
  expect(state.rib).toMatchObject({ thickness: 4, depth: 20, sketch: 's2' });
  expect(state.bbox).toEqual([0, 20]);
  expect(errors).toEqual([]);
});
