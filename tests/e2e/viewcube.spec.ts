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
  expect(errors).toEqual([]);
});
