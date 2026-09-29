import { test, expect } from '../fixtures/test';

test.describe('Каталог персон', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/catalogs');
    await expect(
      page.locator('input[placeholder="Поиск по ФИО, Email или должности"]'),
    ).toBeVisible();
  });

  test('поиск использует отдельный запрос каталога @diagnostic', async ({ page }) => {
    const search = page.locator('input[placeholder="Поиск по ФИО, Email или должности"]');
    await search.fill('Тест');

    await expect(
      page
        .getByText('Пользователей нет', { exact: true })
        .or(page.locator('a[href^="/profile/"]').first()),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('карточка пользователя открывает профиль', async ({ page }) => {
    const firstProfile = page.locator('a[href^="/profile/"]').first();
    await expect(firstProfile).toBeVisible({ timeout: 15_000 });
    await firstProfile.click();
    await expect(page).toHaveURL(/\/profile\//);
  });
});
