import { test, expect } from '@playwright/test';
import { env, hasMultiUserEnvironment } from '../helpers/env';
import { uniqueMarker } from '../helpers/test-data';
import { LoginPage } from '../pages/LoginPage';
import { PostPage } from '../pages/PostPage';
import { createTemporaryGroupViaApi, deleteTemporaryGroupViaApi } from '../helpers/group-api';
import { createTemporaryPostViaApi, deleteTemporaryPostViaApi } from '../helpers/post-api';
import { createTemporaryCommentViaApi } from '../helpers/comment-api';
import { GroupsPage } from '../pages/GroupsPage';

test.describe('@multiuser @mutation Публикации профиля и ответы другому пользователю', () => {
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два аккаунта и mutation-режим');

  test('ESN-67: отвечает на комментарий другого пользователя', async ({ browser }) => {
    const ownerContext = await browser.newContext({ baseURL: env.baseURL });
    const memberContext = await browser.newContext({ baseURL: env.baseURL });
    const ownerPage = await ownerContext.newPage();
    const memberPage = await memberContext.newPage();
    const postTitle = uniqueMarker('POST');
    const foreignComment = uniqueMarker('COMMENT');
    const reply = uniqueMarker('REPLY');
    let postId: string | undefined;

    try {
      await new LoginPage(ownerPage).login(env.email, env.password);
      await new LoginPage(memberPage).login(env.memberEmail, env.memberPassword);
      postId = await createTemporaryPostViaApi(ownerPage, postTitle);
      await createTemporaryCommentViaApi(memberPage, postId, foreignComment);

      await ownerPage.goto(`/post/${postId}`);
      const comments = new PostPage(ownerPage).commentsDialog();
      const original = comments.locator('network-comment-card').filter({ hasText: foreignComment }).first();
      await expect(original).toBeVisible();
      const foreignAuthor = (await original.locator('a[href*="/profile/"]').first().innerText()).trim();
      expect(foreignAuthor).not.toBe('');

      await new PostPage(ownerPage).replyToComment(foreignComment, reply);
      // Ответ визуально связан с исходным комментарием, но компонент размещает его
      // рядом с карточкой, поэтому проверяем пользовательский текст внутри диалога.
      await expect(comments.getByText(new RegExp(reply))).toBeVisible();
      await expect(comments.getByText(new RegExp(`^${foreignAuthor.split(' ')[0]},`))).toBeVisible();
      await ownerPage.reload();
      const restoredComments = ownerPage.getByRole('dialog', { name: 'Комментарии' });
      await expect(restoredComments.getByText(new RegExp(reply))).toBeVisible({ timeout: 20_000 });
      await expect(restoredComments.getByText(new RegExp(`^${foreignAuthor.split(' ')[0]},`))).toBeVisible();
    } finally {
      await deleteTemporaryPostViaApi(ownerPage, postId);
      await memberContext.close();
      await ownerContext.close();
    }
  });

  test('ESN-87: профиль показывает личную и групповую публикации пользователя', async ({ browser }) => {
    const viewerContext = await browser.newContext({ baseURL: env.baseURL });
    const authorContext = await browser.newContext({ baseURL: env.baseURL });
    const viewerPage = await viewerContext.newPage();
    const authorPage = await authorContext.newPage();
    const personalTitle = `${uniqueMarker('POST')}-PERSONAL`;
    const groupTitle = `${uniqueMarker('POST')}-GROUP`;
    const groupName = uniqueMarker('GROUP');
    let personalId: string | undefined;
    let groupPostId: string | undefined;
    let groupId: string | undefined;

    try {
      await new LoginPage(viewerPage).login(env.email, env.password);
      await new LoginPage(authorPage).login(env.memberEmail, env.memberPassword);
      const currentResponse = await authorPage.request.get('https://dev-social-backend.sddt.efko.ru/api/user/current');
      expect(currentResponse.ok()).toBe(true);
      const author = (await currentResponse.json()) as { id: string };

      personalId = await createTemporaryPostViaApi(authorPage, personalTitle);
      groupId = await createTemporaryGroupViaApi(authorPage, groupName, 'Публичная группа');
      groupPostId = await createTemporaryPostViaApi(authorPage, groupTitle, groupId);

      await viewerPage.goto(`/profile/${author.id}`);
      const publications = viewerPage.getByRole('button', { name: 'Публикации', exact: true });
      await expect(publications).toHaveClass(/s-active-link/);
      await expect(viewerPage.getByRole('heading', { name: personalTitle, exact: true })).toBeVisible({ timeout: 20_000 });
      const groupPost = viewerPage.getByRole('heading', { name: groupTitle, exact: true });
      await expect(groupPost).toBeVisible({ timeout: 20_000 });
      const card = groupPost.locator('xpath=ancestor::network-post-card[1]');
      await expect(card.getByRole('link', { name: groupName, exact: true })).toBeVisible();
    } finally {
      await deleteTemporaryPostViaApi(authorPage, groupPostId);
      await deleteTemporaryPostViaApi(authorPage, personalId);
      await deleteTemporaryGroupViaApi(authorPage, groupId);
      await authorContext.close();
      await viewerContext.close();
    }
  });

  test('ESN-341: общая скрытая группа видна во вкладке «Группы» другого пользователя @multiuser', async ({ browser }) => {
    const viewerContext = await browser.newContext({ baseURL: env.baseURL });
    const authorContext = await browser.newContext({ baseURL: env.baseURL });
    let groupId: string | undefined;
    try {
      const viewerPage = await viewerContext.newPage();
      const authorPage = await authorContext.newPage();
      await new LoginPage(viewerPage).login(env.email, env.password);
      await new LoginPage(authorPage).login(env.memberEmail, env.memberPassword);
      const current = await authorPage.request.get('https://dev-social-backend.sddt.efko.ru/api/user/current');
      expect(current.ok()).toBe(true);
      const author = await current.json() as { id: string; first_name: string };

      const groupName = `${uniqueMarker('GROUP')}-PROFILE-HIDDEN`;
      const groups = new GroupsPage(viewerPage);
      await groups.open();
      const created = viewerPage.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/api\/group\/?(?:\?|$)/.test(response.url()),
      );
      await groups.createGroup(groupName, 'Общая скрытая группа для профиля.', 'Скрытая группа');
      groupId = ((await (await created).json()) as { id: string }).id;

      await viewerPage.goto(`/group/${groupId}`);
      await viewerPage.getByRole('button', { name: 'Вы администратор', exact: true }).click();
      await viewerPage.getByRole('menuitem', { name: 'Пригласить', exact: true }).click();
      const invite = viewerPage.getByRole('dialog').filter({ hasText: /Приглас/ }).last();
      await invite.getByRole('textbox', { name: 'Поиск по ФИО' }).fill(author.first_name);
      const authorLink = invite.locator(`a[href="/profile/${author.id}"]`).last();
      await expect(authorLink).toBeVisible({ timeout: 20_000 });
      const profileHrefs = await invite.locator('a[href^="/profile/"]').evaluateAll((links) =>
        [...new Set(links.map((link) => link.getAttribute('href')).filter(Boolean))],
      );
      const candidateIndex = profileHrefs.indexOf(`/profile/${author.id}`);
      expect(candidateIndex).toBeGreaterThanOrEqual(0);
      const invited = viewerPage.waitForResponse((response) =>
        response.request().method() !== 'GET' && response.url().includes(`/api/group/${groupId}`) && /member|invite/i.test(response.url()),
      );
      await invite.getByRole('button', { name: 'Пригласить', exact: true }).nth(candidateIndex).click();
      expect((await invited).ok()).toBe(true);

      await viewerPage.goto(`/profile/${author.id}`);
      const publications = viewerPage.getByRole('button', { name: 'Публикации', exact: true });
      await expect(publications).toBeVisible();
      const profileGroups = publications.locator('..').getByRole('button', { name: 'Группы', exact: true });
      await expect(profileGroups).toBeVisible();
      await profileGroups.click();
      await expect(profileGroups).toHaveClass(/s-active-link/);
      await expect(viewerPage.getByText(groupName, { exact: true })).toBeVisible({ timeout: 20_000 });
    } finally {
      const viewerPage = viewerContext.pages()[0];
      if (viewerPage) await deleteTemporaryGroupViaApi(viewerPage, groupId);
      await authorContext.close();
      await viewerContext.close();
    }
  });
});
