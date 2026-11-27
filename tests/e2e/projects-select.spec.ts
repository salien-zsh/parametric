import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

test('the sidebar project dropdown switches the current project', async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.locator('.home')).toBeVisible();

  const create = async (name: string) => {
    await page.locator('.home-new-project').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Project name' }).fill(name);
    await dialog.getByRole('button', { name: /^(OK|Save|Create)$/ }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();
  };
  await create('Alpha');
  await page.locator('.home-back').click();
  await create('Beta');
  await page.locator('.home-back').click();

  const select = page.getByRole('combobox', { name: 'Current project' });
  await expect(select).toBeVisible();
  const options = await page.locator('.home-project-select option').evaluateAll((os) => os.map((o) => ({ value: (o as HTMLOptionElement).value, text: o.textContent ?? '' })));
  // The first option is the overview, then one option per project.
  expect(options).toHaveLength(3);
  const beta = options.find((o) => o.text.startsWith('Beta'))!;
  expect(beta).toBeTruthy();

  // Choosing a project from the dropdown makes it current and opens its page.
  await select.selectOption(beta.value);
  await expect(page.getByRole('heading', { name: 'Beta' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('parametric:active-project'))).toBe(beta.value);

  // The all-projects option returns to the overview.
  await select.selectOption('');
  await expect(page.getByRole('heading', { name: 'My Projects' })).toBeVisible();
  expect(errors).toEqual([]);
});
