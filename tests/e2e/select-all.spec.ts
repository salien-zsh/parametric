import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };

test('Select All picks every sketch entity while sketching', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.store.change('Sketch', (doc) => {
      doc.features.push({
        id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          { id: 'p1', t: 'point', x: 0, y: 0 }, { id: 'p2', t: 'point', x: 20, y: 0 }, { id: 'p3', t: 'point', x: 20, y: 10 }, { id: 'p4', t: 'point', x: 0, y: 10 },
          { id: 'l1', t: 'line', a: 'p1', b: 'p2' }, { id: 'l2', t: 'line', a: 'p2', b: 'p3' }, { id: 'l3', t: 'line', a: 'p3', b: 'p4' }, { id: 'l4', t: 'line', a: 'p4', b: 'p1' },
          { id: 'c1', t: 'line', a: 'p1', b: 'p3', construction: true },
        ],
      });
    });
    await a.whenBuilt();
    a.editSketch('s1');
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('selectAll'));
  await page.waitForTimeout(400);
  const selected = await page.evaluate(() => (window as unknown as Handle).__parametric.selection.items.map((i) => i.kind));
  expect(selected.length).toBeGreaterThanOrEqual(8);
  expect(selected.every((kind) => kind === 'sk')).toBe(true);
  expect(errors).toEqual([]);
});
