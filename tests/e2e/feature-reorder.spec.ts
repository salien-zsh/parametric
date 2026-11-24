import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };

test('Move Feature Up/Down reorders the tree and rebuilds', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.store.change('Two extrudes', (doc) => {
      doc.features.push(
        { id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          { id: 'p1', t: 'point', x: 0, y: 0 }, { id: 'p2', t: 'point', x: 20, y: 0 }, { id: 'p3', t: 'point', x: 20, y: 10 }, { id: 'p4', t: 'point', x: 0, y: 10 },
          { id: 'l1', t: 'line', a: 'p1', b: 'p2' }, { id: 'l2', t: 'line', a: 'p2', b: 'p3' }, { id: 'l3', t: 'line', a: 'p3', b: 'p4' }, { id: 'l4', t: 'line', a: 'p4', b: 'p1' },
        ] },
        { id: 'e1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth: 10, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null },
        { id: 's2', name: 'Sketch2', type: 'sketch', plane: { kind: 'base', plane: 'top' }, constraints: [], entities: [
          { id: 'q1', t: 'point', x: 40, y: 0 }, { id: 'q2', t: 'circle', c: 'q1', r: 6 },
        ] },
        { id: 'e2', name: 'Extrude2', type: 'extrude', sketch: 's2', cut: false, end: 'blind', depth: 8, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null },
      );
    });
    await a.whenBuilt();
    a.selection.set([{ kind: 'feature', id: 'e1' }]);
  });
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('moveFeatureDown'));
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as Handle).__parametric.store.doc.features.map((f) => f.id)))
    .toEqual(['s1', 's2', 'e1', 'e2']);
  await page.waitForTimeout(500);
  await page.evaluate(async () => (window as unknown as Handle).__parametric.whenBuilt());
  expect(await page.evaluate(() => (window as unknown as Handle).__parametric.featureStatus('e1')?.ok)).toBe(true);
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('moveFeatureUp'));
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as Handle).__parametric.store.doc.features.map((f) => f.id)))
    .toEqual(['s1', 'e1', 's2', 'e2']);
  expect(errors).toEqual([]);
});
