import { test, expect } from '@playwright/test';
import { env, hasMultiUserEnvironment } from '../helpers/env';
import {
  createTemporaryGroupViaApi,
  deleteTemporaryGroupViaApi,
  joinTemporaryGroupViaApi,
} from '../helpers/group-api';
import { deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { LoginPage } from '../pages/LoginPage';
import { PostComposerPage } from '../pages/PostComposerPage';

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
