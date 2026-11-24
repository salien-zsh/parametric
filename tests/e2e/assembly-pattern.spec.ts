import { expect, test } from '@playwright/test';
import type { PartDocument } from '../../src/model/types';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };
const app = (page: import('@playwright/test').Page) => page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);

/** A base plate and a bracket standing beside it, ready to be patterned. */
async function twoParts(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /New part/ }).click();
  await app(page);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.newAssembly('PatternTest');
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
        { id: 'c2', name: 'Bracket', part: part('Bracket', 40, 30, 8), transform: { position: [100, 0, 0], rotation: [0, 0, 0] }, visible: true, fixed: false },
      ];
    });
    await a.whenBuilt();
    a.viewport.setView('trimetric', false);
    a.viewport.zoomToFit(false);
  });
  await page.waitForTimeout(700);
}

test('a rectangular component pattern copies the bracket along X', async ({ page }) => {
  const errors = await openApp(page);
  await twoParts(page);
  await page.evaluate(() => (window as unknown as Handle).__parametric.selection.set([{ kind: 'component', id: 'c2' }]));
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('componentPattern'));
  await expect(page.getByRole('heading', { name: 'Component Pattern' })).toBeVisible();
  // Rectangular, 3 along X at 50 mm.
  await page.getByLabel('Pattern type').selectOption('rectangular');
  await page.getByRole('textbox', { name: 'Spacing 1', exact: true }).fill('50');
  await page.getByRole('textbox', { name: 'Count 1', exact: true }).fill('3');
  await page.getByRole('textbox', { name: 'Count 1', exact: true }).press('Tab');
  await page.locator('.confirm-corner .ok').click();
  await page.waitForTimeout(1500);
  const result = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    return {
      patterns: a.store.doc.componentPatterns?.map((p) => ({ type: p.type, count1: p.count1, spacing1: p.spacing1 })),
      copies: a.faces.filter((f) => (f.component ?? '').startsWith('c2#')).length,
      bbox: a.bbox ? [Math.round(a.bbox.max[0]), Math.round(a.bbox.min[0])] : null,
    };
  });
  expect(result.patterns).toEqual([{ type: 'rectangular', count1: 3, spacing1: 50 }]);
  // Two copies of the bracket's six faces.
  expect(result.copies).toBeGreaterThanOrEqual(12);
  // The last copy ends at x = 100 + 40 + 100 = 240.
  expect(result.bbox![0]).toBe(240);
  expect(errors).toEqual([]);
});

test('Isolate hides the other parts and Show All brings them back', async ({ page }) => {
  const errors = await openApp(page);
  await twoParts(page);
  await page.evaluate(() => (window as unknown as Handle).__parametric.selection.set([{ kind: 'component', id: 'c1' }]));
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('isolateComponents'));
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => (window as unknown as Handle).__parametric.store.doc.components!.map((c) => c.visible))).toEqual([true, false]);
  // With the bracket hidden the built body is just the base.
  const shown = await page.evaluate(() => (window as unknown as Handle).__parametric.faces.filter((f) => f.component === 'c2').length);
  expect(shown).toBe(0);
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('showAllComponents'));
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => (window as unknown as Handle).__parametric.store.doc.components!.map((c) => c.visible))).toEqual([true, true]);
  const again = await page.evaluate(() => (window as unknown as Handle).__parametric.faces.filter((f) => f.component === 'c2').length);
  expect(again).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('pattern copies count in the assembly bill of materials', async ({ page }) => {
  const errors = await openApp(page);
  await twoParts(page);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.store.change('Pattern', (doc) => {
      doc.componentPatterns = [{
        id: 'p1', name: 'Array', type: 'rectangular', components: ['c2'],
        dir1: 'x', spacing1: 50, count1: 3, dir2: null, spacing2: 0, count2: 1,
      }];
    });
    await a.whenBuilt();
    a.commands.run('openDrawing');
  });
  await expect(page.locator('.paper')).toContainText('Bracket');
  // The BOM quantity for the patterned bracket is 3.
  const quantities = await page.evaluate(() => [...document.querySelectorAll('.paper svg text')].map((t) => t.textContent ?? ''));
  expect(quantities).toContain('3');
  expect(errors).toEqual([]);
});
