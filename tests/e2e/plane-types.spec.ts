import { expect, test } from '@playwright/test';
import { openApp } from './helpers';
import type { PlaneFeature } from '../../src/model/types';

type Handle = { __parametric: import('../../src/app/app').App };
const app = (page: import('@playwright/test').Page) => page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);

/** A 100 x 60 x 20 box on the front plane, fitted in the view. */
async function box(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /New part/ }).click();
  await app(page);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    const pts = [[0, 0], [100, 0], [100, 60], [0, 60]];
    a.store.change('Box', (d) => {
      d.features.push({
        id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          ...pts.map(([x, y], i) => ({ id: `p${i}`, t: 'point' as const, x, y })),
          ...pts.map((_, i) => ({ id: `l${i}`, t: 'line' as const, a: `p${i}`, b: `p${(i + 1) % 4}` })),
        ],
      });
      d.features.push({ id: 'e1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth: 20, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null });
    });
    await a.whenBuilt();
    a.viewport.zoomToFit(false);
  });
  await page.waitForTimeout(400);
}

test('a midplane is built halfway between two parallel faces', async ({ page }) => {
  const errors = await openApp(page);
  await box(page);
  // Fusion's construction plane set: offset, midplane, at angle, tangent,
  // through two edges and through three points.
  expect(await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    return ['plane', 'planeMidplane', 'planeAngle', 'planeTangent', 'planeTwoEdges', 'planeThreePoints'].every((id) => !!a.commands.get(id));
  })).toBe(true);
  await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const caps = a.faces.filter((f) => f.type === 'plane' && Math.abs(Math.abs(f.normal?.[2] ?? 0) - 1) < 1e-6);
    a.selection.set(caps.slice(0, 2).map((f) => ({ kind: 'face', index: a.faces.indexOf(f), name: f.name })));
    a.commands.run('planeMidplane');
  });
  await expect(page.getByRole('heading', { name: 'Midplane' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Second reference' })).toBeVisible();
  await page.locator('.confirm-corner .ok').click();
  await expect(page.getByRole('treeitem', { name: 'Plane1' })).toBeVisible();
  const frame = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const f = a.store.doc.features.find((x) => x.type === 'plane' && x.kind === 'midplane') as PlaneFeature;
    return { kind: f.kind, o: a.frames[f.id]?.o, n: a.frames[f.id]?.n };
  });
  expect(frame.kind).toBe('midplane');
  // Caps at z = 0 and z = 20.
  expect(frame.o![2]).toBeCloseTo(10, 6);
  expect(Math.abs(frame.n![2])).toBeCloseTo(1, 6);
  expect(errors).toEqual([]);
});

test('a plane at an angle rotates about an edge and its value box edits the angle', async ({ page }) => {
  const errors = await openApp(page);
  await box(page);
  await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const cap = a.faces.find((f) => f.type === 'plane' && Math.abs((f.normal?.[2] ?? 0) - 1) < 1e-6)!;
    const z = cap.center[2];
    const edge = a.edges.find((e) => e.type === 'line' && Math.abs(e.mid[2] - z) < 1e-4)!;
    a.selection.set([
      { kind: 'face', index: a.faces.indexOf(cap), name: cap.name },
      { kind: 'edge', index: a.edges.indexOf(edge), name: edge.name },
    ]);
    a.commands.run('planeAngle');
  });
  await expect(page.getByRole('heading', { name: 'Plane at Angle' })).toBeVisible();
  const value = page.locator('.cv-value input');
  await expect(value).toHaveValue('45.0°');
  await value.click();
  await value.fill('30');
  await value.press('Enter');
  await expect(page.locator('.pm-section:not([hidden]) input').first()).toHaveValue('30');
  await page.locator('.confirm-corner .ok').click();
  await expect(page.getByRole('treeitem', { name: 'Plane1' })).toBeVisible();
  const frame = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const f = a.store.doc.features.find((x) => x.type === 'plane' && x.kind === 'angle') as PlaneFeature;
    return { kind: f.kind, angle: f.angle, n: a.frames[f.id]?.n };
  });
  expect(frame.kind).toBe('angle');
  expect(frame.angle).toBe(30);
  // 30 degrees away from the cap's +Z normal.
  expect(Math.abs(frame.n![2])).toBeCloseTo(Math.cos(Math.PI / 6), 6);
  expect(errors).toEqual([]);
});

/** A cylinder along +Z: a 20 mm radius circle extruded 30 mm. */
async function cylinder(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /New part/ }).click();
  await app(page);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.store.change('Cylinder', (d) => {
      d.features.push({
        id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [],
        entities: [{ id: 'c1', t: 'point' as const, x: 0, y: 0 }, { id: 'c2', t: 'circle' as const, c: 'c1', r: 20 }],
      });
      d.features.push({ id: 'e1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth: 30, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null });
    });
    await a.whenBuilt();
    a.viewport.zoomToFit(false);
  });
  await page.waitForTimeout(400);
}

test('a tangent plane touches a cylindrical face', async ({ page }) => {
  const errors = await openApp(page);
  await cylinder(page);
  await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const face = a.faces.find((f) => f.type === 'cylinder')!;
    a.selection.set([{ kind: 'face', index: a.faces.indexOf(face), name: face.name }]);
    a.commands.run('planeTangent');
  });
  await expect(page.getByRole('heading', { name: 'Tangent Plane' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Curved face' })).toBeVisible();
  await page.locator('.confirm-corner .ok').click();
  await expect(page.getByRole('treeitem', { name: 'Plane1' })).toBeVisible();
  const frame = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const f = a.store.doc.features.find((x) => x.type === 'plane' && x.kind === 'tangent') as PlaneFeature;
    return { kind: f.kind, o: a.frames[f.id]?.o, n: a.frames[f.id]?.n };
  });
  expect(frame.kind).toBe('tangent');
  expect(Math.hypot(frame.o![0], frame.o![1])).toBeCloseTo(20, 3);
  expect(Math.abs(frame.n![2] ?? 1)).toBeLessThan(1e-6);
  expect(errors).toEqual([]);
});

test('a plane through two edges is built from straight edges', async ({ page }) => {
  const errors = await openApp(page);
  await box(page);
  await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const lines = a.edges.filter((e) => e.type === 'line' && Math.abs(e.mid[2]) < 1e-6);
    const alongX = lines.find((e) => Math.abs(e.b[1] - e.a[1]) < 1e-6)!;
    const alongY = lines.find((e) => Math.abs(e.b[0] - e.a[0]) < 1e-6)!;
    a.selection.set([alongX, alongY].map((e) => ({ kind: 'edge', index: a.edges.indexOf(e), name: e.name })));
    a.commands.run('planeTwoEdges');
  });
  await expect(page.getByRole('heading', { name: 'Plane Through Two Edges' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'First edge' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Second edge' })).toBeVisible();
  await page.locator('.confirm-corner .ok').click();
  await expect(page.getByRole('treeitem', { name: 'Plane1' })).toBeVisible();
  const frame = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const f = a.store.doc.features.find((x) => x.type === 'plane' && x.kind === 'twoEdges') as PlaneFeature;
    return { kind: f.kind, o: a.frames[f.id]?.o, n: a.frames[f.id]?.n };
  });
  expect(frame.kind).toBe('twoEdges');
  expect(Math.abs(frame.n![2])).toBeCloseTo(1, 6);
  expect(errors).toEqual([]);
});

test('a plane through three points is placed by the picked vertices', async ({ page }) => {
  const errors = await openApp(page);
  await box(page);
  await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    a.selection.set([
      { kind: 'vertex', p: [0, 0, 0] },
      { kind: 'vertex', p: [100, 0, 0] },
      { kind: 'vertex', p: [0, 60, 0] },
    ]);
    a.commands.run('planeThreePoints');
  });
  await expect(page.getByRole('heading', { name: 'Plane Through Three Points' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Point 1' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Point 3' })).toBeVisible();
  await page.locator('.confirm-corner .ok').click();
  await expect(page.getByRole('treeitem', { name: 'Plane1' })).toBeVisible();
  const frame = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const f = a.store.doc.features.find((x) => x.type === 'plane' && x.kind === 'threePoints') as PlaneFeature;
    return { kind: f.kind, o: a.frames[f.id]?.o, n: a.frames[f.id]?.n, points: f.points };
  });
  expect(frame.kind).toBe('threePoints');
  expect(frame.points).toHaveLength(3);
  expect(Math.abs(frame.n![2])).toBeCloseTo(1, 6);
  expect(errors).toEqual([]);
});
