import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };

test('a hole can stop at a planar face and the panel switches end conditions', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    const pts = [[0, 0], [80, 0], [80, 60], [0, 60]];
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
    const caps = a.faces.filter((f) => f.type === 'plane' && Math.abs(Math.abs(f.normal?.[2] ?? 0) - 1) < 1e-6);
    const top = caps.find((f) => (f.normal?.[2] ?? 0) > 0.99)!;
    const bottom = caps.find((f) => (f.normal?.[2] ?? 0) < -0.99)!;
    const ref = (f: typeof top) => ({ name: f.name, sig: { type: 'plane', c: f.center, n: f.normal!, area: f.area } });
    a.store.change('Hole', (d) => {
      d.features.push({ id: 'hs', name: 'Hole positions', type: 'sketch', plane: { kind: 'face', face: ref(top) }, entities: [{ id: 'hp', t: 'point', x: 0, y: 0 }], constraints: [] });
      d.features.push({
        id: 'h1', name: 'Hole1', type: 'hole', sketch: 'hs', kind: 'simple', diameter: 6, end: 'toObject', depth: 5,
        cbDiameter: 10, cbDepth: 2, csDiameter: 10, csAngle: 90, toFace: ref(bottom), tip: 'flat', flip: false,
      });
    });
    await a.whenBuilt();
    a.viewport.zoomToFit(false);
  });
  await page.getByRole('treeitem', { name: 'Hole1', exact: true }).dblclick();
  await expect(page.getByRole('heading', { name: 'Hole1' })).toBeVisible();
  const end = page.getByRole('combobox', { name: 'End condition' });
  await expect(end).toHaveValue('toObject');
  await expect(page.getByRole('group', { name: 'Stop at face' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Depth', exact: true })).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as Handle).__parametric.store.doc.features.find((f) => f.id === 'h1'))).toMatchObject({ end: 'toObject' });

  // Switching to a blind hole shows the depth and drill point instead.
  await end.selectOption('blind');
  await expect(page.getByRole('textbox', { name: 'Depth', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Stop at face' })).toBeHidden();

  // Fusion-style hole type buttons switch the size fields and the Threads section.
  const types = page.getByRole('group', { name: 'Hole type' });
  await expect(types.getByRole('button', { name: 'Simple', exact: true })).toBeVisible();
  await types.getByRole('button', { name: 'Counterbore', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Counterbore diameter', exact: true })).toBeVisible();
  await types.getByRole('button', { name: 'Tapped', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Thread size' })).toBeVisible();

  // Threads follow Fusion: standard first, then the sizes of that standard.
  const standard = page.getByRole('combobox', { name: 'Thread standard' });
  await expect(standard).toBeVisible();
  await standard.selectOption('unc');
  await page.getByRole('combobox', { name: 'Thread size' }).selectOption({ label: '#10-24 UNC' });
  // Panel edits are cloned until OK applies them.
  await page.locator('.panel-layer .pm-actions .ok').click();
  await page.waitForTimeout(600);
  const threaded = await page.evaluate(() => {
    const f = (window as unknown as Handle).__parametric.store.doc.features.find((x) => x.id === 'h1') as unknown as { threadSize?: string; diameter: number; kind: string };
    return { size: f.threadSize, diameter: Number(f.diameter), kind: f.kind };
  });
  expect(threaded.kind).toBe('tapped');
  expect(threaded.size).toBe('10-24');
  expect(threaded.diameter).toBeCloseTo(4.826, 2);
  expect(errors).toEqual([]);
});
