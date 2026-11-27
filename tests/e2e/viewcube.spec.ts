import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type W = { __parametric: import('../../src/app/app').App };

test('the ViewCube turns with the camera and snaps to a clicked face', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: /Mounting Bracket/ }).click();
  await page.waitForTimeout(1200);
  await expect(page.locator('.view-cube')).toBeVisible();
  await page.evaluate(() => (window as unknown as W).__parametric.viewport.setView('isometric', false));
  await page.waitForTimeout(400);

  // Click the RIGHT face: its centroid is world (1, 0, 0), projected by the camera.
  const point = await page.evaluate(() => {
    const a = (window as unknown as W).__parametric;
    const cam = a.renderer.camera;
    const canvas = document.querySelector<HTMLCanvasElement>('.vc-canvas')!;
    const size = 112, s = 26;
    const dot = (v: number[], w: number[]) => v[0] * w[0] + v[1] * w[1] + v[2] * w[2];
    const px = size / 2 + dot([1, 0, 0], cam.right as number[]) * s;
    const py = size / 2 - dot([1, 0, 0], cam.up as number[]) * s;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + (px / size) * rect.width, y: rect.top + (py / size) * rect.height };
  });
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as W).__parametric.renderer.camera.viewName())).toBe('right');

  // The home button returns to the isometric view.
  await page.locator('.vc-home').click();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as W).__parametric.renderer.camera.viewName())).toBe('isometric');

  // A corner zone looks along that diagonal, e.g. (-1, 1, 1) = back-top-left.
  const corner = await page.evaluate(() => {
    const a = (window as unknown as W).__parametric;
    const cam = a.renderer.camera;
    const canvas = document.querySelector<HTMLCanvasElement>('.vc-canvas')!;
    const size = 112, s = 26;
    const dot = (v: number[], w: number[]) => v[0] * w[0] + v[1] * w[1] + v[2] * w[2];
    const p = [-1, 1, 1];
    const px = size / 2 + dot(p, cam.right as number[]) * s;
    const py = size / 2 - dot(p, cam.up as number[]) * s;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + (px / size) * rect.width, y: rect.top + (py / size) * rect.height };
  });
  await page.mouse.click(corner.x, corner.y);
  await page.waitForTimeout(500);
  const back = await page.evaluate(() => (window as unknown as W).__parametric.renderer.camera.back as number[]);
  const len = Math.hypot(back[0], back[1], back[2]);
  const target = [-1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)];
  const d = Math.abs((back[0] * target[0] + back[1] * target[1] + back[2] * target[2]) / len);
  expect(d).toBeGreaterThan(0.98);

  // Dragging the cube itself orbits the camera.
  const canvasBox = (await page.locator('.vc-canvas').boundingBox())!;
  const before = await page.evaluate(() => [...(window as unknown as W).__parametric.renderer.camera.rot]);
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width / 2 + 45, canvasBox.y + canvasBox.height / 2 + 20, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => [...(window as unknown as W).__parametric.renderer.camera.rot]);
  expect(Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2], after[3] - before[3])).toBeGreaterThan(0.05);
  expect(errors).toEqual([]);
});
