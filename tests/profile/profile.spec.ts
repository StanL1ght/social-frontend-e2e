import { test, expect } from '../fixtures/test';
import { AppShellPage } from '../pages/AppShellPage';

test.describe('Моя страница', () => {
  test.beforeEach(async ({ page }) => {
    await new AppShellPage(page).goto('/feed');
    await new AppShellPage(page).openSection('Моя страница');
    await expect(page).toHaveURL(/\/profile\//);
  });

  test('отображает основные вкладки профиля', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Публикации', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Участники', exact: true })).toBeVisible();
    await expect(
      page
        .getByRole('button', { name: 'Реакции и комментарии', exact: true })
        .or(page.getByText('Реакции и комментарии', { exact: true })),
    ).toBeVisible();
  });
});
