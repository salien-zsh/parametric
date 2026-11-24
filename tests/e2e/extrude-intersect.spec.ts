import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };

test('Extrude Intersect keeps only the overlap', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.store.change('Intersect', (doc) => {
      doc.features.push(
        { id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          { id: 'p1', t: 'point', x: 0, y: 0 }, { id: 'p2', t: 'point', x: 40, y: 0 }, { id: 'p3', t: 'point', x: 40, y: 40 }, { id: 'p4', t: 'point', x: 0, y: 40 },
          { id: 'l1', t: 'line', a: 'p1', b: 'p2' }, { id: 'l2', t: 'line', a: 'p2', b: 'p3' }, { id: 'l3', t: 'line', a: 'p3', b: 'p4' }, { id: 'l4', t: 'line', a: 'p4', b: 'p1' },
        ] },
        { id: 'e1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth: 10, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null },
        { id: 's2', name: 'Sketch2', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          { id: 'q1', t: 'point', x: 0, y: 0 }, { id: 'q2', t: 'point', x: 40, y: 0 }, { id: 'q3', t: 'point', x: 40, y: 20 }, { id: 'q4', t: 'point', x: 0, y: 20 },
          { id: 'm1', t: 'line', a: 'q1', b: 'q2' }, { id: 'm2', t: 'line', a: 'q2', b: 'q3' }, { id: 'm3', t: 'line', a: 'q3', b: 'q4' }, { id: 'm4', t: 'line', a: 'q4', b: 'q1' },
        ] },
      );
    });
    await a.whenBuilt();
    a.selection.set([{ kind: 'feature', id: 's2' }]);
  });
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('extrude'));
  await expect(page.getByRole('heading', { name: 'Extrude' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Intersect' }).check();
  await page.locator('.confirm-corner .ok').click();
  await page.waitForTimeout(700);
  await page.evaluate(() => (window as unknown as Handle).__parametric.whenBuilt());
  const res = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const f = a.store.doc.features.find((x) => x.type === 'extrude' && x.intersect);
    return { intersect: !!f, maxY: Math.round(a.bbox!.max[1]) };
  });
  expect(res.intersect).toBe(true);
  expect(res.maxY).toBe(20);
  expect(errors).toEqual([]);
});
