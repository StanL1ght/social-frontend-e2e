import { test, expect } from '../fixtures/test';
import { AppShellPage } from '../pages/AppShellPage';

test.describe('@smoke Основная навигация', () => {
  const cases = [
    { name: 'Лента', path: /\/feed/ },
    { name: 'Группы', path: /\/group/ },
    { name: 'Персоны', path: /\/catalogs/ },
    { name: 'Моя страница', path: /\/profile\// },
    { name: 'Мои публикации', path: /\/my-publications/ },
  ] as const;

  test.beforeEach(async ({ page }) => {
    await new AppShellPage(page).goto('/feed');
  });

  for (const item of cases) {
    test('переход: ' + item.name, async ({ page }) => {
      await new AppShellPage(page).openSection(item.name);
      await expect(page).toHaveURL(item.path);
    });
  }

  test('корневой маршрут переводит в ленту', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/feed/);
  });
});
