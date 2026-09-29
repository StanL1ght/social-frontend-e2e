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

test('ESN-134 — подписчик публикует пост в открытой группе @multiuser @mutation', async ({ browser }) => {
  test.skip(!hasMultiUserEnvironment, 'Нужны учётные данные второго пользователя');
  test.skip(!env.runMutationTests, 'Публикация разрешена только в mutation-режиме');
  test.setTimeout(120_000);

  const adminContext = await browser.newContext({ baseURL: env.baseURL });
  const memberContext = await browser.newContext({ baseURL: env.baseURL });
  const groupName = uniqueMarker('GROUP-PUBLIC');
  const postTitle = uniqueMarker('POST');
  let groupId: string | undefined;
  let postId: string | undefined;

  try {
    const adminPage = await adminContext.newPage();
    await new LoginPage(adminPage).login(env.email, env.password);
    groupId = await createTemporaryGroupViaApi(
      adminPage,
      groupName,
      'Публичная группа',
      'subscribers',
    );

    const memberPage = await memberContext.newPage();
    await new LoginPage(memberPage).login(env.memberEmail, env.memberPassword);
    await joinTemporaryGroupViaApi(memberPage, groupId);

    const groupResponse = await memberPage.request.get(
      `https://dev-social-backend.sddt.efko.ru/api/group/${groupId}`,
    );
    expect(groupResponse.ok()).toBe(true);
    const group = (await groupResponse.json()) as {
      is_member: boolean;
      is_group_admin: boolean;
      can_post: boolean;
      posting_permission: string;
    };
    expect(group).toMatchObject({
      is_member: true,
      is_group_admin: false,
      can_post: true,
      posting_permission: 'subscribers',
    });

    await memberPage.goto(`/group/${groupId}`);
    const composer = new PostComposerPage(memberPage);
    await composer.open();
    await composer.selectDestination(groupName);
    await composer.fill(postTitle, 'Публикация подписчика во временной группе.');
    const created = memberPage.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;

    await memberPage.goto(`/group/${groupId}`);
    await expect(memberPage.getByRole('heading', { name: postTitle, exact: true })).toBeVisible({
      timeout: 20_000,
    });
  } finally {
    const memberPage = memberContext.pages()[0];
    if (memberPage) await deleteTemporaryPostViaApi(memberPage, postId);
    const adminPage = adminContext.pages()[0];
    if (adminPage) await deleteTemporaryGroupViaApi(adminPage, groupId);
    await memberContext.close();
    await adminContext.close();
  }
});

test('ESN-172 — гостю группа недоступна в редакторе, а подписчику доступна @multiuser @mutation', async ({ browser }) => {
  test.skip(!hasMultiUserEnvironment, 'Нужны учётные данные второго пользователя');
  test.skip(!env.runMutationTests, 'Изменение подписки разрешено только в mutation-режиме');
  test.setTimeout(120_000);

  const adminContext = await browser.newContext({ baseURL: env.baseURL });
  const memberContext = await browser.newContext({ baseURL: env.baseURL });
  const groupName = `${uniqueMarker('GROUP-PUBLIC')}-GUEST`;
  let groupId: string | undefined;

  try {
    const adminPage = await adminContext.newPage();
    await new LoginPage(adminPage).login(env.email, env.password);
    groupId = await createTemporaryGroupViaApi(adminPage, groupName, 'Публичная группа', 'subscribers');

    const memberPage = await memberContext.newPage();
    await new LoginPage(memberPage).login(env.memberEmail, env.memberPassword);
    await memberPage.goto(`/group/${groupId}/posts`);
    await expect(memberPage.getByRole('heading', { name: groupName, exact: true })).toBeVisible();
    const subscribe = memberPage.getByRole('button', { name: 'Подписаться', exact: true });
    await expect(subscribe).toBeVisible();

    let composer = new PostComposerPage(memberPage);
    await composer.open();
    const destination = composer.dialog.getByRole('combobox').first();
    await destination.click();
    await expect(memberPage.getByRole('option').filter({ hasText: groupName })).toHaveCount(0);
    await memberPage.keyboard.press('Escape');
    await composer.discard();

    const joined = memberPage.waitForResponse((response) =>
      response.request().method() !== 'GET' &&
      response.url().includes(`/api/group/${groupId}`) &&
      !/\/feed-view(?:\?|$)/.test(response.url()),
    );
    await subscribe.click();
    expect((await joined).ok()).toBe(true);
    await expect(memberPage.getByRole('button', { name: 'Вы подписаны', exact: true })).toBeVisible();

    const accessResponse = await memberPage.request.get(
      `https://dev-social-backend.sddt.efko.ru/api/group/${groupId}`,
    );
    expect(accessResponse.ok()).toBe(true);
    expect(await accessResponse.json()).toMatchObject({ is_member: true, can_post: true });

    composer = new PostComposerPage(memberPage);
    await composer.open();
    await composer.dialog.getByRole('combobox').first().click();
    await expect(memberPage.getByRole('option').filter({ hasText: groupName })).toBeVisible();
    await memberPage.keyboard.press('Escape');
    await composer.discard();
  } finally {
    const adminPage = adminContext.pages()[0];
    if (adminPage) await deleteTemporaryGroupViaApi(adminPage, groupId);
    await memberContext.close();
    await adminContext.close();
  }
});
