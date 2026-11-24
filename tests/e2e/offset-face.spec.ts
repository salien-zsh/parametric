import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };
const app = (page: import('@playwright/test').Page) => page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);

test('Offset Face pushes the picked face out', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await app(page);
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
    const index = a.faces.findIndex((f) => f.type === 'plane' && Math.abs((f.normal?.[2] ?? 0) - 1) < 1e-6);
    a.selection.set([{ kind: 'face', index, name: a.faces[index].name }]);
  });
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('offsetFace'));
  await expect(page.getByRole('heading', { name: 'Offset Face' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Offset', exact: true }).fill('5');
  await page.getByRole('textbox', { name: 'Offset', exact: true }).press('Tab');
  await page.locator('.confirm-corner .ok').click();
  await page.waitForTimeout(600);
  await page.evaluate(() => (window as unknown as Handle).__parametric.whenBuilt());
  await page.waitForTimeout(300);
  const state = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const feature = a.store.doc.features.find((f) => f.type === 'offsetFace');
    return { exists: !!feature, top: a.bbox ? Math.round(a.bbox.max[2]) : null };
  });
  expect(state.exists).toBe(true);
  expect(state.top).toBe(15);
  expect(errors).toEqual([]);
});
