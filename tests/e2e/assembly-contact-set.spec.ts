import { expect, test } from '@playwright/test';
import type { PartDocument } from '../../src/model/types';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };

test('a contact set moves its components together', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.newAssembly('ContactSet');
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
        { id: 'c1', name: 'A', part, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, visible: true, fixed: false },
        { id: 'c2', name: 'B', part, transform: { position: [40, 0, 0], rotation: [0, 0, 0] }, visible: true, fixed: false },
      ];
    });
    await a.whenBuilt();
    a.selection.set([{ kind: 'component', id: 'c1' }, { kind: 'component', id: 'c2' }]);
    a.commands.run('contactSet');
  });
  await page.waitForTimeout(500);
  const created = await page.evaluate(() => (window as unknown as Handle).__parametric.store.doc.contactSets ?? []);
  expect(created).toEqual([['c1', 'c2']]);

  const afterMove = await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.setComponentTransforms(new Map([['c1', { position: [50, 0, 0], rotation: [0, 0, 0] }]]));
    await a.whenBuilt();
    return a.store.doc.components!.map((c) => ({ id: c.id, x: c.transform.position[0] }));
  });
  expect(afterMove).toEqual([{ id: 'c1', x: 50 }, { id: 'c2', x: 90 }]);

  // Clearing the sets makes the parts independent again.
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('clearContactSets'));
  await page.waitForTimeout(300);
  const cleared = await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.setComponentTransforms(new Map([['c1', { position: [60, 0, 0], rotation: [0, 0, 0] }]]));
    await a.whenBuilt();
    return { sets: a.store.doc.contactSets ?? [], parts: a.store.doc.components!.map((c) => ({ id: c.id, x: c.transform.position[0] })) };
  });
  expect(cleared.sets).toEqual([]);
  expect(cleared.parts).toEqual([{ id: 'c1', x: 60 }, { id: 'c2', x: 90 }]);
  // Editing a member's position in its properties moves the set as well.
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.selection.set([{ kind: 'component', id: 'c1' }, { kind: 'component', id: 'c2' }]);
    a.commands.run('contactSet');
    await a.whenBuilt();
    a.updateComponent('c1', { transform: { position: [70, 0, 0], rotation: [0, 0, 0] } });
    await a.whenBuilt();
  });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as unknown as Handle).__parametric.store.doc.components!.map((c) => c.transform.position[0]))).toEqual([70, 100]);
  expect(errors).toEqual([]);
});
