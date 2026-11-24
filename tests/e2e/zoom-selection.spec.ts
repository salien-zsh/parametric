import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };

test('Zoom to Selection frames the picked geometry', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.store.change('Plate', (doc) => {
      doc.features.push(
        { id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          { id: 'p1', t: 'point', x: 0, y: 0 }, { id: 'p2', t: 'point', x: 60, y: 0 }, { id: 'p3', t: 'point', x: 60, y: 40 }, { id: 'p4', t: 'point', x: 0, y: 40 },
          { id: 'l1', t: 'line', a: 'p1', b: 'p2' }, { id: 'l2', t: 'line', a: 'p2', b: 'p3' }, { id: 'l3', t: 'line', a: 'p3', b: 'p4' }, { id: 'l4', t: 'line', a: 'p4', b: 'p1' },
        ] },
        { id: 'e1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth: 10, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null },
      );
    });
    await a.whenBuilt();
    a.viewport.zoomToFit(false);
  });
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => (window as unknown as Handle).__parametric.viewport.camera.state().distance);
  const ok = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const index = a.faces.findIndex((f) => f.type === 'plane');
    a.selection.set([{ kind: 'face', index, name: a.faces[index].name }]);
    a.commands.run('zoomToSelection');
    return a.commands.isEnabled('zoomToSelection');
  });
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => (window as unknown as Handle).__parametric.viewport.camera.state().distance);
  expect(ok).toBe(true);
  expect(after).toBeLessThan(before);
  expect(errors).toEqual([]);
});
