import { expect, test } from '@playwright/test';
import type { PartDocument } from '../../src/model/types';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };

test('Duplicate Component copies a part beside the original', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.newAssembly('CopyTest');
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
    a.store.change('Insert component', (doc) => {
      doc.components = [{ id: 'c1', name: 'Plate', part, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, visible: true, fixed: true }];
    });
    await a.whenBuilt();
    a.selection.set([{ kind: 'component', id: 'c1' }]);
  });
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('duplicateComponent'));
  await page.waitForTimeout(1200);
  const state = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    return {
      count: a.store.doc.components!.length,
      copy: a.store.doc.components!.map((c) => ({ name: c.name, x: c.transform.position[0] })),
      selected: a.selection.ofKind('component').map((c) => c.id),
    };
  });
  expect(state.count).toBe(2);
  expect(state.copy[1].name).toMatch(/^Plate\d+$/);
  expect(state.copy[1].x).toBeGreaterThan(0);
  expect(state.selected).toHaveLength(1);
  expect(errors).toEqual([]);
});
