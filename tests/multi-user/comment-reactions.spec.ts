import { test, expect, type Browser } from '@playwright/test';
import { env, hasMultiUserEnvironment } from '../helpers/env';
import { createTemporaryCommentViaApi } from '../helpers/comment-api';
import { createTemporaryPostViaApi, deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { LoginPage } from '../pages/LoginPage';

test.describe('@multiuser @mutation Реакции на чужие комментарии', () => {
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два пользователя и mutation-режим');

  test('ESN-502: снятая реакция с чужого комментария не восстанавливается', async ({ browser }) => {
    const ownerContext = await browser.newContext({ baseURL: env.baseURL, storageState: { cookies: [], origins: [] } });
    const memberContext = await browser.newContext({ baseURL: env.baseURL, storageState: { cookies: [], origins: [] } });
    const ownerPage = await ownerContext.newPage();
    const memberPage = await memberContext.newPage();
    let postId: string | undefined;
    try {
      await new LoginPage(ownerPage).login(env.email, env.password);
      await new LoginPage(memberPage).login(env.memberEmail, env.memberPassword);
      postId = await createTemporaryPostViaApi(ownerPage, uniqueMarker('POST'));
      const comment = uniqueMarker('COMMENT');
      await createTemporaryCommentViaApi(memberPage, postId, comment);
      await ownerPage.goto(`/post/${postId}`);
      const card = ownerPage.getByRole('dialog', { name: 'Комментарии' })
        .locator('network-comment-card').filter({ hasText: comment });
      await expect(card).toBeVisible();
      const added = ownerPage.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/comment\/.*\/react(?:ion)?\/?(?:\?|$)/i.test(response.url()),
      );
      await card.getByRole('button', { name: 'Реакция', exact: true }).click();
      expect((await added).ok()).toBe(true);
      const picked = card.locator('button.comment-card__picked-reaction-btn');
      await expect(picked).toHaveAttribute('title', 'Симпатия');
      await expect(card.locator('button.reactions-summary__group').first()).toBeVisible();

      const removed = ownerPage.waitForResponse((response) =>
        ['DELETE', 'POST'].includes(response.request().method()) &&
        /\/comment\/.*\/react(?:ion)?\/?(?:\?|$)/i.test(response.url()),
      );
      await picked.click();
      expect((await removed).ok()).toBe(true);
      await expect(card.getByRole('button', { name: 'Реакция', exact: true })).toBeVisible();
      await expect(card.locator('button.reactions-summary__group')).toHaveCount(0);
      await ownerPage.reload();
      const restored = ownerPage.getByRole('dialog', { name: 'Комментарии' })
        .locator('network-comment-card').filter({ hasText: comment });
      await expect(restored).toBeVisible();
      await expect(restored.getByRole('button', { name: 'Реакция', exact: true })).toBeVisible();
      await expect(restored.locator('button.reactions-summary__group')).toHaveCount(0);
    } finally {
      await deleteTemporaryPostViaApi(ownerPage, postId);
      await memberContext.close();
      await ownerContext.close();
    }
  });

  test('ESN-503: все варианты реакции на комментарий выбираются, снимаются и сохраняются', async ({ browser }) => {
    test.fixme(true, 'Кейс в draft: в текущей панели комментария нет варианта «Не нравится» из списка 11 реакций');
    test.setTimeout(180_000);
    const ownerContext = await browser.newContext({ baseURL: env.baseURL, storageState: { cookies: [], origins: [] } });
    const memberContext = await browser.newContext({ baseURL: env.baseURL, storageState: { cookies: [], origins: [] } });
    const ownerPage = await ownerContext.newPage();
    const memberPage = await memberContext.newPage();
    let postId: string | undefined;
    try {
      await new LoginPage(ownerPage).login(env.email, env.password);
      await new LoginPage(memberPage).login(env.memberEmail, env.memberPassword);
      postId = await createTemporaryPostViaApi(ownerPage, uniqueMarker('POST'));
      const comment = uniqueMarker('COMMENT');
      await createTemporaryCommentViaApi(memberPage, postId, comment);
      await ownerPage.goto(`/post/${postId}`);
      const card = ownerPage.getByRole('dialog', { name: 'Комментарии' })
        .locator('network-comment-card').filter({ hasText: comment });
      await expect(card).toBeVisible();
      const reactions = [
        'Симпатия', 'Нравится', 'Смешно', 'Удивительно', 'Возмутительно', 'Страх',
        'Нейтральное', 'Грусть', 'Презрение', 'Отвращение', 'Не нравится',
      ];
      for (const [index, reaction] of reactions.entries()) {
        await card.getByRole('button', { name: 'Реакция', exact: true }).hover();
        const palette = ownerPage.getByRole('listbox', { name: 'Реакции' });
        await expect(palette).toBeVisible();
        const selected = ownerPage.waitForResponse((response) =>
          response.request().method() === 'POST' && /\/comment\/.*\/react(?:ion)?\/?(?:\?|$)/i.test(response.url()),
        );
        await palette.getByRole('button', { name: reaction, exact: true }).click();
        expect((await selected).ok()).toBe(true);
        const picked = card.locator('button.comment-card__picked-reaction-btn');
        await expect(picked).toHaveAttribute('title', reaction);
        if (index === reactions.length - 1) break;
        const removed = ownerPage.waitForResponse((response) =>
          ['DELETE', 'POST'].includes(response.request().method()) &&
          /\/comment\/.*\/react(?:ion)?\/?(?:\?|$)/i.test(response.url()),
        );
        await picked.click();
        expect((await removed).ok()).toBe(true);
        await expect(card.getByRole('button', { name: 'Реакция', exact: true })).toBeVisible();
        await ownerPage.mouse.move(0, 0);
      }
      await ownerPage.reload();
      const restored = ownerPage.getByRole('dialog', { name: 'Комментарии' })
        .locator('network-comment-card').filter({ hasText: comment });
      await expect(restored.locator('button.comment-card__picked-reaction-btn')).toHaveAttribute('title', reactions.at(-1)!);
    } finally {
      await deleteTemporaryPostViaApi(ownerPage, postId);
      await memberContext.close();
      await ownerContext.close();
    }
  });
});
