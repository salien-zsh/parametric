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
