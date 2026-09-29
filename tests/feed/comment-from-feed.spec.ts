import { expect, test } from '../fixtures/test';
import { env } from '../helpers/env';
import { createTemporaryPostViaApi, deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';

test.describe('@mutation Комментарий из карточки ленты', () => {
  test.skip(!env.runMutationTests, 'Для запуска установите RUN_MUTATION_TESTS=true');

  test('ESN-66: открывает комментарии из ленты и отправляет текст', async ({ page }) => {
    const title = `${uniqueMarker('POST')}-FEED-COMMENT`;
    const comment = uniqueMarker('COMMENT');
    let postId: string | undefined;

    try {
      postId = await createTemporaryPostViaApi(page, title);
      await page.goto('/feed');
      const heading = page.getByRole('heading', { name: title, exact: true });
      await expect(heading).toBeVisible({ timeout: 20_000 });
      const card = heading.locator('xpath=ancestor::network-post-card[1]');
      const commentControl = card.locator('[title="Комментарии"]');
      await expect(commentControl).toBeVisible();
      await commentControl.click();

      const dialog = page.getByRole('dialog', { name: 'Комментарии' });
      await expect(dialog).toBeVisible();
      const editor = dialog.locator('.ql-editor[contenteditable="true"]');
      const attachment = dialog.getByRole('button', { name: 'Прикрепить файл' });
      const send = dialog.getByRole('button', { name: 'Отправить' });
      await expect(editor).toBeEmpty();
      await expect(attachment).toBeVisible();
      await expect(send).toBeDisabled();

      await editor.fill(comment);
      await expect(editor).toContainText(comment);
      await expect(send).toBeEnabled();
      const responsePromise = page.waitForResponse(
        (response) => response.request().method() === 'POST' && /\/comment(?:\/|\?|$)/i.test(response.url()),
        { timeout: 30_000 },
      );
      await send.click();
      expect((await responsePromise).ok()).toBe(true);
      await expect(dialog.getByText(comment, { exact: true })).toBeVisible({ timeout: 20_000 });
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });
});
