import { type Page, expect, test } from '@playwright/test';
import { openApp } from './helpers';
import type { App } from '../../src/app/app';

type W = { __parametric: App };

/** Page position of a model point once the camera stopped moving. */
async function screenOfModel(page: Page, p: [number, number, number]): Promise<[number, number]> {
  return page.evaluate(async (p) => {
    const a = (window as unknown as W).__parametric;
    await a.whenBuilt();
    const at = () => {
      const [x, y] = a.viewport.project(p);
      const box = a.viewport.canvas.getBoundingClientRect();
      return [box.x + x, box.y + y] as [number, number];
    };
    let last = at();
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const now = at();
      if (Math.hypot(now[0] - last[0], now[1] - last[1]) < 0.01) return now;
      last = now;
    }
    return last;
  }, p);
}

test('the line tool chains a tangent arc, Fusion style', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.getByRole('treeitem', { name: 'Front Plane' }).click();
  await page.getByRole('tab', { name: 'Sketch' }).click();
  await page.locator('[data-cmd="sketch"]').first().click();
  await expect(page.locator('.view-label')).toHaveText('Front');
  await page.locator('[data-cmd="tool:line"]').first().click();
  await expect(page.locator('.sketch-tool-options').getByRole('button', { name: 'Line', exact: true })).toBeVisible();

  const a = await screenOfModel(page, [0, 0, 0]);
  const b = await screenOfModel(page, [20, 0, 0]);
  await page.mouse.click(a[0], a[1]);
  await page.mouse.click(b[0], b[1]);
  // Switch the active line command to tangent arcs, then end the chain with a click.
  await page.locator('.sketch-tool-options').getByRole('button', { name: 'Tangent Arc', exact: true }).click();
  const c = await screenOfModel(page, [30, 10, 0]);
  await page.mouse.click(c[0], c[1]);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  const state = await page.evaluate(() => {
    const app = (window as unknown as W).__parametric;
    const sketch = app.store.doc.features.find((f) => f.type === 'sketch')!;
    if (sketch.type !== 'sketch') return null;
    const lines = sketch.entities.filter((e) => e.t === 'line');
    const arcs = sketch.entities.filter((e) => e.t === 'arc');
    const tangents = sketch.constraints.filter((c) => c.type === 'tangent');
    return { lines: lines.length, arcs: arcs.length, tangents: tangents.length };
  });
  expect(state).toEqual({ lines: 1, arcs: 1, tangents: 1 });
  expect(errors).toEqual([]);
});

test('feature panels float over the graphics area and can be dragged', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.evaluate(async () => {
    const a = (window as unknown as W).__parametric;
    a.store.change('Plate', (doc) => {
      doc.features.push({
        id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          { id: 'p1', t: 'point', x: 0, y: 0 }, { id: 'p2', t: 'point', x: 20, y: 0 }, { id: 'p3', t: 'point', x: 20, y: 10 }, { id: 'p4', t: 'point', x: 0, y: 10 },
          { id: 'l1', t: 'line', a: 'p1', b: 'p2' }, { id: 'l2', t: 'line', a: 'p2', b: 'p3' }, { id: 'l3', t: 'line', a: 'p3', b: 'p4' }, { id: 'l4', t: 'line', a: 'p4', b: 'p1' },
        ],
      });
    });
    await a.whenBuilt();
    a.selection.set([{ kind: 'feature', id: 's1' }]);
  });
  await page.evaluate(() => (window as unknown as W).__parametric.commands.run('extrude'));
  const panel = page.locator('.panel-layer .pm-float');
  await expect(panel).toBeVisible();
  await expect(page.locator('.lp-body .pm')).toHaveCount(0);
  const before = (await panel.boundingBox())!;
  const head = (await panel.locator('.pm-head').boundingBox())!;
  await page.mouse.move(head.x + 40, head.y + 16);
  await page.mouse.down();
  await page.mouse.move(head.x - 60, head.y + 70, { steps: 8 });
  await page.mouse.up();
  const after = (await panel.boundingBox())!;
  expect(Math.round(after.x)).toBeLessThan(Math.round(before.x));
  expect(Math.round(after.y)).toBeGreaterThan(Math.round(before.y));
  // The design tree stays available behind the dialog.
  await expect(page.locator('.lp-body').getByRole('treeitem', { name: 'Sketch1' })).toBeVisible();
  await page.locator('.confirm-corner .cancel').click();
  await expect(page.locator('.panel-layer')).toBeHidden();
  expect(errors).toEqual([]);
});
