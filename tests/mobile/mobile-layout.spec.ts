import { test, expect } from '../fixtures/test';

test.describe('@mobile Мобильный и узкий вид', () => {
  test('шапка групп содержит мобильные элементы', async ({ page }) => {
    await page.goto('/group');

    await expect(page.getByRole('button', { name: 'Создать группу' })).toBeVisible();
    await expect(page.getByPlaceholder(/Поиск/).first()).toBeVisible();
    await expect(page.getByText('Дивизион', { exact: true }).first()).toBeVisible();
  });

  test('кнопка поиска имеет доступное имя @known-bug', async ({ page }) => {
    await page.goto('/feed');

    await expect(page.getByRole('button', { name: 'Поиск', exact: true })).toBeVisible();
  });

  test('ширина страницы не превышает viewport', async ({ page }) => {
    await page.goto('/feed');
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));

    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
  });
});
