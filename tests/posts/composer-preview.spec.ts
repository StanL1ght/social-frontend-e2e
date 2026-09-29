import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { PostComposerPage } from '../pages/PostComposerPage';

test.describe('Предпросмотр публикации в редакторе', () => {
  test.afterEach(async ({ page }) => {
    const back = page.getByRole('dialog', { name: /Предпросмотр публикации/ })
      .getByRole('button', { name: 'К редактированию' });
    if (await back.isVisible()) await back.click();
    await new PostComposerPage(page).discard();
  });

  test('ESN-414: предпросмотр и возврат сохраняют содержимое', async ({ page }) => {
    const title = 'QA-E2E-PREVIEW-CHECK';
    const body = 'Текст для проверки предпросмотра публикации.';
    await page.goto('/feed');
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.fill(title, body);

    await composer.dialog.getByRole('button', { name: 'Предпросмотр' }).click();
    const preview = page.getByRole('dialog', { name: /Предпросмотр публикации/ });
    await expect(preview).toBeVisible();
    await expect(preview.getByText(title, { exact: true })).toBeVisible();
    await expect(preview.getByText(body, { exact: true })).toBeVisible();

    await preview.getByRole('button', { name: 'К редактированию' }).click();
    await expect(composer.dialog).toBeVisible();
    await expect(composer.titleBlock).toHaveText(title);
    await expect(composer.editor).toContainText(body);
  });

  test('ESN-423: длинная публикация раскрывается в предпросмотре', async ({ page }) => {
    test.fail(true, 'Dev показывает длинную публикацию в preview целиком и не предоставляет требуемое действие «Читать далее»');
    const title = 'QA-E2E-LONG-PREVIEW';
    const first = 'ПЕРВЫЙ-БЛОК-ПРЕДПРОСМОТРА';
    const second = 'ВТОРОЙ-БЛОК-ПРЕДПРОСМОТРА';
    const tail = 'КОНЕЦ-ПРЕДПРОСМОТРА';
    await page.goto('/feed');
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.fill(title, `${first} ${'Длинный текст предпросмотра. '.repeat(100)}`);
    await composer.editor.press('End');
    await composer.editor.press('Enter');
    await page.keyboard.insertText(`${second} ${'Продолжение публикации. '.repeat(100)}`);
    await composer.editor.press('Enter');
    await page.keyboard.insertText(tail);

    await composer.dialog.getByRole('button', { name: 'Предпросмотр' }).click();
    const preview = page.getByRole('dialog', { name: /Предпросмотр публикации/ });
    const readMore = preview.getByText('Читать далее', { exact: true });
    await expect(readMore).toBeVisible();
    await expect(preview.getByText(first, { exact: false })).toBeVisible();
    await readMore.click();
    await expect(readMore).toBeHidden();
    const end = preview.getByText(tail, { exact: true });
    await end.scrollIntoViewIfNeeded();
    await expect(end).toBeInViewport();
    await expect(preview.getByText(second, { exact: false })).toBeVisible();
  });

  test('ESN-223, ESN-224: длинный пост раскрывается по «Читать далее» в ленте @mutation', async ({ page }) => {
    test.skip(!env.runMutationTests, 'Для публикации нужен mutation-режим');
    const title = `${uniqueMarker('POST')}-READ-MORE`;
    const tail = 'КОНЕЦ-ДЛИННОЙ-ПУБЛИКАЦИИ';
    const body = `${'Длинный текст для проверки сворачивания публикации. '.repeat(180)} ${tail}`;
    let postId: string | undefined;
    await page.goto('/feed');
    const composer = new PostComposerPage(page);
    try {
      await composer.open();
      await composer.selectDestination('Моя лента');
      await composer.fill(title, body);
      const created = page.waitForResponse(
        (response) => response.request().method() === 'POST' && /\/api\/post\/?$/.test(response.url()),
      );
      await composer.publishNow();
      postId = ((await (await created).json()) as { id: string }).id;
      await page.goto('/feed');
      const card = page.getByRole('heading', { name: title, exact: true }).locator('xpath=ancestor::network-post-card[1]');
      const readMore = card.getByText('Читать далее', { exact: true });
      await expect(readMore).toBeVisible({ timeout: 20_000 });
      const longParagraph = card.getByText(tail, { exact: false });
      await readMore.click();
      await expect(readMore).toBeHidden();
      await longParagraph.scrollIntoViewIfNeeded();
      await expect(longParagraph).toBeInViewport();
      await expect(longParagraph).toContainText(tail);
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

  test('ESN-419: форматирование первого блока сохраняется в предпросмотре', async ({ page }) => {
    await page.goto('/feed');
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.replaceTitle('QA-E2E-FORMATTED-PREVIEW');
    const endShortcut = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await composer.editor.press(endShortcut);
    await composer.editor.press('Enter');
    await composer.editor.press(`${modifier}+b`);
    await page.keyboard.type('Жирный фрагмент');
    await composer.editor.press(`${modifier}+b`);
    await page.keyboard.type(' ');
    await composer.editor.press(`${modifier}+i`);
    await page.keyboard.type('Курсивный фрагмент');
    await composer.editor.press(`${modifier}+i`);
    await expect(composer.editor.locator('strong')).toHaveText('Жирный фрагмент');
    await expect(composer.editor.locator('em')).toHaveText('Курсивный фрагмент');

    await composer.dialog.getByRole('button', { name: 'Предпросмотр' }).click();
    const preview = page.getByRole('dialog', { name: /Предпросмотр публикации/ });
    await expect(preview.locator('strong')).toHaveText('Жирный фрагмент');
    await expect(preview.locator('em')).toHaveText('Курсивный фрагмент');
  });
});
