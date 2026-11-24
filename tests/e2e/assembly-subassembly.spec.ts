import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };
const app = (page: import('@playwright/test').Page) => page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);

/** A 40 x 40 x 20 box part document. */
const boxPart = (name: string) => {
  const now = Date.now();
  return {
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
  };
};

test('a sub-assembly is inserted and moves as one unit', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await app(page);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.newAssembly('Top');
    const now = Date.now();
    const plate = (name: string) => {
      const part = {
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
      };
      return part;
    };
    const sub = {
      ...plate('SubPlate'),
      kind: 'assembly',
      features: [],
      components: [{ id: 'sc1', name: 'SubPlate1', part: plate('SubPlate'), transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, visible: true, fixed: true }],
      mates: [], joints: [],
    };
    a.store.change('Insert sub-assembly', (doc) => {
      doc.components = [
        { id: 'top1', name: 'Sub', part: sub as unknown as typeof doc.components extends undefined ? never : never, transform: { position: [50, 0, 0], rotation: [0, 0, 0] }, visible: true, fixed: false },
      ] as unknown as typeof doc.components;
    });
    await a.whenBuilt();
    a.viewport.setView('trimetric', false);
    a.viewport.zoomToFit(false);
  });
  await page.waitForTimeout(900);
  const info = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    return {
      bbox: a.bbox ? [a.bbox.min[0], a.bbox.max[0]] : null,
      nestedFaces: a.faces.filter((f) => (f.component ?? '').includes('/')).length,
      components: a.store.doc.components!.length,
    };
  });
  expect(info.components).toBe(1);
  expect(info.bbox).toBeTruthy();
  // The sub-assembly's part is built and placed at x = 50.
  expect(info.bbox![0]).toBeCloseTo(50, 2);
  expect(info.nestedFaces).toBeGreaterThan(0);

  // Clicking the nested part selects the top-level component.
  const pixel = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const c = a.viewport.canvas.getBoundingClientRect();
    for (let y = c.top + 60; y < c.bottom - 40; y += 18) {
      for (let x = c.left + 40; x < c.right - 40; x += 18) {
        const item = a.viewport.pickItem(x - c.left, y - c.top, { face: true });
        if (a.componentOfItem(item)?.id === 'top1') return { x, y };
      }
    }
    throw new Error('no pixel over top1');
  });
  await page.mouse.click(pixel.x, pixel.y);
  await expect.poll(() => page.evaluate(() => (window as unknown as Handle).__parametric.selection.items.map((i) => (i.kind === 'component' ? i.id : i.kind)))).toEqual(['top1']);

  // Moving it carries the whole sub-assembly.
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('moveComponents'));
  await page.waitForTimeout(500);
  await page.mouse.move(pixel.x, pixel.y);
  await page.mouse.down();
  await page.mouse.move(pixel.x - 40, pixel.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  const moved = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    return { x: a.store.doc.components![0].transform.position[0], bbox: a.bbox ? [a.bbox.min[0], a.bbox.max[0]] : null };
  });
  expect(moved.x).not.toBeCloseTo(50, 3);
  expect(errors).toEqual([]);
});

test('dropping a part file in an assembly inserts it as a component', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await app(page);
  await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    a.newAssembly('DropTest');
  });
  await page.waitForTimeout(400);
  const text = JSON.stringify(boxPart('DroppedPlate'));
  await page.evaluate((partText) => {
    const data = new DataTransfer();
    data.items.add(new File([partText], 'DroppedPlate.parametric', { type: 'application/json' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  }, text);
  await expect.poll(() => page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    return (a.store.doc.components ?? []).length;
  })).toBe(1);
  const inserted = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    return a.store.doc.components!.map((c) => c.name);
  });
  expect(inserted[0]).toContain('DroppedPlate');
  await page.evaluate(() => (window as unknown as Handle).__parametric.whenBuilt());
  expect(await page.evaluate(() => !!(window as unknown as Handle).__parametric.bbox)).toBe(true);
  expect(errors).toEqual([]);
});

test('a sub-assembly opens for editing and writes back', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await app(page);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.newAssembly('Top');
    const now = Date.now();
    const part = {
      format: 'parametric-part', version: 1, kind: 'part', name: 'Plate', units: 'MMGS', decimals: 2, material: null, color: '#b8c4d2',
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
    };
    const sub = {
      ...part, kind: 'assembly', features: [],
      components: [{ id: 'sc1', name: 'Plate1', part, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, visible: true, fixed: true }],
      mates: [], joints: [],
    };
    a.store.change('Insert sub', (doc) => {
      doc.components = [{ id: 'top1', name: 'Sub', part: sub, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, visible: true, fixed: false }] as unknown as typeof doc.components;
    });
    await a.whenBuilt();
    a.selection.set([{ kind: 'component', id: 'top1' }]);
    a.editComponentPart('top1');
  });
  await expect.poll(() => page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    return { kind: a.store.doc.kind, name: a.store.doc.name, editing: a.componentEdit?.componentId ?? null };
  })).toMatchObject({ kind: 'assembly', name: 'Plate' });
  // Change a nested component's position inside the sub-assembly, then close it.
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.store.change('Move plate', (doc) => { doc.components![0].transform.position = [10, 0, 0]; });
    await a.whenBuilt();
    a.finishComponentEdit(true);
  });
  await page.waitForTimeout(800);
  const back = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    return {
      kind: a.store.doc.kind,
      name: a.store.doc.name,
      nested: a.store.doc.components?.[0]?.part.kind,
      nestedX: (a.store.doc.components?.[0]?.part as { components?: { transform: { position: number[] } }[] }).components?.[0]?.transform.position[0],
    };
  });
  expect(back.kind).toBe('assembly');
  expect(back.name).toBe('Top');
  expect(back.nested).toBe('assembly');
  expect(back.nestedX).toBe(10);
  expect(errors).toEqual([]);
});
