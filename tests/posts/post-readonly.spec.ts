import { test, expect } from '../fixtures/test';

test.describe('Меню существующей публикации', () => {
  test('копирует ссылку и показывает тост', async ({ page }) => {
    await page.goto('/my-publications/published');
    const firstPost = page.locator('a[href*="/post/"]').first();
    await expect(firstPost).toBeVisible({ timeout: 20_000 });

    const href = await firstPost.getAttribute('href');
    expect(href).toBeTruthy();
    await page.goto(href!);

    await page.getByRole('button', { name: 'Действия', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Копировать ссылку', exact: true }).click();
    await expect(page.getByText('Ссылка скопирована', { exact: true })).toBeVisible();
  });
});
