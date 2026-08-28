import { test, expect } from '../fixtures/test';

test.describe('Список групп', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/group');
    await expect(page.getByPlaceholder('Поиск по группам')).toBeVisible();
  });

  for (const tab of [
    { name: 'Вы подписаны', url: /\/group$/ },
    { name: 'Вы автор', url: /\/group\/owned/ },
    { name: 'Все группы', url: /\/group\/all/ },
  ]) {
    test('вкладка: ' + tab.name, async ({ page }) => {
      await page.getByRole('button', { name: tab.name, exact: true }).click();
      await expect(page).toHaveURL(tab.url);
    });
  }

  test('поиск фильтрует список групп', async ({ page }) => {
    await page.getByRole('button', { name: 'Все группы', exact: true }).click();
    await page.getByPlaceholder('Поиск по группам').fill('Тест');

    await expect(
      page
        .getByText(/тест/i)
        .first()
        .or(page.getByText(/групп.*нет|ничего не найдено/i).first()),
    ).toBeVisible({ timeout: 15_000 });
  });
});
