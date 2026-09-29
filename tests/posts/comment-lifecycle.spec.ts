import { expect, test } from '../fixtures/test';
import { env } from '../helpers/env';
import { createPost, deletePostIfPresent } from '../helpers/post-lifecycle';
import { createTemporaryCommentViaApi } from '../helpers/comment-api';
import { createTemporaryPostViaApi, deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { PostPage } from '../pages/PostPage';

test.describe('@mutation Комментарии и ответы', () => {
  test.skip(!env.runMutationTests, 'Для запуска установите RUN_MUTATION_TESTS=true');

  test('создаёт, редактирует, отвечает и удаляет комментарий', async ({ page }) => {
    const title = uniqueMarker('POST');
    const comment = uniqueMarker('COMMENT');
    const editedComment = `${comment}-EDITED`;
    const reply = uniqueMarker('REPLY');
    let postUrl: string | undefined;

    try {
      postUrl = await createPost(page, title, 'Проверка жизненного цикла комментария.');
      await page.goto(postUrl);

      const post = new PostPage(page);
      await post.addComment(comment);
      await post.editComment(comment, editedComment);
      await post.replyToComment(editedComment, reply);
      await post.deleteComment(editedComment);
      await expect(page.getByRole('dialog', { name: 'Комментарии' }).getByText(new RegExp(reply))).toBeHidden({
        timeout: 20_000,
      });
    } finally {
      await deletePostIfPresent(page, postUrl);
    }
  });

  test('прикладывает текстовый файл к комментарию', async ({ page }) => {
    const title = uniqueMarker('POST');
    const comment = uniqueMarker('COMMENT');
    let postUrl: string | undefined;

    try {
      postUrl = await createPost(page, title, 'Проверка вложения комментария.');
      await page.goto(postUrl);
      await new PostPage(page).addCommentWithTextAttachment(comment);
    } finally {
      await deletePostIfPresent(page, postUrl);
    }
  });

  test('ESN-335: отменяет редактирование комментария с вложением', async ({ page }) => {
    test.fail(true, 'Известный дефект: после отмены редактирования файлы и музыка остаются видимыми в редакторе');
    const title = uniqueMarker('POST');
    const comment = `${uniqueMarker('COMMENT')}-CANCEL-EDIT`;
    const documentName = 'qa-e2e-cancel-edit.pdf';
    let postUrl: string | undefined;

    try {
      postUrl = await createPost(page, title, 'Проверка отмены редактирования комментария с вложением.');
      await page.goto(postUrl);
      const comments = page.getByRole('dialog', { name: 'Комментарии' });
      const editor = comments.locator('.ql-editor[contenteditable="true"]');
      const video = await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 24;
        const stream = canvas.captureStream(5);
        const mimeType = ['video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type))!;
        const recorder = new MediaRecorder(stream, { mimeType });
        const chunks: Blob[] = [];
        recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
        const stopped = new Promise<void>((resolve) => recorder.onstop = () => resolve());
        recorder.start();
        await new Promise((resolve) => setTimeout(resolve, 500));
        recorder.stop();
        await stopped;
        stream.getTracks().forEach((track) => track.stop());
        return { mimeType, bytes: [...new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer())] };
      });
      const audio = Buffer.alloc(44 + 8_000);
      audio.write('RIFF', 0);
      audio.writeUInt32LE(audio.length - 8, 4);
      audio.write('WAVEfmt ', 8);
      audio.writeUInt32LE(16, 16);
      audio.writeUInt16LE(1, 20);
      audio.writeUInt16LE(1, 22);
      audio.writeUInt32LE(8_000, 24);
      audio.writeUInt32LE(16_000, 28);
      audio.writeUInt16LE(2, 32);
      audio.writeUInt16LE(16, 34);
      audio.write('data', 36);
      audio.writeUInt32LE(8_000, 40);
      await comments.locator('input[type="file"]').last().setInputFiles([
        {
          name: 'qa-e2e-cancel-edit.png',
          mimeType: 'image/png',
          buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xw4AAAAASUVORK5CYII=', 'base64'),
        },
        { name: 'qa-e2e-cancel-edit.webm', mimeType: video.mimeType, buffer: Buffer.from(video.bytes) },
        { name: 'qa-e2e-cancel-edit.wav', mimeType: 'audio/wav', buffer: audio },
        {
          name: documentName,
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'),
        },
      ]);
      await expect(comments.getByText(documentName, { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(comments.locator('img[alt="qa-e2e-cancel-edit.png"]')).toBeVisible({ timeout: 30_000 });
      await expect(comments.locator('video')).toBeAttached({ timeout: 30_000 });
      await expect(comments.locator('audio')).toBeAttached({ timeout: 30_000 });
      await editor.fill(comment);
      await expect(comments.getByRole('button', { name: 'Отправить' })).toBeEnabled({ timeout: 20_000 });
      const created = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/comment(?:\/|\?|$)/i.test(response.url()),
      );
      await comments.getByRole('button', { name: 'Отправить' }).click();
      expect((await created).ok()).toBe(true);

      const card = comments.locator('network-comment-card').filter({ hasText: comment }).first();
      await expect(card).toContainText(documentName, { timeout: 20_000 });
      await expect(card.locator('img[alt="qa-e2e-cancel-edit.png"]')).toBeVisible();
      await expect(card.locator('video')).toBeAttached();
      await expect(card.locator('audio')).toBeAttached();
      await card.getByRole('button', { name: 'Редактировать', exact: true }).click();
      const editing = comments.getByText('Редактирование', { exact: true });
      await expect(editing).toBeVisible();
      await expect(editor).toContainText(comment);
      const unsaved = `${comment}-UNSAVED`;
      await editor.fill(unsaved);
      await expect(editor).toContainText(unsaved);

      const editingPanel = editing.locator('xpath=..');
      await editingPanel.getByRole('button').click();
      await expect(editing).toBeHidden();
      await expect(editor).toBeEmpty();
      await expect.poll(() => comments.locator('input[type="file"]').last().evaluate(
        (input) => (input as HTMLInputElement).files?.length ?? 0,
      )).toBe(0);
      await expect(card).toContainText(documentName);
      await expect(card).toContainText(comment);
      await expect(card).not.toContainText(unsaved);

      await page.reload();
      const restoredCard = page.getByRole('dialog', { name: 'Комментарии' })
        .locator('network-comment-card')
        .filter({ hasText: comment })
        .first();
      await expect(restoredCard).toContainText(comment, { timeout: 20_000 });
      await expect(restoredCard).toContainText(documentName);
      await expect(restoredCard.locator('img[alt="qa-e2e-cancel-edit.png"]')).toBeVisible();
      await expect(restoredCard.locator('video')).toBeAttached();
      await expect(restoredCard.locator('audio')).toBeAttached();
      await expect(restoredCard).not.toContainText(unsaved);
    } finally {
      await deletePostIfPresent(page, postUrl);
    }
  });

  test('ESN-336: публикует комментарий клавишей Enter', async ({ page }) => {
    const title = uniqueMarker('POST');
    const comment = `${uniqueMarker('COMMENT')}-ENTER`;
    let postUrl: string | undefined;
    try {
      postUrl = await createPost(page, title, 'Проверка отправки комментария клавишей Enter.');
      await page.goto(postUrl);
      const comments = page.getByRole('dialog', { name: 'Комментарии' });
      const editor = comments.locator('.ql-editor[contenteditable="true"]');
      const send = comments.getByRole('button', { name: 'Отправить' });
      await expect(editor).toBeVisible();
      await expect(comments.getByRole('button', { name: 'Прикрепить файл' })).toBeVisible();
      await expect(send).toBeDisabled();
      await editor.click();
      await page.keyboard.insertText(comment);
      await expect(send).toBeEnabled();
      const created = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/comment(?:\/|\?|$)/i.test(response.url()),
      );
      await page.keyboard.press('Enter');
      expect((await created).ok()).toBe(true);
      await expect(comments.getByText(comment, { exact: true })).toBeVisible({ timeout: 15_000 });
    } finally {
      await deletePostIfPresent(page, postUrl);
    }
  });

  test('ESN-312, ESN-328: находит и публикует упоминание пользователя в комментарии', async ({ page }) => {
    const title = uniqueMarker('POST');
    const suffix = `${uniqueMarker('COMMENT')}-MENTION`;
    let postUrl: string | undefined;
    try {
      postUrl = await createPost(page, title, 'Проверка упоминания в комментарии.');
      await page.goto(postUrl);
      const comments = page.getByRole('dialog', { name: 'Комментарии' });
      const editor = comments.locator('.ql-editor[contenteditable="true"]');
      await editor.click();
      await page.keyboard.type(`@${env.mentionQuery}`);
      const suggestion = page.getByRole('option')
        .filter({ hasText: new RegExp(env.mentionQuery, 'i'), visible: true })
        .first();
      await expect(suggestion).toBeVisible({ timeout: 15_000 });
      const mentionedName = (await suggestion.innerText()).split('\n')[0].trim();
      await suggestion.click();
      await editor.press('End');
      await page.keyboard.insertText(` ${suffix}`);
      await comments.getByRole('button', { name: 'Отправить' }).click();
      const card = comments.locator('network-comment-card').filter({ hasText: suffix });
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card).toContainText(mentionedName);
      await expect(card.getByText(mentionedName, { exact: false })).toBeVisible();
    } finally {
      await deletePostIfPresent(page, postUrl);
    }
  });

  test('ESN-68: переключает порядок комментариев между новыми и старыми', async ({ page }) => {
    const title = uniqueMarker('POST');
    const first = `${uniqueMarker('COMMENT')}-FIRST`;
    const second = `${uniqueMarker('COMMENT')}-SECOND`;
    let postUrl: string | undefined;
    try {
      postUrl = await createPost(page, title, 'Проверка сортировки комментариев.');
      await page.goto(postUrl);
      const post = new PostPage(page);
      await post.addComment(first);
      await post.addComment(second);
      const comments = page.getByRole('dialog', { name: 'Комментарии' });
      const firstComment = comments.getByText(first, { exact: true });
      const secondComment = comments.getByText(second, { exact: true });
      await expect(firstComment).toBeVisible();
      await expect(secondComment).toBeVisible();

      const appearsBefore = async (left: typeof firstComment, right: typeof firstComment) => left.evaluate(
        (element, other) => Boolean(element.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING),
        await right.elementHandle(),
      );

      await comments.getByRole('button', { name: 'Сначала новые', exact: true }).click();
      await page.getByRole('option', { name: 'Сначала старые', exact: true }).click();
      await expect.poll(() => appearsBefore(firstComment, secondComment)).toBe(true);

      await comments.getByRole('button', { name: 'Сначала старые', exact: true }).click();
      await page.getByRole('option', { name: 'Сначала новые', exact: true }).click();
      await expect.poll(() => appearsBefore(secondComment, firstComment)).toBe(true);
    } finally {
      await deletePostIfPresent(page, postUrl);
    }
  });

  test('ESN-337, ESN-338: после ответа переходит к новому ответу и обратно к исходному комментарию', async ({ page }) => {
    test.setTimeout(120_000);
    const title = `${uniqueMarker('POST')}-REPLY-SCROLL`;
    const oldest = `${uniqueMarker('COMMENT')}-OLDEST`;
    const reply = `${uniqueMarker('REPLY')}-SCROLL`;
    let postId: string | undefined;
    try {
      postId = await createTemporaryPostViaApi(page, title);
      await createTemporaryCommentViaApi(page, postId, oldest);
      for (let index = 0; index < 14; index += 1) {
        await createTemporaryCommentViaApi(page, postId, `${uniqueMarker('COMMENT')}-FILLER-${index + 1}`);
      }

      await page.goto(`/post/${postId}`);
      const comments = page.getByRole('dialog', { name: 'Комментарии' });
      const oldestCard = comments.locator('network-comment-card').filter({ hasText: oldest }).first();
      await oldestCard.scrollIntoViewIfNeeded();
      await expect(oldestCard).toBeInViewport();
      await oldestCard.getByRole('button', { name: 'Ответить', exact: true }).click();

      const editor = comments.locator('.ql-editor[contenteditable="true"]').last();
      await expect(editor).not.toBeEmpty({ timeout: 20_000 });
      await editor.press('End');
      await page.keyboard.insertText(` ${reply}`);
      const created = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/comment(?:\/|\?|$)/i.test(response.url()),
      );
      await comments.getByRole('button', { name: 'Отправить' }).last().click();
      expect((await created).ok()).toBe(true);

      const replyText = comments.getByText(reply, { exact: false }).first();
      await expect(replyText).toBeVisible({ timeout: 20_000 });
      await expect(replyText).toBeInViewport();
      const reference = comments.getByRole('button', { name: new RegExp(oldest) }).first();
      await expect(reference).toBeVisible();
      await reference.click();
      await expect(oldestCard).toBeInViewport();
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

  test('ESN-76: объёмный комментарий раскрывается по кнопке «Ещё»', async ({ page }) => {
    const title = uniqueMarker('POST');
    const tail = `${uniqueMarker('COMMENT')}-TAIL`;
    const comment = `${'Длинный текст комментария. '.repeat(180)} ${tail}`;
    let postUrl: string | undefined;
    try {
      postUrl = await createPost(page, title, 'Проверка раскрытия длинного комментария.');
      await page.goto(postUrl);
      const comments = page.getByRole('dialog', { name: 'Комментарии' });
      await comments.locator('.ql-editor[contenteditable="true"]').fill(comment);
      const created = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/comment(?:\/|\?|$)/i.test(response.url()),
      );
      await comments.getByRole('button', { name: 'Отправить' }).click();
      expect((await created).ok()).toBe(true);
      const card = comments.locator('network-comment-card').filter({ hasText: 'Длинный текст комментария.' }).first();
      await expect(card).toBeVisible();
      // В компоненте ссылка раскрытия пока не размечена как button/link,
      // поэтому привязываемся к её видимому пользовательскому тексту.
      const more = card.getByText('Ещё', { exact: true });
      await expect(more).toBeVisible();
      await more.click();
      await expect(more).toBeHidden();
      const text = card.getByText(tail, { exact: false });
      await text.scrollIntoViewIfNeeded();
      await expect(text).toBeInViewport();
      await expect(text).toContainText(tail);
    } finally {
      await deletePostIfPresent(page, postUrl);
    }
  });
});
