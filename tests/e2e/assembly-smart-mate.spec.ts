import { expect, test } from '@playwright/test';
import type { PartDocument } from '../../src/model/types';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };
const app = (page: import('@playwright/test').Page) => page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);

/** A 60 x 40 x 10 base and a 40 x 30 x 8 lid floating above it. */
async function twoPlates(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /New part/ }).click();
  await app(page);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.newAssembly('Smart');
    const now = Date.now();
    const part = (name: string, w: number, d: number, h: number) => ({
      format: 'parametric-part', version: 1, kind: 'part', name, units: 'MMGS', decimals: 2, material: null, color: '#b8c4d2',
      variables: [], rollback: null, blobs: {}, components: [], nextId: 3, created: now, modified: now,
      features: [
        {
          id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
            { id: 'p1', t: 'point', x: 0, y: 0 }, { id: 'p2', t: 'point', x: w, y: 0 }, { id: 'p3', t: 'point', x: w, y: d }, { id: 'p4', t: 'point', x: 0, y: d },
            { id: 'l1', t: 'line', a: 'p1', b: 'p2' }, { id: 'l2', t: 'line', a: 'p2', b: 'p3' }, { id: 'l3', t: 'line', a: 'p3', b: 'p4' }, { id: 'l4', t: 'line', a: 'p4', b: 'p1' },
          ],
        },
        { id: 'e1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth: h, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null },
      ],
    }) as unknown as PartDocument;
    a.store.change('Insert components', (doc) => {
      doc.components = [
        { id: 'c1', name: 'Base', part: part('Base', 60, 40, 10), transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, visible: true, fixed: true },
        { id: 'c2', name: 'Lid', part: part('Lid', 40, 30, 8), transform: { position: [12, 6, 34], rotation: [0, 0, 0] }, visible: true, fixed: false },
      ];
    });
    await a.whenBuilt();
    a.viewport.setView('trimetric', false);
    a.viewport.zoomToFit(false);
  });
  await page.waitForTimeout(700);
}

async function pixelOver(page: import('@playwright/test').Page, componentId: string) {
  return page.evaluate((id) => {
    const a = (window as unknown as Handle).__parametric;
    const c = a.viewport.canvas.getBoundingClientRect();
    for (let y = c.top + 60; y < c.bottom - 40; y += 16) {
      for (let x = c.left + 40; x < c.right - 40; x += 16) {
        const item = a.viewport.pickItem(x - c.left, y - c.top, { face: true });
        if (a.componentOfItem(item)?.id === id) return { x, y };
      }
    }
    throw new Error(`no pixel over ${id}`);
  }, componentId);
}

const menuLabels = (page: import('@playwright/test').Page) => page.evaluate(() =>
  [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent?.trim() ?? '').filter(Boolean));

test('right-clicking a part offers the assembly operations', async ({ page }) => {
  const errors = await openApp(page);
  await twoPlates(page);
  const lid = await pixelOver(page, 'c2');
  await page.mouse.click(lid.x, lid.y, { button: 'right' });
  await page.waitForTimeout(500);
  const labels = await menuLabels(page);
  for (const label of ['Move/Rotate', 'Auto Mate', 'Joint...', 'Mate Suggestions...', 'Fix/Float Component']) {
    expect(labels).toContain(label);
  }
  // The clicked face is remembered, so the geometry-specific fits are offered.
  expect(await page.evaluate(() => (window as unknown as Handle).__parametric.assemblyPick?.componentId)).toBe('c2');
  await page.keyboard.press('Escape');
  await page.mouse.click(lid.x, lid.y, { button: 'right' });
  await page.waitForTimeout(400);
  const faceMenu = await menuLabels(page);
  expect(faceMenu).toContain('Auto Mate This Face');
  expect(faceMenu).toContain('Joint From This Geometry...');
  expect(errors).toEqual([]);
});

test('Auto Mate constrains the best fitting faces without a panel', async ({ page }) => {
  const errors = await openApp(page);
  await twoPlates(page);
  await page.evaluate(() => (window as unknown as Handle).__parametric.selection.set([
    { kind: 'component', id: 'c1' }, { kind: 'component', id: 'c2' },
  ]));
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('autoMate'));
  await page.waitForTimeout(1400);
  const result = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const joint = (a.store.doc.joints ?? [])[0];
    const solved = a.solvedComponentTransforms();
    return { joint: joint ? { type: joint.type, a: joint.aRef?.kind, b: joint.bRef?.kind } : null, lid: solved.get('c2')?.position };
  });
  expect(result.joint).toMatchObject({ type: 'planar', a: 'face', b: 'face' });
  // The lid's bottom face now meets the base's top face at z = 10.
  expect(result.lid![2]).toBeCloseTo(10, 1);
  expect(errors).toEqual([]);
});

test('the Joint panel picks the best fit by itself', async ({ page }) => {
  const errors = await openApp(page);
  await twoPlates(page);
  await page.evaluate(() => (window as unknown as Handle).__parametric.selection.set([
    { kind: 'component', id: 'c1' }, { kind: 'component', id: 'c2' },
  ]));
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('addJoint'));
  await expect(page.getByRole('heading', { name: 'Joint' })).toBeVisible();
  const selects = await page.evaluate(() => [...document.querySelectorAll<HTMLSelectElement>('.pm-section select')].map((s) => s.value));
  expect(selects[1]).toMatch(/^(face|edge):\d+$/);
  expect(selects[2]).toMatch(/^(face|edge):\d+$/);
  await expect(page.getByText('Suggested fits')).toBeVisible();
  // A suggestion row re-picks another fit.
  const suggestionCount = await page.locator('.pm-suggestion').count();
  expect(suggestionCount).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('Mate Suggestions lists fits and applies one', async ({ page }) => {
  const errors = await openApp(page);
  await twoPlates(page);
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('mateSuggestions'));
  await expect(page.getByRole('heading', { name: 'Mate Suggestions' })).toBeVisible();
  await expect(page.locator('.pm-suggestion-row').first()).toBeVisible();
  const before = await page.locator('.pm-suggestion-row').count();
  expect(before).toBeGreaterThan(0);
  await page.locator('.pm-suggestion-row .pm-suggestion-apply').first().click();
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => (window as unknown as Handle).__parametric.store.doc.joints?.length ?? 0)).toBe(1);
  expect(errors).toEqual([]);
});
