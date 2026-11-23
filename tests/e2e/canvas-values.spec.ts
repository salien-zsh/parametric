import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };

const app = (page: import('@playwright/test').Page) => page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
const valueBox = (page: import('@playwright/test').Page) => page.locator('.cv-value');
const valueInput = (page: import('@playwright/test').Page) => valueBox(page).locator('input');

test('a plane offset is edited on the model and the panel follows it', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await app(page);
  await page.getByRole('treeitem', { name: 'Front Plane' }).click();
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('plane'));
  await expect(page.getByRole('heading', { name: 'Plane' })).toBeVisible();
  await expect(valueBox(page)).toBeVisible();
  await expect(valueInput(page)).toHaveValue(/mm$/);

  // Typed values go to the feature and to the PropertyManager field.
  await valueInput(page).click();
  await valueInput(page).fill('25');
  await valueInput(page).press('Enter');
  await expect(page.locator('.pm-content input').first()).toHaveValue('25');
  await page.locator('.confirm-corner .ok').click();
  await expect(page.getByRole('treeitem', { name: 'Plane1' })).toBeVisible();
  await expect(valueBox(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the value menu flips and resets a plane offset', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await app(page);
  await page.getByRole('treeitem', { name: 'Front Plane' }).click();
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('plane'));
  await expect(valueInput(page)).toHaveValue('10.00 mm');

  await valueBox(page).getByRole('button', { name: 'Value options' }).click();
  await page.getByRole('menuitem', { name: 'Flip offset' }).click();
  await expect(valueInput(page)).toHaveValue('-10.00 mm');

  await valueBox(page).getByRole('button', { name: 'Value options' }).click();
  await page.getByRole('menuitem', { name: 'Reset offset' }).click();
  await expect(valueInput(page)).toHaveValue('0.00 mm');
  expect(errors).toEqual([]);
});

test('a fillet radius is typed on the model', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await app(page);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    const pts = [[0, 0], [400, 0], [400, 300], [0, 300]];
    a.store.change('Plate', (d) => {
      d.features.push({
        id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          ...pts.map(([x, y], i) => ({ id: `p${i}`, t: 'point' as const, x, y })),
          ...pts.map((_, i) => ({ id: `l${i}`, t: 'line' as const, a: `p${i}`, b: `p${(i + 1) % 4}` })),
        ],
      });
      d.features.push({ id: 'f1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth: 20, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null });
    });
    await a.whenBuilt();
    a.viewport.zoomToFit(false);
    const face = a.faces.find((f) => f.type === 'plane' && Math.abs(f.normal?.[2] ?? 1) < 0.5) ?? a.faces[0];
    a.selection.set([{ kind: 'face', index: a.faces.indexOf(face), name: face.name }]);
    a.commands.run('fillet');
  });
  await expect(page.getByRole('heading', { name: 'Fillet' })).toBeVisible();
  await expect(valueBox(page)).toBeVisible();
  await valueInput(page).click();
  await valueInput(page).fill('4');
  await valueInput(page).press('Enter');
  await expect(page.locator('.pm-content input').first()).toHaveValue('4');
  await page.locator('.confirm-corner .ok').click();
  await expect(page.getByRole('treeitem', { name: 'Fillet1', exact: true })).toBeVisible();
  await expect(valueBox(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('an extrusion depth is dragged on the model and committed', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await app(page);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    const pts = [[0, 0], [400, 0], [400, 300], [0, 300]];
    a.store.change('Plate', (d) => {
      d.features.push({
        id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          ...pts.map(([x, y], i) => ({ id: `p${i}`, t: 'point' as const, x, y })),
          ...pts.map((_, i) => ({ id: `l${i}`, t: 'line' as const, a: `p${i}`, b: `p${(i + 1) % 4}` })),
        ],
      });
      d.features.push({ id: 'f1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth: 5, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null });
    });
    await a.whenBuilt();
    a.viewport.zoomToFit(false);
  });
  await page.getByRole('treeitem', { name: 'Extrude1', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Extrude' })).toBeVisible();
  await expect(valueBox(page)).toBeVisible();
  await expect(valueInput(page)).toHaveValue('5.00 mm');

  // Typing updates the depth field; the model is rebuilt for the preview.
  await valueInput(page).click();
  await valueInput(page).fill('12');
  await valueInput(page).press('Enter');
  await expect(page.locator('.pm-content input').first()).toHaveValue('12');

  // Dragging the anchor dot changes the depth as well.
  await page.evaluate(() => (window as unknown as Handle).__parametric.whenBuilt());
  await page.waitForTimeout(300);
  const dot = page.locator('.cv-dot');
  const r = (await dot.boundingBox())!;
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2 + 70, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await valueInput(page).inputValue()) !== '12.00 mm').toBe(true);
  const shown = Number((await valueInput(page).inputValue()).replace(/[^\d.-]/g, ''));

  await page.locator('.confirm-corner .ok').click();
  await expect(page.getByRole('treeitem', { name: 'Extrude1', exact: true })).toBeVisible();
  const depth = await page.evaluate(() => ((window as unknown as Handle).__parametric.store.doc.features.find((f) => f.id === 'f1') as unknown as { depth: number }).depth);
  expect(Math.abs(depth - 12)).toBeGreaterThan(0.5);
  expect(Math.abs(depth - shown)).toBeLessThan(0.02);
  await expect(valueBox(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});
