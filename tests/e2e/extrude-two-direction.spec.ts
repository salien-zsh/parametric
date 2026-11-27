import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type W = { __parametric: import('../../src/app/app').App };

test('Extrude offers two opposite arrows and a Shift-drag taper', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /New part/ }).click();
  await page.waitForFunction(() => (window as unknown as { __parametric?: unknown }).__parametric);
  await page.evaluate(async () => {
    const a = (window as unknown as W).__parametric;
    const pts: [number, number][] = [[0, 0], [100, 0], [100, 80], [0, 80]];
    a.store.change('Plate', (d) => {
      d.features.push({
        id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, constraints: [], entities: [
          ...pts.map(([x, y], i) => ({ id: `p${i}`, t: 'point' as const, x, y })),
          ...pts.map((_, i) => ({ id: `l${i}`, t: 'line' as const, a: `p${i}`, b: `p${(i + 1) % 4}` })),
        ],
      });
      d.features.push({ id: 'f1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth: 10, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null });
    });
    await a.whenBuilt();
    a.viewport.zoomToFit(false);
  });
  await page.getByRole('treeitem', { name: 'Extrude1', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Extrude' })).toBeVisible();

  // One arrow for Direction 1.
  await expect(page.locator('.cv-arrow:visible')).toHaveCount(1);

  // Two directions: a second arrow appears on the other side of the sketch.
  await page.getByRole('checkbox', { name: 'Two directions' }).check();
  await expect(page.locator('.cv-arrow')).toHaveCount(2);
  await expect(page.locator('.cv-input')).toHaveCount(3);
  // Inventor-style tapered arc handle with its own angle box.
  await expect(page.locator('.cv-value[aria-label="Taper angle"]')).toBeVisible();
  await expect(page.locator('.cv-arc:visible')).toHaveCount(1);
  // The second handle sets Direction 2 depth.
  const second = page.locator('.cv-input').nth(1);
  await second.click();
  await second.fill('8');
  await second.press('Enter');
  await page.evaluate(() => (window as unknown as W).__parametric.whenBuilt());
  await page.waitForTimeout(400);

  // Drag the curved taper handle: it changes the taper angle directly.
  await page.evaluate(() => (window as unknown as W).__parametric.whenBuilt());
  const grip = page.locator('.cv-value[aria-label="Taper angle"] .cv-grip');
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2 - 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(600);

  await page.locator('.confirm-corner .ok').click();
  await page.waitForTimeout(700);
  await page.evaluate(() => (window as unknown as W).__parametric.whenBuilt());
  const res = await page.evaluate(() => {
    const a = (window as unknown as W).__parametric;
    const f = a.store.doc.features.find((x) => x.id === 'f1') as unknown as { depth: number; dir2: { depth: number } | null; draft: number };
    return { depth: Number(f.depth), d2: f.dir2 ? Number(f.dir2.depth) : null, draft: Number(f.draft), bbox: a.bbox };
  });
  expect(res.depth).toBeCloseTo(10, 1);
  expect(res.d2).toBeCloseTo(8, 1);
  expect(res.draft).toBeGreaterThan(0);
  // The solid grows both ways from the sketch plane.
  expect(res.bbox!.min[2]).toBeLessThan(-6);
  expect(res.bbox!.max[2]).toBeGreaterThan(8);
  expect(errors).toEqual([]);
});
