import { test, expect } from '../fixtures/test';
import { createTemporaryPostViaApi, deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { PostPage } from '../pages/PostPage';
import { env } from '../helpers/env';

test.skip(!env.runMutationTests, 'Запускать с RUN_MUTATION_TESTS=true: удаление переносит тестовую запись в «Удалённые».');

test('ESN-497, ESN-498: своя публикация проходит через «Скрытые» и «Удалённые» @mutation', async ({ page }) => {
  const title = uniqueMarker('POST');
  let postId: string | undefined;
  let deleted = false;
  try {
    postId = await createTemporaryPostViaApi(page, title);
    await page.goto(`/post/${postId}`);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await new PostPage(page).openActions();
    await page.getByRole('menuitem', { name: /Скрыть/ }).click();
    await page.getByRole('menuitem', { name: 'Скрыть публикацию?', exact: true }).click();

    await page.goto('/my-publications/hidden');
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();

    await deleteTemporaryPostViaApi(page, postId);
    deleted = true;
    await page.goto('/my-publications/deleted');
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  } finally {
    if (!deleted) await deleteTemporaryPostViaApi(page, postId);
  }
});
