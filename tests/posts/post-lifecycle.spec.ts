import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { uniqueMarker } from '../helpers/test-data';
import { PostComposerPage } from '../pages/PostComposerPage';
import { PostPage } from '../pages/PostPage';
import { createPost, deletePostIfPresent } from '../helpers/post-lifecycle';

test.describe('@mutation Жизненный цикл публикации', () => {
  test.skip(!env.runMutationTests, 'Для запуска установите RUN_MUTATION_TESTS=true');

  test('создать пост, поставить реакцию, написать комментарий и удалить пост', async ({ page }) => {
    const postTitle = uniqueMarker('POST');
    const comment = uniqueMarker('COMMENT');
    const body = 'Автоматическая E2E-проверка. Запись будет удалена после теста.';
    let postUrl: string | undefined;
    let deleted = false;

    try {
      await page.goto('/feed');
      const composer = new PostComposerPage(page);
      await composer.open();
      await composer.selectDestination('Моя лента');
      await composer.fill(postTitle, body);
      await composer.publishNow();

      const heading = page.getByRole('heading', { name: postTitle, exact: true });
      await expect(heading).toBeVisible();

      const card = heading.locator(
        'xpath=ancestor::*[.//a[contains(@href,"/post/")]][1]',
      );
      const href = await card.locator('a[href*="/post/"]').first().getAttribute('href');
      expect(href).toBeTruthy();
      postUrl = new URL(href!, env.baseURL).toString();

      await page.goto(postUrl);
      await expect(page.getByRole('heading', { name: postTitle, exact: true })).toBeVisible();

      const post = new PostPage(page);
      await post.addLike();
      await post.addComment(comment);

      await page.goto('/my-publications/published');
      await expect(page.getByRole('heading', { name: postTitle, exact: true })).toBeVisible();

      await page.goto(postUrl);
      await post.deleteThroughUi();
      deleted = true;

      await page.goto(postUrl);
      await expect(page.getByText('Пост не найден', { exact: true })).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      if (postUrl && !deleted) {
        await page.goto(postUrl);
        if (await page.getByRole('button', { name: 'Действия', exact: true }).isVisible()) {
          await new PostPage(page).deleteThroughUi();
        }
      }
    }
  });

  test('ESN-200: удаляет публикацию непосредственно из карточки ленты', async ({ page }) => {
    const title = uniqueMarker('POST');
    let postUrl: string | undefined;
    let deleted = false;
    try {
      postUrl = await createPost(page, title, 'Удаление публикации из общей ленты.');
      await page.goto('/feed');
      const heading = page.getByRole('heading', { name: title, exact: true });
      await expect(heading).toBeVisible();
      const card = heading.locator('xpath=ancestor::network-post-card[1]');
      await card.getByRole('button', { name: 'Действия', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Удалить пост', exact: true }).click();
      const confirmation = page.getByRole('menuitem', { name: 'Удаляем?', exact: true });
      await expect(confirmation).toBeVisible();
      const response = page.waitForResponse((item) =>
        item.request().method() === 'DELETE' && /\/api\/post\//.test(item.url()),
      );
      await confirmation.click();
      expect((await response).ok()).toBe(true);
      deleted = true;
      await expect(heading).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
    } finally {
      if (!deleted) await deletePostIfPresent(page, postUrl);
    }
  });

  test('ESN-201: публикация открывается по дате, заголовку и описанию', async ({ page }) => {
    const title = uniqueMarker('POST');
    const body = 'Текст для проверки трёх способов открытия публикации.';
    let postUrl: string | undefined;
    try {
      postUrl = await createPost(page, title, body);
      const postPath = new URL(postUrl).pathname;
      for (const target of ['date', 'title', 'body'] as const) {
        await page.goto('/feed');
        const heading = page.getByRole('heading', { name: title, exact: true });
        await expect(heading).toBeVisible();
        const card = heading.locator('xpath=ancestor::network-post-card[1]');
        if (target === 'date') await card.locator(`a[href^="${postPath}"]`).first().click();
        if (target === 'title') await heading.click();
        if (target === 'body') await card.getByText(body, { exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`${postPath}(?:[?#]|$)`));
        await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      }
    } finally {
      await deletePostIfPresent(page, postUrl);
    }
  });
});
