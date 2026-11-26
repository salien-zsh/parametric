import { expect, test } from '@playwright/test';
import { openApp, waitForFeature } from './helpers';

type W = { __parametric: import('../../src/app/app').App };

test('the Dimension tool picks two vertices and places a linear dimension', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /Mounting Bracket/ }).click();
  await waitForFeature(page, 'Fillet1');
  await page.evaluate(() => (window as unknown as W).__parametric.openDrawing());
  await expect(page.locator('.paper svg')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.paper g[data-view]')).toHaveCount(4, { timeout: 30_000 });

  const points = await page.evaluate(async () => {
    const a = (window as unknown as W).__parametric;
    const dw = a.drawing as unknown as {
      cache: Map<string, { result?: { visible: string[]; bounds?: [number, number, number, number] } }>;
      el: HTMLElement;
      pan: { x: number; y: number };
      zoom: number;
    };
    const d = a.store.doc.drawing!;
    const view = d.views.find((v) => v.kind === 'front') ?? d.views[0];
    const t0 = performance.now();
    while (!dw.cache.get(view.id)?.result?.bounds && performance.now() - t0 < 20_000) {
      await new Promise((r) => setTimeout(r, 16));
    }
    const pr = dw.cache.get(view.id)!.result!;
    const s = view.scale ?? d.scale;
    const b = pr.bounds!;
    const tx = view.x - (s * (b[0] + b[2])) / 2;
    const ty = view.y - (s * (b[1] + b[3])) / 2;
    const nums = (pr.visible[0] ?? 'M 0 0 L 1 0').match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const toPage = (lx: number, ly: number): [number, number] => {
      const r = dw.el.getBoundingClientRect();
      return [r.left + dw.pan.x + (tx + lx * s) * dw.zoom, r.top + dw.pan.y + (ty + ly * s) * dw.zoom];
    };
    return { a: toPage(nums[0], nums[1]), b: toPage(nums[2], nums[3]), view: view.id };
  });
  await page.evaluate(() => (window as unknown as W).__parametric.commands.run('drawing:dimension'));
  await page.mouse.click(points.a[0], points.a[1]);
  await page.mouse.click(points.b[0], points.b[1]);
  await page.waitForTimeout(500);
  const added = await page.evaluate(() => {
    const a = (window as unknown as W).__parametric;
    const dims = a.store.doc.drawing!.dimensions ?? [];
    return dims.map((d) => ({ view: d.view, length: Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) }));
  });
  expect(added).toHaveLength(1);
  expect(added[0].view).toBe(points.view);
  expect(added[0].length).toBeGreaterThan(1);
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.paper svg text')].map((t) => t.textContent ?? '').join(' ')))
    .toContain(added[0].length.toFixed(2));
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});
