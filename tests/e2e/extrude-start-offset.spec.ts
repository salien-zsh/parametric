import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };

test('Extrude Start offset moves the extrusion off the sketch plane', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.store.change('Offset', (doc) => {
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
  await page.getByRole('textbox', { name: 'Depth', exact: true }).fill('10');
  await page.getByRole('textbox', { name: 'Start offset', exact: true }).fill('5');
  await page.getByRole('textbox', { name: 'Start offset', exact: true }).press('Tab');
  await page.locator('.confirm-corner .ok').click();
  await page.waitForTimeout(700);
  await page.evaluate(() => (window as unknown as Handle).__parametric.whenBuilt());
  const res = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const f = a.store.doc.features.find((x) => x.type === 'extrude');
    const b = a.bbox!;
    return { startOffset: f && 'startOffset' in f ? f.startOffset : null, span: Math.round((b.max[2] - b.min[2]) * 100) / 100, min: Math.round(Math.abs(b.min[2]) * 100) / 100 };
  });
  expect(res.startOffset).toBe(5);
  expect(res.span).toBe(10);
  expect(res.min).toBe(5);
  expect(errors).toEqual([]);
});
