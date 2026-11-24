import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };
const app = (page: import('@playwright/test').Page) => page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);

/** A 60 x 60 x 30 plate with a 10 mm boss on top. */
async function plateWithBoss(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /New part/ }).click();
  await app(page);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    const pts = [[0, 0], [60, 0], [60, 60], [0, 60]];
    a.store.change('Plate with boss', (d) => {
      d.features.push({
        id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          ...pts.map(([x, y], i) => ({ id: `p${i}`, t: 'point' as const, x, y })),
          ...pts.map((_, i) => ({ id: `l${i}`, t: 'line' as const, a: `p${i}`, b: `p${(i + 1) % 4}` })),
        ],
      });
      d.features.push({ id: 'e1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth: 30, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null });
      d.features.push({
        id: 's2', name: 'Sketch2', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [],
        entities: [{ id: 'c1', t: 'point' as const, x: 30, y: 30 }, { id: 'c2', t: 'circle' as const, c: 'c1', r: 10 }],
      });
      d.features.push({ id: 'e2', name: 'Extrude2', type: 'extrude', sketch: 's2', cut: false, end: 'blind', depth: 50, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null });
    });
    await a.whenBuilt();
    a.viewport.setView('trimetric', false);
    a.viewport.zoomToFit(false);
  });
  await page.waitForTimeout(500);
}

test('a construction axis follows a cylinder and a point sits on a face centre', async ({ page }) => {
  const errors = await openApp(page);
  await plateWithBoss(page);

  // Axis of the boss.
  await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const cylinder = a.faces.find((f) => f.type === 'cylinder')!;
    a.selection.set([{ kind: 'face', index: a.faces.indexOf(cylinder), name: cylinder.name }]);
    a.commands.run('axisCylinder');
  });
  await expect(page.getByRole('heading', { name: 'Axis of a Cylinder' })).toBeVisible();
  await page.locator('.confirm-corner .ok').click();
  await expect(page.getByRole('treeitem', { name: 'Axis1' })).toBeVisible();
  await page.evaluate(() => (window as unknown as Handle).__parametric.whenBuilt());
  const axis = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const f = a.store.doc.features.find((x) => x.type === 'axis')!;
    return a.axes[f.id];
  });
  expect(axis).toBeTruthy();
  expect(Math.abs(axis.d[2])).toBeCloseTo(1, 4);

  // Point at the middle of the top face.
  await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const tops = a.faces.filter((f) => f.type === 'plane' && Math.abs((f.normal?.[2] ?? 0) - 1) < 1e-6);
    const top = tops.reduce((best, f) => (f.center[2] > best.center[2] ? f : best));
    a.selection.set([{ kind: 'face', index: a.faces.indexOf(top), name: top.name }]);
    a.commands.run('pointFaceCenter');
  });
  await expect(page.getByRole('heading', { name: 'Point at a Face Centre' })).toBeVisible();
  await page.locator('.confirm-corner .ok').click();
  await expect(page.getByRole('treeitem', { name: 'Point1' })).toBeVisible();
  await page.evaluate(() => (window as unknown as Handle).__parametric.whenBuilt());
  const point = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const f = a.store.doc.features.find((x) => x.type === 'point')!;
    return a.points[f.id];
  });
  expect(point[2]).toBeCloseTo(50, 4);
  expect(errors).toEqual([]);
});

test('sketching on the selected plane starts the sketch directly', async ({ page }) => {
  const errors = await openApp(page);
  await plateWithBoss(page);
  await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const tops = a.faces.filter((f) => f.type === 'plane' && Math.abs((f.normal?.[2] ?? 0) - 1) < 1e-6);
    const top = tops.reduce((best, f) => (f.center[2] > best.center[2] ? f : best));
    a.selection.set([{ kind: 'face', index: a.faces.indexOf(top), name: top.name }]);
    a.commands.run('sketchOnPlane');
  });
  await expect.poll(() => page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    return a.sketchEditor ? a.store.doc.features.at(-1)?.type : null;
  })).toBe('sketch');
  const started = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const sketch = a.store.doc.features.at(-1)!;
    return {
      plane: sketch.type === 'sketch' ? sketch.plane : null,
      topFace: a.selection.items.length ? null : (window as unknown as { __topFace?: string }).__topFace ?? null,
      editing: !!a.sketchEditor,
    };
  });
  expect(started.plane?.kind).toBe('face');
  expect(started.editing).toBe(true);
  expect(errors).toEqual([]);
});
