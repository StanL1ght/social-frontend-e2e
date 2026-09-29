import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { createPost, deletePostIfPresent } from '../helpers/post-lifecycle';
import { uniqueMarker } from '../helpers/test-data';
import { PostComposerPage } from '../pages/PostComposerPage';
import { PostPage } from '../pages/PostPage';
import { createTemporaryGroupViaApi, deleteTemporaryGroupViaApi } from '../helpers/group-api';
import { deleteTemporaryPostViaApi } from '../helpers/post-api';
import { chooseFiles, pdf, png, recordedWebm, wav, type UploadFile } from '../helpers/media-files';

test.describe('@mutation Репост публикации', () => {
  test.skip(!env.runMutationTests, 'Для запуска установите RUN_MUTATION_TESTS=true');

  test('репостит публикацию в личную ленту и сохраняет исходник', async ({ page }) => {
    const sourceTitle = uniqueMarker('REPOST-SOURCE');
    const repostTitle = uniqueMarker('REPOST');
    let sourceUrl: string | undefined;
    let repostUrl: string | undefined;

    try {
      sourceUrl = await createPost(page, sourceTitle, 'Исходная публикация для проверки репоста.');
      await page.goto(sourceUrl);
      await new PostPage(page).openRepostComposer();

      const composer = new PostComposerPage(page);
      await composer.waitForRepost();
      await composer.selectDestination('Моя лента');
      await composer.fill(repostTitle, 'Комментарий к репосту.');
      await composer.publishNow();

      const repostHeading = page.getByRole('heading', { name: repostTitle, exact: true });
      await expect(repostHeading).toBeVisible({ timeout: 20_000 });
      const repostCard = repostHeading.locator('xpath=ancestor::*[.//a[contains(@href,"/post/")]][1]');
      await expect(repostCard.getByRole('heading', { name: sourceTitle, exact: true })).toBeVisible();

      const href = await repostCard.locator('a[href*="/post/"]').first().getAttribute('href');
      expect(href).toBeTruthy();
      repostUrl = new URL(href!, env.baseURL).toString();
    } finally {
      await deletePostIfPresent(page, repostUrl);
      await deletePostIfPresent(page, sourceUrl);
    }
  });

  test('ESN-202 — добавляет фото, видео, аудио и документ к репосту', async ({ page }) => {
    test.setTimeout(150_000);
    const sourceTitle = uniqueMarker('REPOST-SOURCE');
    const repostTitle = `${uniqueMarker('REPOST')}-ALL-MEDIA`;
    const image: UploadFile = { name: 'repost-photo.png', mimeType: 'image/png', buffer: await png(320, 180) };
    const audio: UploadFile = { name: 'repost-audio.wav', mimeType: 'audio/wav', buffer: wav() };
    const document: UploadFile = { name: 'repost-document.pdf', mimeType: 'application/pdf', buffer: pdf('REPOST DOCUMENT') };
    let sourceId: string | undefined;
    let repostId: string | undefined;

    try {
      const sourceUrl = await createPost(page, sourceTitle, 'Исходная публикация для репоста с вложениями.');
      sourceId = new URL(sourceUrl).pathname.split('/').filter(Boolean).at(-1);
      await page.goto(sourceUrl);
      await new PostPage(page).openRepostComposer();
      const composer = new PostComposerPage(page);
      await composer.waitForRepost();
      await composer.selectDestination('Моя лента');
      await composer.fill(repostTitle, 'Комментарий к репосту со всеми типами вложений.');
      const video = await recordedWebm(page);
      await chooseFiles(page, composer, 'Изображение', image);
      await expect(composer.editor.locator('img').last()).toBeVisible({ timeout: 30_000 });
      await chooseFiles(page, composer, 'Видео', video);
      await expect(composer.dialog.locator('video')).toBeAttached({ timeout: 30_000 });
      await chooseFiles(page, composer, 'Аудио', audio);
      await expect(composer.dialog.getByText(audio.name, { exact: true })).toBeVisible({ timeout: 30_000 });
      await chooseFiles(page, composer, 'Документ (Word, PDF)', document);
      await expect(composer.dialog.getByText(document.name, { exact: true })).toBeVisible({ timeout: 30_000 });

      const created = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/api\/post\/?(?:\?|$)/.test(response.url()),
      );
      await composer.publishNow();
      repostId = ((await (await created).json()) as { id: string }).id;
      await page.goto(`/post/${repostId}`);
      const card = page.getByRole('heading', { name: repostTitle, exact: true })
        .locator('xpath=ancestor::network-post-card[1]');
      await expect(card.getByRole('heading', { name: sourceTitle, exact: true })).toBeVisible();
      await expect(card.locator(`img[alt="${image.name}"]`)).toBeVisible();
      await expect(card.locator('video')).toBeAttached();
      await expect(card.locator('audio')).toBeAttached();
      await expect(card.getByText(audio.name, { exact: true })).toBeVisible();
      await expect(card.getByText(document.name, { exact: true })).toBeVisible();
    } finally {
      await deleteTemporaryPostViaApi(page, repostId);
      await deleteTemporaryPostViaApi(page, sourceId);
    }
  });

  test('ESN-213 — репостит публикацию из личной ленты во временную группу', async ({ page }) => {
    const sourceTitle = uniqueMarker('REPOST-SOURCE');
    const firstRepostTitle = `${uniqueMarker('REPOST')}-PERSONAL`;
    const groupRepostTitle = `${uniqueMarker('REPOST')}-GROUP`;
    const groupName = uniqueMarker('GROUP');
    let sourceUrl: string | undefined;
    let firstRepostUrl: string | undefined;
    let groupId: string | undefined;

    try {
      groupId = await createTemporaryGroupViaApi(page, groupName, 'Публичная группа');
      sourceUrl = await createPost(page, sourceTitle, 'Исходная публикация для репоста в группу.');
      await page.goto(sourceUrl);
      await new PostPage(page).openRepostComposer();

      const firstComposer = new PostComposerPage(page);
      await firstComposer.waitForRepost();
      await firstComposer.selectDestination('Моя лента');
      await firstComposer.fill(firstRepostTitle, 'Первый репост в личную ленту.');
      const firstCreated = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
      );
      await firstComposer.publishNow();
      const firstRepost = (await (await firstCreated).json()) as { id: string };
      firstRepostUrl = new URL(`/post/${firstRepost.id}`, env.baseURL).toString();
      const firstHeading = page.getByRole('heading', { name: firstRepostTitle, exact: true });
      await expect(firstHeading).toBeVisible({ timeout: 20_000 });

      await page.goto(firstRepostUrl);
      await new PostPage(page).openRepostComposer();
      const groupComposer = new PostComposerPage(page);
      await groupComposer.waitForRepost();
      await groupComposer.selectDestination(groupName);
      await groupComposer.fill(groupRepostTitle, 'Репост репоста во временную группу.');
      await groupComposer.publishNow();

      await page.goto(`/group/${groupId}`);
      const repost = page.getByRole('heading', { name: groupRepostTitle, exact: true });
      await expect(repost).toBeVisible({ timeout: 20_000 });
      const card = repost.locator('xpath=ancestor::*[.//a[contains(@href,"/post/")]][1]');
      await expect(card.getByRole('heading', { name: firstRepostTitle, exact: true })).toBeVisible();
      await expect(card.getByRole('heading', { name: sourceTitle, exact: true })).toBeVisible();
    } finally {
      await deleteTemporaryGroupViaApi(page, groupId);
      await deletePostIfPresent(page, firstRepostUrl);
      await deletePostIfPresent(page, sourceUrl);
    }
  });

  test('ESN-220 — сохраняет анонимного автора при репосте из группы', async ({ page }) => {
    const groupName = uniqueMarker('GROUP');
    const sourceTitle = uniqueMarker('REPOST-SOURCE');
    const repostTitle = uniqueMarker('REPOST');
    let groupId: string | undefined;
    let sourceId: string | undefined;
    let repostId: string | undefined;

    try {
      groupId = await createTemporaryGroupViaApi(page, groupName, 'Публичная группа');
      await page.goto(`/group/${groupId}`);
      const sourceComposer = new PostComposerPage(page);
      await sourceComposer.open();
      await sourceComposer.selectDestination(groupName);
      const anonymous = sourceComposer.dialog.locator('ekp-checkbox[label="Опубликовать анонимно"]');
      await anonymous.click();
      await expect(anonymous.locator('input[type="checkbox"]')).toBeChecked();
      await sourceComposer.fill(sourceTitle, 'Анонимный источник для проверки репоста.');
      const sourceCreated = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
      );
      await sourceComposer.publishNow();
      sourceId = ((await (await sourceCreated).json()) as { id: string }).id;

      await page.goto(`/post/${sourceId}`);
      await expect(page.getByText('Пост', { exact: true })).toBeVisible();
      await new PostPage(page).openRepostComposer();
      const repostComposer = new PostComposerPage(page);
      await repostComposer.waitForRepost();
      await expect(repostComposer.dialog.getByText('Пост', { exact: true })).toBeVisible();
      await repostComposer.selectDestination('Моя лента');
      await repostComposer.fill(repostTitle, 'Репост анонимной публикации.');
      const repostCreated = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
      );
      await repostComposer.publishNow();
      repostId = ((await (await repostCreated).json()) as { id: string }).id;

      await page.goto(`/post/${repostId}`);
      const sourceHeading = page.getByRole('heading', { name: sourceTitle, exact: true });
      await expect(sourceHeading).toBeVisible();
      const embeddedSource = sourceHeading.locator('xpath=ancestor::*[.//*[normalize-space(text())="Пост"]][1]');
      await expect(embeddedSource.getByText('Пост', { exact: true })).toBeVisible();
    } finally {
      await deleteTemporaryPostViaApi(page, repostId);
      await deleteTemporaryPostViaApi(page, sourceId);
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });

  test('ESN-204 — после удаления оригинала репост остаётся с сообщением об удалении', async ({ page }) => {
    const sourceTitle = uniqueMarker('REPOST-SOURCE');
    const repostTitle = uniqueMarker('REPOST');
    let sourceId: string | undefined;
    let repostId: string | undefined;

    try {
      const sourceUrl = await createPost(page, sourceTitle, 'Оригинал будет удалён после репоста.');
      sourceId = new URL(sourceUrl).pathname.split('/').filter(Boolean).at(-1);
      await page.goto(sourceUrl);
      await new PostPage(page).openRepostComposer();

      const composer = new PostComposerPage(page);
      await composer.waitForRepost();
      await composer.selectDestination('Моя лента');
      await composer.fill(repostTitle, 'Репост удаляемого оригинала.');
      const repostCreated = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
      );
      await composer.publishNow();
      repostId = ((await (await repostCreated).json()) as { id: string }).id;

      await deleteTemporaryPostViaApi(page, sourceId);
      sourceId = undefined;
      await page.goto(`/post/${repostId}`);

      await expect(page.getByRole('heading', { name: repostTitle, exact: true })).toBeVisible();
      await expect(page.getByText(/Репост поста удал[её]н|Исходн.*публикаци.*удален/i)).toBeVisible();
      await expect(page.getByRole('heading', { name: sourceTitle, exact: true })).toHaveCount(0);
    } finally {
      await deleteTemporaryPostViaApi(page, repostId);
      await deleteTemporaryPostViaApi(page, sourceId);
    }
  });
});
