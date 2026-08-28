import { test, expect } from '../fixtures/test';

test.describe('Мои публикации', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/my-publications/published');
    await expect(page.getByRole('button', { name: /Опубликованные \d+/ })).toBeVisible();
  });

  test('отображает вкладки и счётчики @smoke', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Опубликованные \d+/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Запланированные \d+/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Черновики \d+/ })).toBeVisible();
  });

  test('переходит между опубликованными, запланированными и черновиками', async ({ page }) => {
    await page.getByRole('button', { name: /Запланированные \d+/ }).click();
    await expect(page).toHaveURL(/\/my-publications\/scheduled/);

    await page.getByRole('button', { name: /Черновики \d+/ }).click();
    await expect(page).toHaveURL(/\/my-publications\/drafts/);

    await page.getByRole('button', { name: /Опубликованные \d+/ }).click();
    await expect(page).toHaveURL(/\/my-publications\/published/);
  });
});
