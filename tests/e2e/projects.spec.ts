import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

type W = { __parametric: import('../../src/app/app').App };

test('local projects: create a project, save a part into it and find it again', async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.locator('.home')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'My Projects' })).toBeVisible();
  await expect(page.getByText('All projects are stored on this device. Nothing is uploaded.')).toBeVisible();

  // Create a project without a folder: it groups browser-stored parts.
  await page.locator('.home-new-project').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Project name' }).fill('Shop Parts');
  await dialog.getByRole('button', { name: /^(OK|Save|Create)$/ }).click();
  await expect(page.getByRole('heading', { name: 'Shop Parts' })).toBeVisible();

  // New part in the project; the first save asks which project to store it in.
  await page.getByRole('button', { name: 'New Part in Project' }).first().click();
  await expect(page.locator('.home')).toHaveCount(0);
  await page.keyboard.press('Control+s');
  const saveDialog = page.getByRole('dialog');
  await expect(saveDialog.getByRole('heading', { name: 'Save to project' })).toBeVisible();
  await saveDialog.getByRole('radio', { name: 'Shop Parts' }).click();
  await saveDialog.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(600);

  const saved = await page.evaluate(() => {
    const a = (window as unknown as W).__parametric;
    const assignments = JSON.parse(localStorage.getItem('parametric:project-parts') || '{}') as Record<string, string>;
    const projects = JSON.parse(localStorage.getItem('parametric:projects') || '[]') as { id: string; name: string }[];
    const project = projects.find((p) => p.name === 'Shop Parts');
    return {
      location: a.location?.type ?? null,
      assigned: project ? Object.values(assignments).includes(project.id) : false,
      name: a.store.doc.name,
    };
  });
  expect(saved.location).toBe('local');
  expect(saved.assigned).toBe(true);

  // Reloading shows the project home again; the project card lists the saved part.
  await page.reload();
  await expect(page.locator('.home')).toBeVisible({ timeout: 30_000 });
  // The home reopens on the last active project.
  await expect(page.getByRole('heading', { name: 'Shop Parts' })).toBeVisible();
  await expect(page.locator('.home-card.file').filter({ hasText: saved.name })).toHaveCount(1);
  expect(errors).toEqual([]);
});
