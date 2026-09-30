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

  test('ESN-26: гамбургер открывает боковую панель и все её разделы @critical', async ({ page }) => {
    const groupsLink = page.getByRole('link', { name: 'Группы', exact: true });
    const menu = page.getByRole('button', { name: '' }).first();
    await expect(groupsLink).toBeVisible();
    await menu.click();
    await expect(groupsLink).toBeHidden();
    await menu.click();
    await expect(groupsLink).toBeVisible();

    for (const item of cases) {
      await page.getByText(item.name, { exact: true }).first().click();
      await expect(page).toHaveURL(item.path);
    }
    await expect(page.getByRole('button', { name: /^Опубликованные/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Запланированные/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Черновики/ })).toBeVisible();
  });
});
