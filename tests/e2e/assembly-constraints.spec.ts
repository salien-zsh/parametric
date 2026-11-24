import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };
const app = (page: import('@playwright/test').Page) => page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);

/** An assembly of a fixed base and a loose bracket, both boxes. */
async function assembly(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /New part/ }).click();
  await app(page);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.newAssembly('Asm');
    const now = Date.now();
    const box = (name: string, size: number, depth: number) => ({
      format: 'parametric-part', version: 1, kind: 'part', name, units: 'MMGS', decimals: 2, material: null, color: '#b8c4d2',
      variables: [], rollback: null, blobs: {}, components: [], nextId: 3, created: now, modified: now,
      features: [
        {
          id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
            { id: 'p1', t: 'point', x: 0, y: 0 }, { id: 'p2', t: 'point', x: size, y: 0 }, { id: 'p3', t: 'point', x: size, y: size }, { id: 'p4', t: 'point', x: 0, y: size },
            { id: 'l1', t: 'line', a: 'p1', b: 'p2' }, { id: 'l2', t: 'line', a: 'p2', b: 'p3' }, { id: 'l3', t: 'line', a: 'p3', b: 'p4' }, { id: 'l4', t: 'line', a: 'p4', b: 'p1' },
          ],
        },
        { id: 'e1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null },
      ],
    });
    a.store.change('Insert components', (doc) => {
      doc.components = [
        { id: 'c1', name: 'Base', part: box('Base', 60, 30), transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, visible: true, fixed: true },
        { id: 'c2', name: 'Bracket', part: box('Bracket', 40, 20), transform: { position: [120, 0, 0], rotation: [0, 0, 0] }, visible: true, fixed: false },
      ] as unknown as typeof doc.components;
    });
    await a.whenBuilt();
    a.viewport.setView('trimetric', false);
    a.viewport.zoomToFit(false);
  });
  await page.waitForTimeout(600);
}

/** A pixel over the given component, found through the same pick the user triggers. */
async function pixelOver(page: import('@playwright/test').Page, componentId: string) {
  return page.evaluate((id) => {
    const a = (window as unknown as Handle).__parametric;
    const c = a.viewport.canvas.getBoundingClientRect();
    for (let y = c.top + 60; y < c.bottom - 40; y += 18) {
      for (let x = c.left + 40; x < c.right - 40; x += 18) {
        const item = a.viewport.pickItem(x - c.left, y - c.top, { face: true });
        if (a.componentOfItem(item)?.id === id) return { x, y };
      }
    }
    throw new Error(`no pixel over ${id}`);
  }, componentId);
}

test('clicking a component selects it, and Move drags it', async ({ page }) => {
  const errors = await openApp(page);
  await assembly(page);
  expect(await page.evaluate(() => (window as unknown as Handle).__parametric.faces.filter((f) => f.component).length)).toBe(12);

  const bracket = await pixelOver(page, 'c2');
  await page.mouse.click(bracket.x, bracket.y);
  await expect.poll(() => page.evaluate(() => (window as unknown as Handle).__parametric.selection.items.map((i) => i.kind === 'component' ? i.id : i.kind))).toEqual(['c2']);

  // Move the selected bracket by dragging it.
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('moveComponents'));
  await expect(page.getByRole('heading', { name: 'Move/Rotate' })).toBeVisible();
  await page.mouse.move(bracket.x, bracket.y);
  await page.mouse.down();
  await page.mouse.move(bracket.x - 40, bracket.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const moved = await page.evaluate(() => (window as unknown as Handle).__parametric.store.doc.components!.find((c) => c.id === 'c2')!.transform.position);
  expect(moved[0]).not.toBeCloseTo(120, 3);
  await page.locator('.confirm-corner .ok').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Handle).__parametric.store.doc.components!.find((c) => c.id === 'c2')!.transform.position[0])).not.toBe(120);
  expect(errors).toEqual([]);
});

test('a joint mates two picked faces and carries the part when the reference moves', async ({ page }) => {
  const errors = await openApp(page);
  await assembly(page);
  // Select both components, then make a joint between the base top and the bracket bottom.
  await page.locator('.tree [role="treeitem"]').filter({ hasText: 'Base' }).first().click();
  await page.locator('.tree [role="treeitem"]').filter({ hasText: 'Bracket' }).first().click({ modifiers: ['Control'] });
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('addJoint'));
  await expect(page.getByRole('heading', { name: 'Joint' })).toBeVisible();
  const picks = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    return {
      baseTop: a.faces.findIndex((f) => f.component === 'c1' && f.type === 'plane' && Math.abs((f.normal?.[2] ?? 0) - 1) < 1e-6),
      bracketBottom: a.faces.findIndex((f) => f.component === 'c2' && f.type === 'plane' && Math.abs((f.normal?.[2] ?? 0) + 1) < 1e-6),
    };
  });
  await page.evaluate((p) => {
    const selects = [...document.querySelectorAll<HTMLSelectElement>('.pm-section select')];
    selects[1].value = `face:${p.baseTop}`;
    selects[1].dispatchEvent(new Event('change', { bubbles: true }));
    selects[2].value = `face:${p.bracketBottom}`;
    selects[2].dispatchEvent(new Event('change', { bubbles: true }));
  }, picks);
  await page.locator('.confirm-corner .ok').click();
  await expect(page.getByRole('treeitem', { name: /Joint1/ })).toBeVisible();
  const joint = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    return a.store.doc.joints!.map((j) => ({ relativeTo: j.relativeTo, component: j.component, offset: j.offset, aRef: j.aRef }));
  });
  expect(joint).toHaveLength(1);
  expect(joint[0].relativeTo).toBe('c1');
  expect(joint[0].component).toBe('c2');
  // The bracket's bottom face now sits on the base's top face.
  const placed = await page.evaluate(() => (window as unknown as Handle).__parametric.store.doc.components!.find((c) => c.id === 'c2')!.transform.position);
  expect(placed[2]).toBeCloseTo(30, 4);
  expect(placed[0]).toBeCloseTo(10, 4);

  // Moving the reference carries the joined part with it.
  await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    a.store.change('Unfix base', (doc) => { doc.components!.find((c) => c.id === 'c1')!.fixed = false; });
  });
  await page.evaluate(() => (window as unknown as Handle).__parametric.selection.set([{ kind: 'component', id: 'c1' }]));
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('moveComponents'));
  await page.waitForTimeout(500);
  const basePixel = await pixelOver(page, 'c1');
  await page.mouse.move(basePixel.x, basePixel.y);
  await page.mouse.down();
  await page.mouse.move(basePixel.x + 40, basePixel.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  await page.locator('.confirm-corner .ok').click();
  const solved = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const transforms = a.solvedComponentTransforms();
    return { base: transforms.get('c1')!.position, bracket: transforms.get('c2')!.position };
  });
  expect(solved.base[0]).not.toBeCloseTo(0, 3);
  expect(solved.bracket[0] - solved.base[0]).toBeCloseTo(10, 4);
  expect(solved.bracket[2] - solved.base[2]).toBeCloseTo(30, 4);
  expect(errors).toEqual([]);
});

test('the mate command creates the same geometry constraint as a joint', async ({ page }) => {
  const errors = await openApp(page);
  await assembly(page);
  await page.locator('.tree [role="treeitem"]').filter({ hasText: 'Base' }).first().click();
  await page.locator('.tree [role="treeitem"]').filter({ hasText: 'Bracket' }).first().click({ modifiers: ['Control'] });
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('addMate'));
  await expect(page.getByRole('heading', { name: 'Joint' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Reference geometry' })).toBeVisible();
  const picks = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    return {
      baseTop: a.faces.findIndex((f) => f.component === 'c1' && f.type === 'plane' && Math.abs((f.normal?.[2] ?? 0) - 1) < 1e-6),
      bracketBottom: a.faces.findIndex((f) => f.component === 'c2' && f.type === 'plane' && Math.abs((f.normal?.[2] ?? 0) + 1) < 1e-6),
    };
  });
  await page.evaluate((p) => {
    const selects = [...document.querySelectorAll<HTMLSelectElement>('.pm-section select')];
    selects[1].value = `face:${p.baseTop}`;
    selects[1].dispatchEvent(new Event('change', { bubbles: true }));
    selects[2].value = `face:${p.bracketBottom}`;
    selects[2].dispatchEvent(new Event('change', { bubbles: true }));
  }, picks);
  await page.locator('.confirm-corner .ok').click();
  const joint = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    return a.store.doc.joints!.map((j) => ({ relativeTo: j.relativeTo, component: j.component }));
  });
  expect(joint).toEqual([{ relativeTo: 'c1', component: 'c2' }]);
  expect(errors).toEqual([]);
});

test('dragging a jointed component stops at the joint limits', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await app(page);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.newAssembly('Sliding');
    const now = Date.now();
    const box = (name: string) => ({
      format: 'parametric-part', version: 1, kind: 'part', name, units: 'MMGS', decimals: 2, material: null, color: '#b8c4d2',
      variables: [], rollback: null, blobs: {}, components: [], nextId: 3, created: now, modified: now,
      features: [
        {
          id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
            { id: 'p1', t: 'point', x: 0, y: 0 }, { id: 'p2', t: 'point', x: 40, y: 0 }, { id: 'p3', t: 'point', x: 40, y: 40 }, { id: 'p4', t: 'point', x: 0, y: 40 },
            { id: 'l1', t: 'line', a: 'p1', b: 'p2' }, { id: 'l2', t: 'line', a: 'p2', b: 'p3' }, { id: 'l3', t: 'line', a: 'p3', b: 'p4' }, { id: 'l4', t: 'line', a: 'p4', b: 'p1' },
          ],
        },
        { id: 'e1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth: 20, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null },
      ],
    });
    a.store.change('Sliding components', (doc) => {
      doc.components = [
        { id: 'c1', name: 'Rail', part: box('Rail'), transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, visible: true, fixed: true },
        { id: 'c2', name: 'Carriage', part: box('Carriage'), transform: { position: [0, 0, 30], rotation: [0, 0, 0] }, visible: true, fixed: false },
      ] as unknown as typeof doc.components;
      doc.joints = [{
        id: 'j1', name: 'Slide', type: 'prismatic', component: 'c2', relativeTo: 'c1', axis: 'x', value: 0, min: -20, max: 20,
        offset: { position: [0, 0, 30], rotation: [0, 0, 0] },
        aRef: { kind: 'edge', p: [0, 0, 30], d: [1, 0, 0] },
      }];
    });
    await a.whenBuilt();
    a.viewport.setView('trimetric', false);
    a.viewport.zoomToFit(false);
    // Zoom out so a 260 px drag covers more than the joint's 40 mm travel.
    a.renderer.camera.distance = Math.max(a.renderer.camera.distance * 6, 300);
    (a.renderer.camera as unknown as { onChange(): void }).onChange();
    a.renderer.requestRender();
  });
  await page.waitForTimeout(600);
  const pixel = await pixelOver(page, 'c2');
  await page.mouse.click(pixel.x, pixel.y);
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('moveComponents'));
  await expect(page.getByRole('heading', { name: 'Move/Rotate' })).toBeVisible();
  expect(await page.evaluate(() => !!(window as unknown as Handle).__parametric.jointRangeVisual())).toBe(true);
  // Drag far beyond the +20 mm limit (several strokes, as a user would).
  for (let i = 0; i < 4; i++) {
    const at = await pixelOver(page, 'c2');
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x, at.y - 260, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(600);
  const value = await page.evaluate(() => (window as unknown as Handle).__parametric.store.doc.joints![0].value);
  expect(value).toBe(20);
  // Drag the other way: the carriage stops at the other end of its travel.
  for (let i = 0; i < 6; i++) {
    const at = await pixelOver(page, 'c2');
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x, at.y + 240, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(600);
  const back = await page.evaluate(() => (window as unknown as Handle).__parametric.store.doc.joints![0].value);
  expect(back).toBe(-20);
  expect(errors).toEqual([]);
});
