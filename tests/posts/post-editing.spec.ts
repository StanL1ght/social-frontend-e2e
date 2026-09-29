import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { createPost, deletePostIfPresent } from '../helpers/post-lifecycle';
import { uniqueMarker } from '../helpers/test-data';
import { createTemporaryGroupViaApi, deleteTemporaryGroupViaApi } from '../helpers/group-api';
import { createTemporaryPostViaApi, deleteTemporaryPostViaApi } from '../helpers/post-api';
import { PostComposerPage } from '../pages/PostComposerPage';
import { PostPage } from '../pages/PostPage';

test.describe('@mutation Редактирование публикации', () => {
  test.skip(!env.runMutationTests, 'Для запуска установите RUN_MUTATION_TESTS=true');

  test('ESN-408: сохраняет и отменяет изменения личной публикации', async ({ page }) => {
    const originalTitle = uniqueMarker('POST');
    const updatedTitle = `${originalTitle}-EDITED`;
    let postUrl: string | undefined;

    try {
      postUrl = await createPost(page, originalTitle, 'Текст до редактирования.');
      await page.goto(postUrl);
      await new PostPage(page).openEditor();

      const editor = new PostComposerPage(page);
      await expect(editor.dialog).toBeVisible();
      await editor.replaceTitle(updatedTitle);
      await editor.saveChanges();

      await expect(page.getByRole('heading', { name: updatedTitle, exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: originalTitle, exact: true })).toHaveCount(0);

      await new PostPage(page).openEditor();
      await editor.replaceTitle(`${updatedTitle}-DISCARDED`);
      await expect(editor.titleBlock).toHaveText(`${updatedTitle}-DISCARDED`);
      await editor.discard();
      await expect(page.getByRole('heading', { name: updatedTitle, exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: `${updatedTitle}-DISCARDED`, exact: true })).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole('heading', { name: updatedTitle, exact: true })).toBeVisible();
    } finally {
      await deletePostIfPresent(page, postUrl);
    }
  });

  test('ESN-408: сохраняет и отменяет изменения публикации группы', async ({ page }) => {
    const groupName = uniqueMarker('GROUP');
    const originalTitle = uniqueMarker('POST');
    const updatedTitle = `${originalTitle}-EDITED`;
    let groupId: string | undefined;
    let postId: string | undefined;

    try {
      groupId = await createTemporaryGroupViaApi(page, groupName, 'Публичная группа');
      postId = await createTemporaryPostViaApi(page, originalTitle, groupId);
      await page.goto(`/post/${postId}`);
      const post = new PostPage(page);
      const editor = new PostComposerPage(page);

      await post.openEditor();
      await expect(editor.dialog).toBeVisible();
      await editor.replaceTitle(updatedTitle);
      await editor.saveChanges();
      await expect(page.getByRole('heading', { name: updatedTitle, exact: true })).toBeVisible();

      await post.openEditor();
      await editor.replaceTitle(`${updatedTitle}-DISCARDED`);
      await editor.discard();
      await page.reload();
      await expect(page.getByRole('heading', { name: updatedTitle, exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: `${updatedTitle}-DISCARDED`, exact: true })).toHaveCount(0);
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });
});
