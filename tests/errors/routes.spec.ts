import { test, expect } from '../fixtures/test';

test.describe('Служебные маршруты', () => {
  test('неизвестный маршрут переводит на 404 @known-bug', async ({ page }) => {
    test.fail(true, 'Известный дефект: неизвестный URL остаётся открытым без страницы 404');

    await page.goto('/qa-e2e-route-that-does-not-exist');
    await expect(page).toHaveURL(/\/404\/not-found/);
  });

  test('/hashtag без id переводит на 404 @known-bug', async ({ page }) => {
    test.fail(true, 'Известный дефект: /hashtag без id не переводит на страницу 404');

    await page.goto('/hashtag');
    await expect(page).toHaveURL(/\/404\/not-found/);
  });

  test('несуществующий пост показывает понятное состояние', async ({ page }) => {
    await page.goto('/post/00000000-0000-4000-8000-000000000000');
    await expect(page.getByText('Пост не найден', { exact: true })).toBeVisible({
      timeout: 20_000,
    });
  });
});
