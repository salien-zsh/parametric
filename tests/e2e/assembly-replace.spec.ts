import { expect, test } from '@playwright/test';
import type { PartDocument } from '../../src/model/types';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };
const app = (page: import('@playwright/test').Page) => page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);

/** An assembly holding a base plate and a bracket. */
async function assembly(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /New part/ }).click();
  await app(page);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.newAssembly('ReplaceTest');
    const now = Date.now();
    const part = (name: string, w: number, d: number, h: number) => ({
      format: 'parametric-part', version: 1, kind: 'part', name, units: 'MMGS', decimals: 2, material: null, color: '#b8c4d2',
      variables: [], rollback: null, blobs: {}, components: [], nextId: 3, created: now, modified: now,
      features: [{
        id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          { id: 'p1', t: 'point', x: 0, y: 0 }, { id: 'p2', t: 'point', x: w, y: 0 }, { id: 'p3', t: 'point', x: w, y: d }, { id: 'p4', t: 'point', x: 0, y: d },
          { id: 'l1', t: 'line', a: 'p1', b: 'p2' }, { id: 'l2', t: 'line', a: 'p2', b: 'p3' }, { id: 'l3', t: 'line', a: 'p3', b: 'p4' }, { id: 'l4', t: 'line', a: 'p4', b: 'p1' },
        ],
      }, {
        id: 'e1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth: h, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null,
      }],
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

/** A part file the replacement picker can open. */
const replacement = (name: string) => JSON.stringify({
  format: 'parametric-part', version: 1, kind: 'part', name, units: 'MMGS', decimals: 2, material: null, color: '#b8c4d2',
  variables: [], rollback: null, blobs: {}, components: [], nextId: 3, created: Date.now(), modified: Date.now(),
  features: [
    {
      id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
        { id: 'p1', t: 'point', x: 0, y: 0 }, { id: 'p2', t: 'point', x: 20, y: 0 }, { id: 'p3', t: 'point', x: 20, y: 20 }, { id: 'p4', t: 'point', x: 0, y: 20 },
        { id: 'l1', t: 'line', a: 'p1', b: 'p2' }, { id: 'l2', t: 'line', a: 'p2', b: 'p3' }, { id: 'l3', t: 'line', a: 'p3', b: 'p4' }, { id: 'l4', t: 'line', a: 'p4', b: 'p1' },
      ],
    },
    { id: 'e1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth: 30, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null },
  ],
});

test('Replace Component swaps the part but keeps the component in place', async ({ page }) => {
  const errors = await openApp(page);
  await assembly(page);
  await page.evaluate(() => (window as unknown as Handle).__parametric.selection.set([{ kind: 'component', id: 'c2' }]));
  const chooserPromise = page.waitForEvent('filechooser');
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('replaceComponent'));
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'NewBracket.parametric', mimeType: 'application/json', buffer: Buffer.from(replacement('NewBracket')) });
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const component = a.store.doc.components!.find((c) => c.id === 'c2')!;
    return {
      part: component.part.name,
      position: component.transform.position,
      hasNewSize: a.faces.some((f) => f.component === 'c2' && Math.abs(f.center[2] - 15) < 6),
    };
  });
  expect(state.part).toBe('NewBracket');
  expect(state.position).toEqual([100, 0, 0]);
  expect(state.hasNewSize).toBe(true);
  expect(errors).toEqual([]);
});
