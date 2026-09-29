import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { createPost, deletePostIfPresent } from '../helpers/post-lifecycle';
import { uniqueMarker } from '../helpers/test-data';

test.describe('Меню существующей публикации', () => {
  test('ESN-215: автор видит полный набор действий со своей публикацией @mutation', async ({ page }) => {
    test.skip(!env.runMutationTests, 'Нужно создать временную публикацию');
    let postUrl: string | undefined;
    try {
      postUrl = await createPost(page, uniqueMarker('POST'), 'Проверка меню автора публикации.');
      await page.goto(postUrl);
      await page.getByRole('button', { name: 'Действия', exact: true }).click();

      for (const action of [
        /^Репост/,
        /^Копировать ссылку$/,
        /^Редактировать(?: пост)?$/,
        /^Скрыть(?: пост)?$/,
        /^Удалить пост$/,
      ]) {
        await expect(page.getByRole('menuitem', { name: action }).first()).toBeVisible();
      }
    } finally {
      await deletePostIfPresent(page, postUrl);
    }
  });

  test('ESN-205: копирует работоспособную ссылку на публикацию @mutation', async ({ page }) => {
    test.skip(!env.runMutationTests, 'Нужно создать временную публикацию');
    const title = uniqueMarker('POST');
    let postUrl: string | undefined;
    try {
      postUrl = await createPost(page, title, 'Публикация для проверки скопированной ссылки.');
      await page.goto(postUrl);
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
        origin: new URL(postUrl).origin,
      });

      await page.getByRole('button', { name: 'Действия', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Копировать ссылку', exact: true }).click();
      await expect(page.getByText('Ссылка скопирована', { exact: true })).toBeVisible();

      const copiedUrl = await page.evaluate(() => navigator.clipboard.readText());
      expect(new URL(copiedUrl).pathname).toBe(new URL(postUrl!).pathname);
      const opened = await page.context().newPage();
      await opened.goto(copiedUrl);
      await expect(opened).toHaveURL(new URL(postUrl).pathname);
      await expect(opened.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await opened.close();
    } finally {
      await deletePostIfPresent(page, postUrl);
    }
  });

  test('ESN-222: ссылки публикации и автора открываются в новых вкладках @mutation', async ({ page }) => {
    test.skip(!env.runMutationTests, 'Нужно создать временную публикацию');
    const title = `${uniqueMarker('POST')}-NEW-TABS`;
    let postUrl: string | undefined;
    try {
      postUrl = await createPost(page, title, 'Проверка стандартного открытия ссылок карточки в новой вкладке.');
      await page.goto('/feed');
      const card = page.getByRole('heading', { name: title, exact: true })
        .locator('xpath=ancestor::network-post-card[1]');
      await expect(card).toBeVisible({ timeout: 20_000 });

      const postLink = card.locator('a[href*="/post/"]').first();
      const postHref = await postLink.getAttribute('href');
      expect(postHref).toMatch(/\/post\//);
      const postTabPromise = page.context().waitForEvent('page');
      await postLink.click({ button: 'middle' });
      const postTab = await postTabPromise;
      await postTab.waitForLoadState('domcontentloaded');
      await expect(postTab).toHaveURL(new RegExp(postHref!.split('?')[0]));
      await expect(postTab.getByRole('heading', { name: title, exact: true })).toBeVisible();

      const authorLink = card.locator('a[href*="/profile/"]').first();
      const authorHref = await authorLink.getAttribute('href');
      expect(authorHref).toMatch(/\/profile\//);
      const authorTabPromise = page.context().waitForEvent('page');
      await authorLink.click({ button: 'middle' });
      const authorTab = await authorTabPromise;
      await authorTab.waitForLoadState('domcontentloaded');
      await expect(authorTab).toHaveURL(new RegExp(authorHref!));
      await expect(authorTab.getByRole('button', { name: 'Публикации', exact: true })).toBeVisible();
      await authorTab.close();
      await postTab.close();
    } finally {
      await deletePostIfPresent(page, postUrl);
    }
  });
});
