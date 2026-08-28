import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { uniqueMarker } from '../helpers/test-data';
import { PostComposerPage } from '../pages/PostComposerPage';
import { PostPage } from '../pages/PostPage';

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
});
