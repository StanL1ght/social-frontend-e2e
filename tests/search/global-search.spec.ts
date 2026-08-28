import { test, expect } from '../fixtures/test';
import { AppShellPage } from '../pages/AppShellPage';

test.describe('Глобальный поиск', () => {
  test.beforeEach(async ({ page }) => {
    await new AppShellPage(page).goto('/feed');
  });

  test('открывается и закрывается по Escape @smoke', async ({ page }) => {
    const shell = new AppShellPage(page);
    await shell.openGlobalSearch();

    const search = page.getByRole('searchbox', {
      name: 'Поиск по записям, людям и группам',
    });
    await expect(search).toBeVisible();
    await search.press('Escape');
    await expect(search).toBeHidden();
  });

  test('одного символа недостаточно для выдачи', async ({ page }) => {
    const shell = new AppShellPage(page);
    await shell.searchGlobally('т');

    const dialog = page.getByRole('dialog', { name: 'Поиск' });
    await expect(dialog.getByText('ЗАПИСИ', { exact: true })).toHaveCount(0);
    await expect(dialog.getByText('ЛЮДИ', { exact: true })).toHaveCount(0);
    await expect(dialog.getByText('ГРУППЫ', { exact: true })).toHaveCount(0);
  });

  test('поиск отправляет сетевой запрос и показывает категории @diagnostic', async ({ page }) => {
    const shell = new AppShellPage(page);
    await shell.searchGlobally('тест');

    const dialog = page.getByRole('dialog', { name: 'Поиск' });
    await expect(
      dialog
        .getByText('ЗАПИСИ', { exact: true })
        .or(dialog.getByText('ЛЮДИ', { exact: true }))
        .or(dialog.getByText('ГРУППЫ', { exact: true })),
    ).toBeVisible({ timeout: 15_000 });
  });
});
