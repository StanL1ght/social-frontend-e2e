import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { createPost, deletePostIfPresent } from '../helpers/post-lifecycle';
import { uniqueMarker } from '../helpers/test-data';
import { PostPage } from '../pages/PostPage';
import { createTemporaryCommentViaApi } from '../helpers/comment-api';
import { createTemporaryPostViaApi, deleteTemporaryPostViaApi } from '../helpers/post-api';
import { PostComposerPage } from '../pages/PostComposerPage';

test.describe('@mutation Реакции и счётчики публикации', () => {
  test.skip(!env.runMutationTests, 'Для запуска установите RUN_MUTATION_TESTS=true');

  test('ESN-62: реакция попадает в список пользователей с фильтром по типу', async ({ page }) => {
    const title = uniqueMarker('POST');
    let postUrl: string | undefined;

    try {
      postUrl = await createPost(page, title, 'Проверка списка реакций.');
      await page.goto(postUrl);
      await new PostPage(page).addLike();

      const reactionUsers = page.getByRole('button', { name: /Симпатия/ }).first();
      await expect(reactionUsers).toBeVisible({ timeout: 20_000 });
      await reactionUsers.click();
      const dialog = page.getByRole('dialog', { name: /Реакции/ });
      await expect(dialog).toBeVisible();
      const all = dialog.getByRole('button', { name: /Все/ }).first();
      const typed = dialog.getByRole('button', { name: '1', exact: true });
      const reactedUser = dialog.locator('a[href*="/profile/"]').first();
      await expect(all).toBeVisible();
      await expect(typed).toBeVisible();
      await expect(typed).toHaveClass(/people-view-panel__tab--active/);
      await expect(reactedUser).toBeVisible();

      await all.click();
      await expect(all).toHaveClass(/people-view-panel__tab--active/);
      await expect(typed).not.toHaveClass(/people-view-panel__tab--active/);
      await expect(reactedUser).toBeVisible();

      await typed.click();
      await expect(typed).toHaveClass(/people-view-panel__tab--active/);
      await expect(all).not.toHaveClass(/people-view-panel__tab--active/);
      await expect(reactedUser).toBeVisible();
    } finally {
      await deletePostIfPresent(page, postUrl);
    }
  });

  test('ESN-63: все варианты реакций выбираются и отменяются', async ({ page }) => {
    test.setTimeout(180_000);
    const title = uniqueMarker('POST');
    let postUrl: string | undefined;
    const reactions = [
      'Симпатия', 'Нравится', 'Не нравится', 'Смешно', 'Удивительно', 'Возмутительно',
      'Страх', 'Нейтральное', 'Грусть', 'Презрение', 'Отвращение',
    ];

    try {
      postUrl = await createPost(page, title, 'Проверка всех реакций и их отмены.');
      await page.goto(postUrl);
      for (const reaction of reactions) {
        const like = page.locator('button.s-post-card-reaction-btn');
        await expect(like).toHaveAttribute('title', 'Нравится');
        await like.hover();
        const palette = page.getByRole('listbox', { name: 'Реакции' });
        await expect(palette).toBeVisible();
        const option = palette.getByRole('button', { name: reaction, exact: true });
        await expect(option).toBeVisible();
        const selected = page.waitForResponse((response) =>
          response.request().method() === 'POST' && /\/post\/.*\/react\/?(?:\?|$)/i.test(response.url()),
        );
        await option.click();
        expect((await selected).ok()).toBe(true);
        const active = page.locator('button.s-post-card-reaction-btn');
        await expect(active).toHaveAttribute('title', reaction);
        const removed = page.waitForResponse((response) =>
          ['DELETE', 'POST'].includes(response.request().method()) && /\/post\/.*\/react\/?(?:\?|$)/i.test(response.url()),
        );
        await active.click();
        expect((await removed).ok()).toBe(true);
        await page.mouse.move(0, 0);
        await expect(active).toHaveAttribute('title', 'Нравится');
      }
    } finally {
      await deletePostIfPresent(page, postUrl);
    }
  });

  test('ESN-501: снятая реакция с публикации не восстанавливается после обновления', async ({ page }) => {
    const title = uniqueMarker('POST');
    let postUrl: string | undefined;
    try {
      postUrl = await createPost(page, title, 'Проверка снятия реакции с публикации.');
      await page.goto(postUrl);
      const reaction = page.locator('button.s-post-card-reaction-btn');
      await expect(reaction).toHaveAttribute('title', 'Нравится');
      const added = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/post\/.*\/react\/?(?:\?|$)/i.test(response.url()),
      );
      await reaction.click();
      expect((await added).ok()).toBe(true);
      await expect(reaction).toHaveAttribute('title', 'Симпатия');
      const users = page.getByRole('button', { name: /Симпатия/ }).first();
      await expect(users).toBeVisible();
      await users.click();
      await expect(page.getByRole('dialog', { name: /Реакции/ }).locator('a[href*="/profile/"]').first()).toBeVisible();
      await page.keyboard.press('Escape');

      const removed = page.waitForResponse((response) =>
        ['DELETE', 'POST'].includes(response.request().method()) && /\/post\/.*\/react\/?(?:\?|$)/i.test(response.url()),
      );
      await reaction.click();
      expect((await removed).ok()).toBe(true);
      await expect(reaction).toHaveAttribute('title', 'Нравится');
      await page.reload();
      await expect(reaction).toHaveAttribute('title', 'Нравится');
      await expect(page.getByRole('button', { name: /Симпатия/ })).toHaveCount(0);
    } finally {
      await deletePostIfPresent(page, postUrl);
    }
  });

  test('ESN-61, ESN-64: реакции к комментариям трёх постов и список отреагировавших', async ({ page }) => {
    test.setTimeout(120_000);
    const postUrls: string[] = [];
    try {
      for (let index = 0; index < 3; index += 1) {
        const postUrl = await createPost(page, `${uniqueMarker('POST')}-REACTION-${index + 1}`, 'Проверка реакции к комментарию.');
        postUrls.push(postUrl);
        await page.goto(postUrl);
        const comment = `${uniqueMarker('COMMENT')}-${index + 1}`;
        await new PostPage(page).addComment(comment);
        const comments = page.getByRole('dialog', { name: 'Комментарии' });
        const card = comments.locator('network-comment-card').filter({ hasText: comment });
        const reacted = page.waitForResponse((response) =>
          response.request().method() === 'POST' && /\/comment\/.*\/react(?:ion)?\/?(?:\?|$)/i.test(response.url()),
        );
        await card.getByRole('button', { name: 'Реакция', exact: true }).click();
        expect((await reacted).ok()).toBe(true);
        await expect(card.locator('button.comment-card__picked-reaction-btn')).toHaveAttribute('title', 'Симпатия');

        if (index === 0) {
          const reactedUsers = card.locator('button.reactions-summary__group').first();
          await expect(reactedUsers).toHaveAttribute('aria-label', 'Симпатия');
          await reactedUsers.click();
          const reactionsDialog = page.getByRole('dialog', { name: /Реакции/ }).last();
          await expect(reactionsDialog).toBeVisible();
          await expect(reactionsDialog.getByRole('button', { name: /Все/ }).first()).toBeVisible();
        }
      }
    } finally {
      for (const postUrl of postUrls) await deletePostIfPresent(page, postUrl);
    }
  });

  test('ESN-409: счётчики открывают комментарии, репосты, просмотры и реакции', async ({ page }) => {
    test.fail(true, 'Dev показывает счётчик репостов, но окно «Репосты» остаётся в бесконечной загрузке и не выводит пользователя');
    const sourceTitle = `${uniqueMarker('POST')}-METRICS`;
    const repostTitle = `${uniqueMarker('REPOST')}-METRICS`;
    let sourceId: string | undefined;
    let repostId: string | undefined;
    try {
      sourceId = await createTemporaryPostViaApi(page, sourceTitle);
      await createTemporaryCommentViaApi(page, sourceId, `${uniqueMarker('COMMENT')}-METRICS`);
      await page.goto(`/post/${sourceId}`);
      await new PostPage(page).addLike();

      await new PostPage(page).openRepostComposer();
      const composer = new PostComposerPage(page);
      await composer.waitForRepost();
      await composer.selectDestination('Моя лента');
      await composer.fill(repostTitle, 'Репост для проверки числовых счётчиков публикации.');
      const reposted = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
      );
      await composer.publishNow();
      repostId = ((await (await reposted).json()) as { id: string }).id;

      await page.goto(`/post/${sourceId}`);
      const comments = page.locator('[title="Комментарии"]').first();
      const shared = page.locator('[title="Репосты"]').first();
      const viewed = page.locator('[title="Просмотры"]').first();
      await expect(comments).toContainText('1');
      await comments.click();
      await expect(page.getByRole('dialog', { name: 'Комментарии' })).toBeVisible();

      await expect(shared).toContainText('1');
      await shared.click();
      const sharedDialog = page.getByRole('dialog', { name: /Репосты/ });
      await expect(sharedDialog).toBeVisible();
      await expect(sharedDialog.locator('a[href*="/profile/"]').first()).toBeVisible();
      await page.keyboard.press('Escape');

      await expect(viewed).toContainText(/\d+/);
      await viewed.click();
      const viewedDialog = page.getByRole('dialog', { name: /Просмотры/ });
      await expect(viewedDialog).toBeVisible();
      await expect(viewedDialog.locator('a[href*="/profile/"]').first()).toBeVisible();
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: /Симпатия/ }).first().click();
      await expect(page.getByRole('dialog', { name: /Реакции/ })).toBeVisible();
    } finally {
      await deleteTemporaryPostViaApi(page, repostId);
      await deleteTemporaryPostViaApi(page, sourceId);
    }
  });

});
