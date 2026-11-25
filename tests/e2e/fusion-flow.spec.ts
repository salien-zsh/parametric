import { expect, test } from '@playwright/test';
import type { PartDocument } from '../../src/model/types';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };

test('Extrude lets a sketch profile be unchecked before it is built', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.store.change('Profiles', (doc) => {
      doc.features.push({
        id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          { id: 'p1', t: 'point', x: 0, y: 0 }, { id: 'p2', t: 'point', x: 10, y: 0 }, { id: 'p3', t: 'point', x: 10, y: 10 }, { id: 'p4', t: 'point', x: 0, y: 10 },
          { id: 'l1', t: 'line', a: 'p1', b: 'p2' }, { id: 'l2', t: 'line', a: 'p2', b: 'p3' }, { id: 'l3', t: 'line', a: 'p3', b: 'p4' }, { id: 'l4', t: 'line', a: 'p4', b: 'p1' },
          { id: 'q1', t: 'point', x: 30, y: 0 }, { id: 'q2', t: 'point', x: 40, y: 0 }, { id: 'q3', t: 'point', x: 40, y: 10 }, { id: 'q4', t: 'point', x: 30, y: 10 },
          { id: 'm1', t: 'line', a: 'q1', b: 'q2' }, { id: 'm2', t: 'line', a: 'q2', b: 'q3' }, { id: 'm3', t: 'line', a: 'q3', b: 'q4' }, { id: 'm4', t: 'line', a: 'q4', b: 'q1' },
        ],
      });
    });
    await a.whenBuilt();
    a.selection.set([{ kind: 'feature', id: 's1' }]);
  });
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('extrude'));
  await expect(page.getByRole('heading', { name: 'Extrude' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Profile 1' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Profile 2' })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Profile 2' }).uncheck();
  await page.locator('.confirm-corner .ok').click();
  await page.waitForTimeout(700);
  await page.evaluate(() => (window as unknown as Handle).__parametric.whenBuilt());
  const res = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const f = a.store.doc.features.find((x) => x.type === 'extrude');
    return { contours: f && 'contours' in f ? (f.contours ?? null) : null, maxX: Math.round(a.bbox!.max[0]), minX: Math.round(a.bbox!.min[0]) };
  });
  expect(res.contours).not.toBeNull();
  expect(res.minX).toBe(0);
  expect(res.maxX).toBe(10);
  expect(errors).toEqual([]);
});

test('Double-clicking a component edits its part and Finish Part returns to the assembly', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.newAssembly('FlowTest');
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
    const sample = a.faces.find((f) => f.component === 'c1')!;
    const projected = a.viewport.camera.project(sample.center);
    a.onViewportDoubleClick({ x: projected[0], y: projected[1], pointerType: 'mouse' } as never);
  });
  await page.waitForTimeout(900);
  const editing = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    return { inComponentEdit: a.inComponentEdit, kind: a.store.doc.kind, tab: document.querySelector('.cm-tabs [role=\"tab\"][aria-selected=\"true\"]')?.textContent ?? '', name: a.store.doc.name };
  });
  expect(editing.inComponentEdit).toBe(true);
  expect(editing.kind).toBe('part');
  expect(editing.tab).toBe('Solid');
  expect(editing.name).toBe('Plate');
  await page.evaluate(() => (window as unknown as Handle).__parametric.finishComponentEdit(true));
  await page.waitForTimeout(900);
  const back = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    return { inComponentEdit: a.inComponentEdit, kind: a.store.doc.kind, tab: document.querySelector('.cm-tabs [role=\"tab\"][aria-selected=\"true\"]')?.textContent ?? '', components: a.store.doc.components?.length ?? 0 };
  });
  expect(back.inComponentEdit).toBe(false);
  expect(back.kind).toBe('assembly');
  expect(back.tab).toBe('Assembly');
  expect(back.components).toBe(1);
  expect(errors).toEqual([]);
});
