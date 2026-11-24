import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };

test('Extrude offers To Face and swaps the depth for a face picker', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.store.change('ToFace', (doc) => {
      doc.features.push({
        id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          { id: 'p1', t: 'point', x: 0, y: 0 }, { id: 'p2', t: 'point', x: 20, y: 0 }, { id: 'p3', t: 'point', x: 20, y: 20 }, { id: 'p4', t: 'point', x: 0, y: 20 },
          { id: 'l1', t: 'line', a: 'p1', b: 'p2' }, { id: 'l2', t: 'line', a: 'p2', b: 'p3' }, { id: 'l3', t: 'line', a: 'p3', b: 'p4' }, { id: 'l4', t: 'line', a: 'p4', b: 'p1' },
        ],
      });
    });
    await a.whenBuilt();
    a.selection.set([{ kind: 'feature', id: 's1' }]);
  });
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('extrude'));
  await expect(page.getByRole('heading', { name: 'Extrude' })).toBeVisible();
  await page.getByRole('combobox', { name: 'End condition' }).selectOption({ label: 'To Face' });
  await expect(page.getByRole('textbox', { name: 'Depth', exact: true })).toBeHidden();
  await expect(page.getByText('Select the planar face to stop at')).toBeVisible();
  // Confirming without a face is refused by the panel, so the feature is not created.
  await page.locator('.confirm-corner .ok').click();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as Handle).__parametric.store.doc.features.some((f) => f.type === 'extrude'))).toBe(false);
  expect(errors).toEqual([]);
});
