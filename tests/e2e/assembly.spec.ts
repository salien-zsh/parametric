import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

// Local machines without Playwright's bundled Chromium can opt into an
// installed Edge with PW_EDGE=1; CI keeps the default bundled browser.
if (process.env.PW_EDGE) test.use({ channel: 'msedge' });

test('creates an assembly, places a part and makes a drawing with a BOM', async ({ page }) => {
  const errors = await openApp(page);
  await page.evaluate(() => {
    const app = (window as unknown as { __parametric: any }).__parametric;
    app.newAssembly('Fixture');
    const now = Date.now();
    const part = {
      format: 'parametric-part', version: 1, kind: 'part', name: 'Plate', units: 'MMGS', decimals: 2,
      material: null, color: '#b8c4d2', variables: [], rollback: null, blobs: {}, components: [], nextId: 3,
      created: now, modified: now,
      features: [{
        id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [],
        entities: [
          { id: 'p1', t: 'point', x: 0, y: 0 }, { id: 'p2', t: 'point', x: 20, y: 0 },
          { id: 'p3', t: 'point', x: 20, y: 10 }, { id: 'p4', t: 'point', x: 0, y: 10 },
          { id: 'l1', t: 'line', a: 'p1', b: 'p2' }, { id: 'l2', t: 'line', a: 'p2', b: 'p3' },
          { id: 'l3', t: 'line', a: 'p3', b: 'p4' }, { id: 'l4', t: 'line', a: 'p4', b: 'p1' },
        ],
      }, {
        id: 'e1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth: 5,
        flip: false, dir2: null, draft: 0, draftOutward: false, thin: null,
      }],
    };
    app.store.change('Insert component', (doc: any) => {
      doc.components = [{
        id: 'c1', name: 'Plate1', part,
        transform: { position: [10, 0, 0], rotation: [0, 0, 0] }, visible: true,
      }];
    });
  });
  await expect(page.getByRole('treeitem', { name: /Plate1/ })).toBeVisible();
  await page.waitForFunction(() => {
    const app = (window as unknown as { __parametric: any }).__parametric;
    return app.bbox?.max?.[0] === 30;
  });

  await page.evaluate(() => (window as unknown as { __parametric: any }).__parametric.commands.run('openDrawing'));
  await expect(page.getByRole('tablist', { name: 'Model or drawing' }).getByRole('tab', { name: 'Drawing' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.paper')).toContainText('QTY');
  await expect(page.locator('.paper')).toContainText('Plate');
  expect(errors).toEqual([]);
});
