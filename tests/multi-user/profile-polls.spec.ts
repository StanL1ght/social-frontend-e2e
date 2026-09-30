import { test, expect } from '@playwright/test';
import { env, hasMultiUserEnvironment } from '../helpers/env';
import { deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { LoginPage } from '../pages/LoginPage';
import { PostComposerPage } from '../pages/PostComposerPage';

test('ESN-514: собственный опрос виден в профиле и открывает ту же публикацию @multiuser @mutation', async ({ browser }) => {
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два пользователя и mutation-режим');
  test.setTimeout(120_000);
  const ownerContext = await browser.newContext({ baseURL: env.baseURL });
  const voterContext = await browser.newContext({ baseURL: env.baseURL });
  const ownerPage = await ownerContext.newPage();
  const voterPage = await voterContext.newPage();
  const title = `${uniqueMarker('POST')}-PROFILE-POLL`;
  const questionText = 'Вопрос профиля для E2E';
  const answerText = 'Первый ответ профиля';
  let postId: string | undefined;
  try {
    await new LoginPage(ownerPage).login(env.email, env.password);
    await new LoginPage(voterPage).login(env.memberEmail, env.memberPassword);
    await ownerPage.goto('/feed');
    const composer = new PostComposerPage(ownerPage);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.fill(title, 'Опрос для вкладки личного профиля.');
    await composer.editor.locator('p').last().click();
    await composer.dialog.getByRole('button', { name: 'Опрос', exact: true }).click();
    const question = composer.dialog.getByRole('treeitem').first();
    await question.getByRole('textbox', { name: 'Ваш вопрос' }).fill(questionText);
    await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(0).fill(answerText);
    await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(1).fill('Другой ответ профиля');
    const created = ownerPage.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;

    await voterPage.goto(`/post/${postId}`);
    const voted = voterPage.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/[^/]+\/polls\/[^/]+\/questions\/[^/]+\/answers\//.test(response.url()),
    );
    await voterPage.getByText(answerText, { exact: true }).click();
    expect((await voted).ok()).toBe(true);

    const current = await ownerPage.request.get('https://dev-social-backend.sddt.efko.ru/api/user/current');
    expect(current.ok()).toBe(true);
    const owner = await current.json() as { id: string };
    await ownerPage.goto(`/profile/${owner.id}`);
    await ownerPage.getByRole('button', { name: 'Опросы', exact: true }).click();
    const titleInProfile = ownerPage.getByText(title, { exact: false }).first();
    await expect(titleInProfile).toBeVisible();
    await expect(ownerPage.getByRole('button', { name: '1', exact: true })).toBeVisible();
    await titleInProfile.click();
    await expect(ownerPage).toHaveURL(new RegExp(`/post/${postId}`));
    await expect(ownerPage.getByText(questionText, { exact: true })).toBeVisible();
    await expect(ownerPage.getByText(answerText, { exact: true })).toBeVisible();
  } finally {
    await deleteTemporaryPostViaApi(ownerPage, postId);
    await voterContext.close();
    await ownerContext.close();
  }
});
