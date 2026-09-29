import { expect, test } from '../fixtures/test';
import { env } from '../helpers/env';
import { createTemporaryGroupViaApi, deleteTemporaryGroupViaApi } from '../helpers/group-api';
import { chooseFiles, pdf, png, recordedWebm, wav, type UploadFile } from '../helpers/media-files';
import { deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { PostComposerPage } from '../pages/PostComposerPage';

test.describe('@mutation Файлы группы', () => {
  test.skip(!env.runMutationTests, 'Сценарий создаёт временную группу и публикацию');

  test('ESN-122, ESN-126, ESN-127, ESN-128: фильтрует и открывает действия файла группы', async ({ page, context }) => {
    test.setTimeout(180_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: env.baseURL });
    const groupName = uniqueMarker('GROUP');
    const title = `${uniqueMarker('POST')}-GROUP-FILES`;
    const image: UploadFile = { name: 'qa-e2e-group-image.png', mimeType: 'image/png', buffer: await png(96, 54) };
    const audio: UploadFile = { name: 'qa-e2e-group-audio.wav', mimeType: 'audio/wav', buffer: wav() };
    const document: UploadFile = { name: 'qa-e2e-group-document.pdf', mimeType: 'application/pdf', buffer: pdf('group file') };
    let groupId: string | undefined;
    let postId: string | undefined;
    try {
      groupId = await createTemporaryGroupViaApi(page, groupName, 'Публичная группа');
      await page.goto(`/group/${groupId}`);
      const composer = new PostComposerPage(page);
      await composer.open();
      await composer.selectDestination(groupName);
      await composer.fill(title, 'Публикация для проверки файлов группы.');
      await chooseFiles(page, composer, 'Изображение', image);
      await chooseFiles(page, composer, 'Видео', await recordedWebm(page));
      await chooseFiles(page, composer, 'Аудио', audio);
      await chooseFiles(page, composer, 'Документ (Word, PDF)', document);
      const created = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/api\/post\/?(?:\?|$)/.test(response.url()),
      );
      await composer.publishNow();
      postId = ((await (await created).json()) as { id: string }).id;

      await page.goto(`/group/${groupId}`);
      await page.getByRole('button', { name: 'Файлы', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Все файлы', exact: true })).toBeVisible();
      const allFiles = page.getByText(document.name, { exact: true });
      await expect(allFiles).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(image.name, { exact: true })).toBeVisible();
      await expect(page.getByText(audio.name, { exact: true })).toBeVisible();

      await page.getByRole('button', { name: 'Документы', exact: true }).click();
      await expect(page.getByText(document.name, { exact: true })).toBeVisible();
      await expect(page.getByText(image.name, { exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Медиафайлы', exact: true }).click();
      await expect(page.getByRole('img', { name: image.name, exact: true })).toBeVisible();
      await expect(page.getByText(audio.name, { exact: true })).toBeVisible();
      await expect(page.getByText(document.name, { exact: true })).toHaveCount(0);

      await page.getByRole('button', { name: 'Все файлы', exact: true }).click();
      const row = page.getByText(document.name, { exact: true }).locator('xpath=ancestor::*[.//button][1]');
      await row.getByRole('button').last().click();
      await expect(page.getByRole('menuitem', { name: 'Скачать', exact: true })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Копировать ссылку', exact: true })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: /Посмотреть публикацию/ })).toBeVisible();

      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('menuitem', { name: 'Скачать', exact: true }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(document.name);

      await row.getByRole('button').last().click();
      await page.getByRole('menuitem', { name: 'Копировать ссылку', exact: true }).click();
      await expect(page.getByText('Ссылка скопирована', { exact: true })).toBeVisible();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toMatch(/^https:\/\//);
      const copiedResponse = await page.request.get(copied);
      expect(copiedResponse.ok()).toBe(true);
      expect(Buffer.from(await copiedResponse.body())).toEqual(document.buffer);

      await row.getByRole('button').last().click();
      await page.getByRole('menuitem', { name: /Посмотреть публикацию/ }).click();
      await expect(page).toHaveURL(new RegExp(`/post/${postId}(?:[/?#]|$)`));
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(page.getByText(document.name, { exact: true })).toBeVisible();
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });
});
