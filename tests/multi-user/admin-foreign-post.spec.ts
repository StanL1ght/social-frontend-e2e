import { test, expect } from '@playwright/test';
import { env, hasMultiUserEnvironment } from '../helpers/env';
import { uniqueMarker } from '../helpers/test-data';
import { createTemporaryGroupViaApi, deleteTemporaryGroupViaApi, joinTemporaryGroupViaApi } from '../helpers/group-api';
import { createTemporaryPostViaApi, deleteTemporaryPostViaApi } from '../helpers/post-api';
import { LoginPage } from '../pages/LoginPage';
import { PostPage } from '../pages/PostPage';
import { PostComposerPage } from '../pages/PostComposerPage';
import { clickAndWaitForMutation } from '../helpers/ui-sync';
import { createTemporaryCommentViaApi } from '../helpers/comment-api';

test('ESN-131, ESN-132, ESN-365: администратор изменяет и удаляет чужой контент группы @multiuser @mutation', async ({ browser }) => {
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два аккаунта и mutation-режим');
  test.setTimeout(150_000);
  const adminContext = await browser.newContext({ baseURL: env.baseURL, storageState: { cookies: [], origins: [] } });
  const memberContext = await browser.newContext({ baseURL: env.baseURL, storageState: { cookies: [], origins: [] } });
  const adminPage = await adminContext.newPage();
  const memberPage = await memberContext.newPage();
  let groupId: string | undefined;
  let postId: string | undefined;
  let deleted = false;
  const originalTitle = uniqueMarker('POST');
  const editedTitle = `${originalTitle}-EDITED`;
  const originalComment = uniqueMarker('COMMENT');
  const editedComment = `${originalComment}-EDITED`;

  try {
    await new LoginPage(adminPage).login(env.email, env.password);
    await new LoginPage(memberPage).login(env.memberEmail, env.memberPassword);
    groupId = await createTemporaryGroupViaApi(adminPage, uniqueMarker('GROUP'), 'Публичная группа', 'subscribers');
    await joinTemporaryGroupViaApi(memberPage, groupId);
    postId = await createTemporaryPostViaApi(memberPage, originalTitle, groupId);
    await createTemporaryCommentViaApi(memberPage, postId, originalComment);

    await adminPage.goto(`/post/${postId}`);
    await expect(adminPage.getByRole('heading', { name: originalTitle, exact: true })).toBeVisible();
    const post = new PostPage(adminPage);
    const originalCard = post.commentsDialog().locator('network-comment-card').filter({ hasText: originalComment });
    await expect(originalCard).toBeVisible();
    const originalTimestamp = (await originalCard.innerText()).match(/\d{1,2}\s+[а-яё]+\.?,\s+\d{1,2}:\d{2}/i)?.[0];
    expect(originalTimestamp).toBeTruthy();
    await post.editComment(originalComment, editedComment);
    const editedCard = post.commentsDialog().locator('network-comment-card').filter({ hasText: editedComment });
    await expect(editedCard).toContainText(originalTimestamp!);
    await post.deleteComment(editedComment);

    await post.openActions();
    for (const action of [
      /Прикрепить пост/, /Репост/, /Копировать ссылку/, /Редактировать(?: пост)?/, /Скрыть/, /Удалить пост/,
    ]) {
      await expect(adminPage.getByRole('menuitem', { name: action })).toBeVisible();
    }
    await adminPage.keyboard.press('Escape');
    await post.openEditor();
    const composer = new PostComposerPage(adminPage);
    await composer.replaceTitle(editedTitle);
    await composer.saveChanges();
    await adminPage.goto(`/post/${postId}`);
    await expect(adminPage.getByRole('heading', { name: editedTitle, exact: true })).toBeVisible();

    await post.openActions();
    await adminPage.getByRole('menuitem', { name: 'Удалить пост', exact: true }).click();
    await clickAndWaitForMutation(
      adminPage,
      adminPage.getByRole('menuitem', { name: /Удаляем\?|Удалить пост/ }),
      /\/api\/post\/[^/]+(?:\?|$)/i,
    );
    deleted = true;
    await adminPage.goto(`/group/${groupId}/posts`);
    await expect(adminPage.getByRole('heading', { name: editedTitle, exact: true })).toHaveCount(0);
    await adminPage.goto('/feed');
    await expect(adminPage.getByRole('heading', { name: editedTitle, exact: true })).toHaveCount(0);
  } finally {
    if (!deleted) await deleteTemporaryPostViaApi(memberPage, postId);
    await deleteTemporaryGroupViaApi(adminPage, groupId);
    await memberContext.close();
    await adminContext.close();
  }
});

test('ESN-130: администратор добавляет вложение при редактировании чужого поста @multiuser @mutation', async ({ browser }) => {
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два аккаунта и mutation-режим');
  test.setTimeout(120_000);
  const adminContext = await browser.newContext({ baseURL: env.baseURL, storageState: { cookies: [], origins: [] } });
  const memberContext = await browser.newContext({ baseURL: env.baseURL, storageState: { cookies: [], origins: [] } });
  const adminPage = await adminContext.newPage();
  const memberPage = await memberContext.newPage();
  const title = uniqueMarker('POST');
  const attachmentName = 'qa-e2e-admin-edit.pdf';
  let groupId: string | undefined;
  let postId: string | undefined;
  try {
    await new LoginPage(adminPage).login(env.email, env.password);
    await new LoginPage(memberPage).login(env.memberEmail, env.memberPassword);
    groupId = await createTemporaryGroupViaApi(adminPage, uniqueMarker('GROUP'), 'Публичная группа', 'subscribers');
    await joinTemporaryGroupViaApi(memberPage, groupId);
    postId = await createTemporaryPostViaApi(memberPage, title, groupId);
    await adminPage.goto(`/post/${postId}`);
    await new PostPage(adminPage).openEditor();
    const composer = new PostComposerPage(adminPage);
    await composer.editor.locator('p').last().click();
    const documentButton = composer.dialog.getByRole('button', { name: 'Документ (Word, PDF)', exact: true });
    await expect(documentButton).toBeEnabled();
    const chooserPromise = adminPage.waitForEvent('filechooser');
    await documentButton.click();
    await (await chooserPromise).setFiles({
      name: attachmentName,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'),
    });
    await expect(composer.dialog.getByText(attachmentName, { exact: true })).toBeVisible({ timeout: 20_000 });
    await composer.saveChanges();
    await adminPage.goto(`/post/${postId}`);
    await expect(adminPage.getByText(attachmentName, { exact: true })).toBeVisible();
  } finally {
    await deleteTemporaryPostViaApi(adminPage, postId);
    await deleteTemporaryGroupViaApi(adminPage, groupId);
    await memberContext.close();
    await adminContext.close();
  }
});

test('ESN-132: чужой пост исчезает со страницы группы после удаления администратором @multiuser @mutation', async ({ browser }) => {
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два аккаунта и mutation-режим');
  test.setTimeout(120_000);
  const adminContext = await browser.newContext({ baseURL: env.baseURL, storageState: { cookies: [], origins: [] } });
  const memberContext = await browser.newContext({ baseURL: env.baseURL, storageState: { cookies: [], origins: [] } });
  const adminPage = await adminContext.newPage();
  const memberPage = await memberContext.newPage();
  const title = `${uniqueMarker('POST')}-ADMIN-DELETE`;
  let groupId: string | undefined;
  let postId: string | undefined;
  let deleted = false;
  try {
    await new LoginPage(adminPage).login(env.email, env.password);
    await new LoginPage(memberPage).login(env.memberEmail, env.memberPassword);
    groupId = await createTemporaryGroupViaApi(adminPage, uniqueMarker('GROUP'), 'Публичная группа', 'subscribers');
    await joinTemporaryGroupViaApi(memberPage, groupId);
    postId = await createTemporaryPostViaApi(memberPage, title, groupId);
    await adminPage.goto(`/group/${groupId}/posts`);
    await expect(adminPage.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: 20_000 });
    await adminPage.goto(`/post/${postId}`);
    await new PostPage(adminPage).deleteThroughUi(new RegExp(`/group/${groupId}/posts`));
    deleted = true;
    await adminPage.goto(`/group/${groupId}/posts`);
    await expect(adminPage.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
  } finally {
    if (!deleted) await deleteTemporaryPostViaApi(memberPage, postId);
    await deleteTemporaryGroupViaApi(adminPage, groupId);
    await memberContext.close();
    await adminContext.close();
  }
});
