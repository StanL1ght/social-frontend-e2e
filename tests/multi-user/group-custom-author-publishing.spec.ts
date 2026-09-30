import { test, expect } from '@playwright/test';
import { env, hasMultiUserEnvironment } from '../helpers/env';
import {
  createTemporaryGroupViaApi,
  deleteTemporaryGroupViaApi,
  joinTemporaryGroupViaApi,
} from '../helpers/group-api';
import { createTemporaryPostViaApi, deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { LoginPage } from '../pages/LoginPage';
import { PostComposerPage } from '../pages/PostComposerPage';
import { PostPage } from '../pages/PostPage';

const apiBase = 'https://dev-social-backend.sddt.efko.ru/api';

test('администратор публикует от имени выбранного автора группы @multiuser @mutation', async ({
  browser,
}) => {
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два пользователя и mutation-режим');
  test.setTimeout(120_000);
  const ownerContext = await browser.newContext({ baseURL: env.baseURL });
  const authorContext = await browser.newContext({ baseURL: env.baseURL });
  const groupName = uniqueMarker('GROUP');
  const title = uniqueMarker('POST');
  let groupId: string | undefined;
  let postId: string | undefined;

  try {
    const ownerPage = await ownerContext.newPage();
    const authorPage = await authorContext.newPage();
    await new LoginPage(ownerPage).login(env.email, env.password);
    await new LoginPage(authorPage).login(env.memberEmail, env.memberPassword);
    groupId = await createTemporaryGroupViaApi(ownerPage, groupName, 'Публичная группа', 'authors');
    await joinTemporaryGroupViaApi(authorPage, groupId);

    const currentResponse = await authorPage.request.get(`${apiBase}/user/current`);
    expect(currentResponse.ok()).toBe(true);
    const author = (await currentResponse.json()) as {
      id: string;
      first_name: string;
      last_name: string;
    };
    const fullName = `${author.first_name} ${author.last_name}`.trim();
    const roleResponse = await ownerPage.request.put(`${apiBase}/group/${groupId}/members/${author.id}`, {
      data: { administrator: false, can_post: true, can_comment: true },
    });
    expect(roleResponse.ok()).toBe(true);

    await ownerPage.goto(`/group/${groupId}`);
    const composer = new PostComposerPage(ownerPage);
    await composer.open();
    await composer.selectDestination(groupName);
    const authorLabel = composer.dialog.getByText('Опубликовать от имени', { exact: true });
    const authorSelector = authorLabel.locator('..').getByRole('combobox').first();
    await expect(authorSelector).toBeVisible();
    await authorSelector.click();
    const authorOption = ownerPage
      .getByRole('option')
      .filter({ hasText: new RegExp(`${author.first_name}.*${author.last_name}`, 'i'), visible: true })
      .first();
    await expect(authorOption).toBeVisible();
    await authorOption.click();
    await expect(authorSelector).toContainText(fullName);
    await composer.fill(title, 'Публикация администратора от имени выбранного автора.');

    const created = ownerPage.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;
    const card = ownerPage
      .getByRole('heading', { name: title, exact: true })
      .locator('xpath=ancestor::*[.//a[contains(@href,"/post/")]][1]');
    await expect(card).toContainText(fullName);
    await expect(card).toContainText(groupName);
  } finally {
    const ownerPage = ownerContext.pages()[0];
    if (ownerPage) {
      await deleteTemporaryPostViaApi(ownerPage, postId);
      await deleteTemporaryGroupViaApi(ownerPage, groupId);
    }
    await authorContext.close();
    await ownerContext.close();
  }
});

test('ESN-519: автор группы выбирает авторство и может публиковать анонимно @multiuser @mutation', async ({ browser }) => {
  test.fixme(true, 'Кейс в draft: у пользователя с ролью «Автор» пока отсутствует селектор «Опубликовать от имени»');
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два пользователя и mutation-режим');
  test.setTimeout(150_000);
  const ownerContext = await browser.newContext({ baseURL: env.baseURL });
  const authorContext = await browser.newContext({ baseURL: env.baseURL });
  const ownerPage = await ownerContext.newPage();
  const authorPage = await authorContext.newPage();
  const groupName = uniqueMarker('GROUP');
  let groupId: string | undefined;
  const postIds: string[] = [];
  try {
    await new LoginPage(ownerPage).login(env.email, env.password);
    await new LoginPage(authorPage).login(env.memberEmail, env.memberPassword);
    groupId = await createTemporaryGroupViaApi(ownerPage, groupName, 'Публичная группа');
    await joinTemporaryGroupViaApi(authorPage, groupId);
    const current = await authorPage.request.get(`${apiBase}/user/current`);
    expect(current.ok()).toBe(true);
    const author = await current.json() as { id: string; first_name: string; last_name: string };
    const role = await ownerPage.request.put(`${apiBase}/group/${groupId}/members/${author.id}`, {
      data: { administrator: false, can_post: true, can_comment: true },
    });
    expect(role.ok()).toBe(true);

    await authorPage.goto(`/group/${groupId}`);
    const composer = new PostComposerPage(authorPage);
    await composer.open();
    await composer.selectDestination(groupName);
    const authorLabel = composer.dialog.getByText('Опубликовать от имени', { exact: true });
    await expect(authorLabel).toBeVisible();
    const selector = authorLabel.locator('..').getByRole('combobox').first();
    await expect(selector).toBeVisible();
    await selector.click();
    const ownOption = authorPage.getByRole('option')
      .filter({ hasText: new RegExp(`${author.first_name}.*${author.last_name}`, 'i') }).first();
    await expect(ownOption).toBeVisible();
    await ownOption.click();
    const title = uniqueMarker('POST');
    await composer.fill(title, 'Публикация участника с ролью Автор.');
    const created = authorPage.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postIds.push(((await (await created).json()) as { id: string }).id);
    await authorPage.goto(`/post/${postIds.at(-1)}`);
    await expect(authorPage.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(authorPage.getByRole('link', { name: groupName, exact: true }).first()).toBeVisible();

    await authorPage.goto(`/group/${groupId}`);
    await composer.open();
    await composer.selectDestination(groupName);
    const anonymous = composer.dialog.locator('ekp-checkbox[label="Опубликовать анонимно"]');
    await anonymous.click();
    await expect(authorLabel).toBeHidden();
    const anonymousTitle = `${uniqueMarker('POST')}-ANON`;
    await composer.fill(anonymousTitle, 'Анонимная публикация автора группы.');
    const anonymousPost = authorPage.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postIds.push(((await (await anonymousPost).json()) as { id: string }).id);
    await authorPage.goto(`/post/${postIds.at(-1)}`);
    await expect(authorPage.getByRole('heading', { name: anonymousTitle, exact: true })).toBeVisible();
    await expect(authorPage.getByText('Пост', { exact: true }).first()).toBeVisible();
  } finally {
    for (const id of postIds) await deleteTemporaryPostViaApi(ownerPage, id);
    await deleteTemporaryGroupViaApi(ownerPage, groupId);
    await authorContext.close();
    await ownerContext.close();
  }
});

test('ESN-522: администратор меняет автора публикации без изменения группы и текста @multiuser @mutation', async ({ browser }) => {
  test.fail(true, 'После сохранения ссылка автора указывает на выбранного пользователя, но видимое имя остаётся прежним');
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два пользователя и mutation-режим');
  test.setTimeout(120_000);
  const ownerContext = await browser.newContext({ baseURL: env.baseURL });
  const authorContext = await browser.newContext({ baseURL: env.baseURL });
  const ownerPage = await ownerContext.newPage();
  const authorPage = await authorContext.newPage();
  const groupName = uniqueMarker('GROUP');
  const title = uniqueMarker('POST');
  let groupId: string | undefined;
  let postId: string | undefined;
  try {
    await new LoginPage(ownerPage).login(env.email, env.password);
    await new LoginPage(authorPage).login(env.memberEmail, env.memberPassword);
    groupId = await createTemporaryGroupViaApi(ownerPage, groupName, 'Публичная группа');
    await joinTemporaryGroupViaApi(authorPage, groupId);
    const current = await authorPage.request.get(`${apiBase}/user/current`);
    expect(current.ok()).toBe(true);
    const newAuthor = await current.json() as { id: string; first_name: string; last_name: string };
    const role = await ownerPage.request.put(`${apiBase}/group/${groupId}/members/${newAuthor.id}`, {
      data: { administrator: false, can_post: true, can_comment: true },
    });
    expect(role.ok()).toBe(true);
    postId = await createTemporaryPostViaApi(ownerPage, title, groupId);

    await ownerPage.goto(`/post/${postId}`);
    await new PostPage(ownerPage).openEditor();
    const composer = new PostComposerPage(ownerPage);
    await expect(composer.dialog).toBeVisible();
    await expect(composer.titleBlock).toHaveText(title);
    const authorLabel = composer.dialog.getByText('Опубликовать от имени', { exact: true });
    const selector = authorLabel.locator('..').getByRole('combobox').first();
    await expect(selector).toBeVisible();
    await selector.click();
    const option = ownerPage.getByRole('option')
      .filter({ hasText: new RegExp(`${newAuthor.first_name}.*${newAuthor.last_name}`, 'i') }).first();
    await expect(option).toBeVisible();
    await option.click();
    await expect(selector).toContainText(newAuthor.first_name);
    await composer.saveChanges();

    await ownerPage.goto(`/post/${postId}`);
    await expect(ownerPage.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(ownerPage.getByText('Временная публикация для E2E-проверки.', { exact: true })).toBeVisible();
    await expect(ownerPage.getByRole('link', { name: groupName, exact: true }).first()).toBeVisible();
    const profile = ownerPage.locator(`a[href="/profile/${newAuthor.id}"]`).filter({ visible: true }).first();
    await expect(profile).toBeVisible();
    await expect(profile).toContainText(newAuthor.first_name);
  } finally {
    await deleteTemporaryPostViaApi(ownerPage, postId);
    await deleteTemporaryGroupViaApi(ownerPage, groupId);
    await authorContext.close();
    await ownerContext.close();
  }
});
