import { expect, test } from '@playwright/test';
import type { PartDocument } from '../../src/model/types';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };

test('Exploded View moves the components apart and persists', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.newAssembly('ExplodeTest');
    const now = Date.now();
    const part = {
      format: 'parametric-part', version: 1, kind: 'part', name: 'Plate', units: 'MMGS', decimals: 2, material: null, color: '#b8c4d2',
      variables: [], rollback: null, blobs: {}, components: [], nextId: 3, created: now, modified: now,
      features: [{
        id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          { id: 'p1', t: 'point', x: 0, y: 0 }, { id: 'p2', t: 'point', x: 20, y: 0 }, { id: 'p3', t: 'point', x: 20, y: 10 }, { id: 'p4', t: 'point', x: 0, y: 10 },
          { id: 'l1', t: 'line', a: 'p1', b: 'p2' }, { id: 'l2', t: 'line', a: 'p2', b: 'p3' }, { id: 'l3', t: 'line', a: 'p3', b: 'p4' }, { id: 'l4', t: 'line', a: 'p4', b: 'p1' },
        ],
      }, {
        id: 'e1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth: 5, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null,
      }],
    } as unknown as PartDocument;
    a.store.change('Insert components', (doc) => {
      doc.components = [
        { id: 'c1', name: 'A', part, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, visible: true, fixed: true },
        { id: 'c2', name: 'B', part, transform: { position: [40, 0, 0], rotation: [0, 0, 0] }, visible: true, fixed: false },
      ];
    });
    await a.whenBuilt();
  });
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('explodeView'));
  await expect(page.getByRole('heading', { name: 'Exploded View' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Explode distance', exact: true }).fill('30');
  await page.getByRole('textbox', { name: 'Explode distance', exact: true }).press('Tab');
  await page.waitForTimeout(900);
  await page.evaluate(() => (window as unknown as Handle).__parametric.whenBuilt());
  const state = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    return {
      explode: a.store.doc.explode ?? null,
      minX: Math.round(a.bbox!.min[0]),
      maxX: Math.round(a.bbox!.max[0]),
      components: a.store.doc.components!.length,
    };
  });
  expect(state.explode).toBe(30);
  expect(state.components).toBe(2);
  expect(state.minX).toBeLessThan(0);
  expect(state.maxX).toBeGreaterThan(60);
  // An axis explosion pushes every part to its own side of that axis instead.
  await page.getByRole('combobox', { name: 'Explode axis' }).selectOption('y');
  await page.waitForTimeout(900);
  await page.evaluate(() => (window as unknown as Handle).__parametric.whenBuilt());
  const axis = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    return { axis: a.store.doc.explodeAxis ?? null, minX: Math.round(a.bbox!.min[0]), minY: Math.round(a.bbox!.min[1]) };
  });
  expect(axis.axis).toBe('y');
  expect(axis.minX).toBe(0);
  expect(axis.minY).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});
