import { expect, test } from '@playwright/test';
import { openApp, waitForFeature } from './helpers';

type W = { __parametric: import('../../src/app/app').App };

test('a tapped hole shows its thread size in the drawing callout', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.evaluate(async () => {
    const a = (window as unknown as W).__parametric;
    const pts = [[0, 0], [80, 0], [80, 60], [0, 60]];
    a.store.change('Block', (d) => {
      d.features.push({
        id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          ...pts.map(([x, y], i) => ({ id: `p${i}`, t: 'point' as const, x, y })),
          ...pts.map((_, i) => ({ id: `l${i}`, t: 'line' as const, a: `p${i}`, b: `p${(i + 1) % 4}` })),
        ],
      });
      d.features.push({ id: 'e1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth: 20, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null });
    });
    await a.whenBuilt();
    const top = a.faces.find((f) => f.type === 'plane' && (f.normal?.[2] ?? 0) > 0.99)!;
    const ref = { name: top.name, sig: { type: 'plane', c: top.center, n: top.normal!, area: top.area } };
    const fr = top.frame!;
    const dv = [top.center[0] - fr.o[0], top.center[1] - fr.o[1], top.center[2] - fr.o[2]];
    const dotV = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const lx = dotV(dv, fr.x), ly = dotV(dv, fr.y);
    a.store.change('Hole', (d) => {
      d.features.push({ id: 'hs', name: 'Hole positions', type: 'sketch', plane: { kind: 'face', face: ref }, frame: fr, entities: [{ id: 'hp', t: 'point', x: lx, y: ly }], constraints: [] });
      d.features.push({
        id: 'h1', name: 'Hole1', type: 'hole', sketch: 'hs', kind: 'tapped', diameter: 6, end: 'throughAll', depth: 20,
        cbDiameter: 10, cbDepth: 2, csDiameter: 10, csAngle: 90, tip: 'flat', flip: false,
        threadSize: 'M6x1', threadPitch: 1, tapDrillDiameter: 5, threadClass: '6H',
      });
    });
    await a.whenBuilt();
  });
  await page.evaluate(() => (window as unknown as W).__parametric.openDrawing());
  await expect(page.locator('.paper g[data-view]')).toHaveCount(4, { timeout: 30_000 });
  // The top view shows the tapped hole; turn its callouts on.
  await page.locator('.relations-list').getByRole('button', { name: 'Front', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Hole callouts in Front view' }).check();
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.paper svg text')].map((t) => t.textContent ?? '').join(' ')))
    .toContain('M6');
  expect(errors).toEqual([]);
});

test('the hole panel opens the position sketch for dimensioning', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /Mounting Bracket/ }).click();
  await waitForFeature(page, 'Fillet1');
  await page.getByRole('treeitem', { name: 'Hole1', exact: true }).dblclick();
  await expect(page.getByRole('heading', { name: 'Hole1' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit position sketch' }).click();
  await expect.poll(() => page.evaluate(() => !!(window as unknown as W).__parametric.sketchEditor)).toBe(true);
  // Leaving the sketch returns to the model with the hole still built.
  await page.locator('.confirm-corner .ok').click();
  await expect.poll(() => page.evaluate(() => !(window as unknown as W).__parametric.sketchEditor)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as W).__parametric.store.doc.features.some((f) => f.type === 'hole'))).toBe(true);
  expect(errors).toEqual([]);
});
