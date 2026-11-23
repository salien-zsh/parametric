import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };
const app = (page: import('@playwright/test').Page) => page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
const state = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const a = (window as unknown as Handle).__parametric;
  return {
    editing: a.inComponentEdit,
    isAssembly: a.isAssembly,
    components: a.store.doc.components?.length ?? 0,
    name: a.store.doc.name,
    features: a.store.doc.components?.[0]?.part.features.map((f) => f.name) ?? [],
    bbox: !!a.bbox,
  };
});

async function addPlate(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    const pts = [[0, 0], [60, 0], [60, 40], [0, 40]];
    a.store.change('Plate', (d) => {
      d.features.push({
        id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          ...pts.map(([x, y], i) => ({ id: `p${i}`, t: 'point' as const, x, y })),
          ...pts.map((_, i) => ({ id: `l${i}`, t: 'line' as const, a: `p${i}`, b: `p${(i + 1) % 4}` })),
        ],
      });
      d.features.push({ id: 'e1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth: 12, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null });
    });
    await a.whenBuilt();
  });
}

test('a new part is created in the assembly, edited in place and written back', async ({ page }) => {
  const errors = await openApp(page);
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('newAssembly'));
  await page.waitForTimeout(500);
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('newAssemblyPart'));
  await app(page);
  await expect(page.locator('.component-banner')).toContainText('Editing Part1 in Assembly1');
  expect(await page.evaluate(() => (window as unknown as Handle).__parametric.inComponentEdit)).toBe(true);
  expect((await state(page)).isAssembly).toBe(false);
  expect(await page.evaluate(() => (window as unknown as Handle).__parametric.commands.isEnabled('new'))).toBe(false);

  await addPlate(page);
  await page.locator('.component-banner').getByRole('button', { name: 'Finish Part' }).click();
  await expect.poll(() => state(page)).toMatchObject({ editing: false, isAssembly: true, components: 1, features: ['Sketch1', 'Extrude1'], bbox: true });
  expect(await page.locator('.component-banner').count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as Handle).__parametric.commands.isEnabled('new'))).toBe(true);

  // Re-open the same component and change a feature, then finish again.
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('editComponentPart'));
  await page.waitForTimeout(600);
  expect((await state(page)).editing).toBe(true);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.store.change('Deeper', (d) => { const f = d.features.find((x) => x.id === 'e1') as unknown as { depth: number }; f.depth = 20; });
    await a.whenBuilt();
  });
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('finishComponentEdit'));
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const f = a.store.doc.components?.[0]?.part.features.find((x) => x.id === 'e1') as unknown as { depth: number };
    return f.depth;
  })).toBe(20);
  expect(errors).toEqual([]);
});

test('cancelling a new part removes its component, and discarding edits leaves the old part', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('newAssembly'));
  await page.waitForTimeout(500);

  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('newAssemblyPart'));
  await page.waitForTimeout(500);
  await page.locator('.component-banner').getByRole('button', { name: 'Cancel Part' }).click();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as unknown as Handle).__parametric.store.doc.components?.length ?? 0)).toBe(0);

  // An existing part: make a change, cancel it, and the component keeps its old features.
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('newAssemblyPart'));
  await page.waitForTimeout(500);
  await addPlate(page);
  await page.locator('.component-banner').getByRole('button', { name: 'Finish Part' }).click();
  await page.waitForTimeout(500);
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('editComponentPart'));
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    a.store.change('Extra', (d) => { d.features.push({ id: 'x', name: 'CircleSketch', type: 'sketch', plane: { kind: 'base', plane: 'front' }, entities: [], constraints: [] }); });
  });
  await page.locator('.component-banner').getByRole('button', { name: 'Cancel Part' }).click();
  await page.getByRole('dialog', { name: /Discard changes to/ }).getByRole('button', { name: 'Discard' }).click();
  await page.waitForTimeout(500);
  expect((await state(page)).features).toEqual(['Sketch1', 'Extrude1']);
});
