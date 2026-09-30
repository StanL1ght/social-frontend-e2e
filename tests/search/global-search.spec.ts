import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { AppShellPage } from '../pages/AppShellPage';

test.describe('Глобальный поиск', () => {
  test.beforeEach(async ({ page }) => {
    await new AppShellPage(page).goto('/feed');
  });

  test('открывается и закрывается по Escape @smoke @critical', async ({ page }) => {
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
    const responsePromise = page.waitForResponse(
      (response) =>
        /search|multisearch|multi-search/i.test(response.url()) &&
        response.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await shell.searchGlobally('тест');
    const response = await responsePromise;
    expect(response.ok()).toBe(true);

    const dialog = page.getByRole('dialog', { name: 'Поиск' });
    await expect(dialog).toBeVisible();
  });

  test('ESN-59: глобальный поиск работает после прокрутки ленты', async ({ page }) => {
    await expect(page.locator('a[href*="/post/"]').first()).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => {
      const candidates = [document.scrollingElement, ...document.querySelectorAll<HTMLElement>('*')]
        .filter((element): element is HTMLElement => Boolean(element))
        .filter((element) => element.scrollHeight > element.clientHeight + 300);
      candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0]?.scrollTo({ top: 3_000 });
    });

    const responsePromise = page.waitForResponse(
      (response) => /search|multisearch|multi-search/i.test(response.url()) && response.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await new AppShellPage(page).searchGlobally('тест');
    expect((await responsePromise).ok()).toBe(true);
    await expect(page.getByRole('dialog', { name: 'Поиск' })).toBeVisible();
  });

  test('ESN-53: результат категории людей открывает профиль', async ({ page }) => {
    await new AppShellPage(page).searchGlobally('тест');
    const dialog = page.getByRole('dialog', { name: 'Поиск' });
    const person = dialog.locator('a[href*="/profile/"]').filter({ visible: true }).first();
    await expect(person).toBeVisible({ timeout: 20_000 });
    const profilePath = await person.getAttribute('href');
    expect(profilePath).toMatch(/^\/profile\//);
    await person.click();
    await expect(page).toHaveURL(new RegExp(`${profilePath}(?:[/?#]|$)`));
  });

  test('ESN-54: найденная группа открывается из глобального поиска', async ({ page }) => {
    test.skip(!env.managedGroupUrl, 'Нужна указанная в env постоянная тестовая группа');
    const groupId = env.managedGroupUrl.match(/\/group\/([^/]+)/)?.[1];
    expect(groupId).toBeTruthy();
    const groupResponse = await page.request.get(`https://dev-social-backend.sddt.efko.ru/api/group/${groupId}`);
    expect(groupResponse.ok()).toBe(true);
    const group = (await groupResponse.json()) as { name: string };
    await new AppShellPage(page).searchGlobally(group.name);
    const dialog = page.getByRole('dialog', { name: 'Поиск' });
    const result = dialog.getByRole('option').filter({ hasText: group.name }).last();
    await expect(result).toBeVisible({ timeout: 20_000 });
    await result.click();
    await expect(page).toHaveURL(new RegExp(`/group/${groupId}(?:/posts)?(?:[/?#]|$)`));
    await expect(page.getByRole('heading', { name: group.name, exact: true })).toBeVisible();
  });

  test('ESN-55: найденная запись открывается из глобального поиска', async ({ page }) => {
    await new AppShellPage(page).searchGlobally('QA-E2E-POST');
    const dialog = page.getByRole('dialog', { name: 'Поиск' });
    const result = dialog.getByRole('option').first();
    await expect(result).toBeVisible({ timeout: 20_000 });
    const title = (await result.innerText()).split('\n')[0].trim();
    await result.click();
    await expect(page).toHaveURL(/\/post\/[0-9a-f-]+(?:[/?#]|$)/i);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  });
});
