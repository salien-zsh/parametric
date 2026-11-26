import { expect, test } from '@playwright/test';
import { openApp, waitForFeature } from './helpers';

type W = { __parametric: import('../../src/app/app').App };

test('the Callout tool attaches a tolerance frame and its text can be edited', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /Mounting Bracket/ }).click();
  await waitForFeature(page, 'Fillet1');
  await page.evaluate(() => (window as unknown as W).__parametric.openDrawing());
  await expect(page.locator('.paper g[data-view]')).toHaveCount(4, { timeout: 30_000 });

  const point = await page.evaluate(async () => {
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
    const r = dw.el.getBoundingClientRect();
    return [r.left + dw.pan.x + (tx + nums[0] * s) * dw.zoom, r.top + dw.pan.y + (ty + nums[1] * s) * dw.zoom];
  });
  await page.evaluate(() => (window as unknown as W).__parametric.commands.run('drawing:callout'));
  await page.mouse.click(point[0], point[1]);
  await page.waitForTimeout(600);
  const added = await page.evaluate(() => {
    const a = (window as unknown as W).__parametric;
    return (a.store.doc.drawing!.callouts ?? []).map((c) => ({ view: c.view, text: c.text }));
  });
  expect(added).toHaveLength(1);
  expect(added[0].text.length).toBeGreaterThan(2);
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.paper svg text')].map((t) => t.textContent ?? '').join(' ')))
    .toContain(added[0].text);

  // The frame text is editable from the drawing panel.
  const input = page.getByRole('textbox', { name: 'Callout text' });
  await input.fill('FLT 0.1');
  await input.press('Enter');
  await page.waitForTimeout(500);
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.paper svg text')].map((t) => t.textContent ?? '').join(' ')))
    .toContain('FLT 0.1');
  expect(errors).toEqual([]);
});
