import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type W = { __parametric: import('../../src/app/app').App };

test('Edge Flange bends a wall from a selected sheet edge', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  const edgeIndex = await page.evaluate(async () => {
    const a = (window as unknown as W).__parametric;
    a.store.change('Flange part', (doc) => {
      doc.features.push(
        { id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          { id: 'p1', t: 'point', x: 0, y: 0 }, { id: 'p2', t: 'point', x: 30, y: 0 }, { id: 'p3', t: 'point', x: 30, y: 20 }, { id: 'p4', t: 'point', x: 0, y: 20 },
          { id: 'l1', t: 'line', a: 'p1', b: 'p2' }, { id: 'l2', t: 'line', a: 'p2', b: 'p3' }, { id: 'l3', t: 'line', a: 'p3', b: 'p4' }, { id: 'l4', t: 'line', a: 'p4', b: 'p1' },
        ] },
        { id: 'bf1', name: 'Base Flange1', type: 'baseFlange', sketch: 's1', thickness: 2, bendRadius: 2, flip: false },
      );
    });
    await a.whenBuilt();
    // The top edge running along X at y = 20, z = 2.
    const index = a.edges.findIndex((e) => e.type === 'line' && Math.abs(e.mid[1] - 20) < 1e-6 && Math.abs(e.mid[2] - 2) < 1e-6 && Math.abs(Math.abs(e.dir![0]) - 1) < 1e-6);
    a.selection.set([{ kind: 'edge', index, name: a.edges[index].name }]);
    return index;
  });
  expect(edgeIndex).toBeGreaterThanOrEqual(0);
  await page.evaluate(() => (window as unknown as W).__parametric.commands.run('edgeFlange'));
  await expect(page.getByRole('heading', { name: 'Edge Flange' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Edge' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Flange length', exact: true }).fill('15');
  await page.getByRole('textbox', { name: 'Flange length', exact: true }).press('Tab');
  await page.locator('.confirm-corner .ok').click();
  await page.waitForTimeout(800);
  await page.evaluate(() => (window as unknown as W).__parametric.whenBuilt());
  const res = await page.evaluate(() => {
    const a = (window as unknown as W).__parametric;
    return {
      feature: a.store.doc.features.some((f) => f.type === 'edgeFlange'),
      top: Math.round((a.bbox!.max[2] - 2) * 10) / 10,
    };
  });
  expect(res.feature).toBe(true);
  expect(res.top).toBeGreaterThan(13);
  expect(errors).toEqual([]);
});
