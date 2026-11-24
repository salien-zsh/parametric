import { expect, test } from '@playwright/test';
import type { PartDocument } from '../../src/model/types';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };

test('Hide hides the selected components and Show All brings them back', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.newAssembly('HideTest');
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
    a.selection.set([{ kind: 'component', id: 'c2' }]);
  });
  // Hide and Isolate are offered by the selection quick actions too.
  const quick = await page.evaluate(() => {
    const a = (window as unknown as { __parametric: { hooks: { quickActions(): { cmd: string }[] } } }).__parametric;
    return a.hooks.quickActions().map((action) => action.cmd);
  });
  expect(quick).toContain('hideComponents');
  expect(quick).toContain('isolateComponents');
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('hideComponents'));
  await page.waitForTimeout(900);
  const hidden = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    return { visible: a.store.doc.components!.map((c) => c.visible), faces: a.faces.filter((f) => f.component === 'c2').length };
  });
  expect(hidden.visible).toEqual([true, false]);
  expect(hidden.faces).toBe(0);
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('showAllComponents'));
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => (window as unknown as Handle).__parametric.store.doc.components!.map((c) => c.visible))).toEqual([true, true]);
  expect(errors).toEqual([]);
});
