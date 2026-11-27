import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type W = { __parametric: import('../../src/app/app').App };

test('Flat Pattern unfolds the sheet into a flat body', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.evaluate(async () => {
    const a = (window as unknown as W).__parametric;
    a.store.change('Flat part', (doc) => {
      doc.features.push(
        { id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          { id: 'p1', t: 'point', x: 0, y: 0 }, { id: 'p2', t: 'point', x: 30, y: 0 }, { id: 'p3', t: 'point', x: 30, y: 20 }, { id: 'p4', t: 'point', x: 0, y: 20 },
          { id: 'l1', t: 'line', a: 'p1', b: 'p2' }, { id: 'l2', t: 'line', a: 'p2', b: 'p3' }, { id: 'l3', t: 'line', a: 'p3', b: 'p4' }, { id: 'l4', t: 'line', a: 'p4', b: 'p1' },
        ] },
        { id: 'bf1', name: 'Base Flange1', type: 'baseFlange', sketch: 's1', thickness: 2, bendRadius: 2, flip: false },
      );
    });
    await a.whenBuilt();
    const edge = a.edges.find((e) => e.type === 'line' && Math.abs(e.mid[1] - 20) < 1e-6 && Math.abs(e.mid[2] - 2) < 1e-6 && Math.abs(Math.abs(e.dir![0]) - 1) < 1e-6)!;
    a.store.change('Edge flange', (doc) => {
      doc.features.push({ id: 'ef1', name: 'Edge Flange1', type: 'edgeFlange', edge: { name: edge.name, sig: { type: 'line', m: edge.mid, len: edge.length } }, length: 15, angle: 90, flip: false });
    });
    await a.whenBuilt();
  });
  await page.evaluate(() => (window as unknown as W).__parametric.commands.run('flatPattern'));
  await expect(page.getByRole('heading', { name: 'Flat Pattern' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'K factor', exact: true })).toBeVisible();
  await page.locator('.confirm-corner .ok').click();
  await page.waitForTimeout(900);
  await page.evaluate(() => (window as unknown as W).__parametric.whenBuilt());
  const res = await page.evaluate(() => {
    const a = (window as unknown as W).__parametric;
    return {
      feature: a.store.doc.features.some((f) => f.type === 'flatPattern'),
      thickness: Math.round((a.bbox!.max[2] - a.bbox!.min[2]) * 10) / 10,
      reach: Math.round(a.bbox!.max[1]),
    };
  });
  expect(res.feature).toBe(true);
  expect(res.thickness).toBe(2);
  expect(res.reach).toBeGreaterThan(38);
  expect(errors).toEqual([]);
});
