import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type Handle = { __parametric: import('../../src/app/app').App };
const app = (page: import('@playwright/test').Page) => page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);

test('a thread cuts a helical groove into the picked cylindrical face', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await app(page);
  await page.evaluate(async () => {
    const a = (window as unknown as Handle).__parametric;
    a.store.change('Cylinder', (doc) => {
      doc.features.push(
        { id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          { id: 'p1', t: 'point', x: 0, y: 0 }, { id: 'c1', t: 'circle', c: 'p1', r: 10 },
        ] },
        { id: 'e1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth: 40, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null },
      );
    });
    await a.whenBuilt();
    const index = a.faces.findIndex((f) => f.type === 'cylinder');
    a.selection.set([{ kind: 'face', index, name: a.faces[index].name }]);
  });
  await page.evaluate(() => (window as unknown as Handle).__parametric.commands.run('thread'));
  await expect(page.getByRole('heading', { name: 'Thread' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Pitch', exact: true }).fill('2');
  await page.getByRole('textbox', { name: 'Thread length', exact: true }).fill('20');
  await page.getByRole('textbox', { name: 'Thread length', exact: true }).press('Tab');
  await page.locator('.confirm-corner .ok').click();
  await page.waitForTimeout(600);
  await page.evaluate(() => (window as unknown as Handle).__parametric.whenBuilt());
  await page.waitForTimeout(400);
  const state = await page.evaluate(() => {
    const a = (window as unknown as Handle).__parametric;
    const feature = a.store.doc.features.find((f) => f.type === 'thread');
    return {
      thread: feature ? { pitch: feature.pitch, length: feature.length, face: !!feature.face } : null,
      status: feature ? a.featureStatus(feature.id) : null,
      top: a.bbox ? Math.round(a.bbox.max[2]) : null,
    };
  });
  expect(state.thread).toMatchObject({ pitch: 2, length: 20, face: true });
  expect(state.status?.ok).toBe(true);
  expect(state.top).toBe(40);
  expect(errors).toEqual([]);
});
