import { test, expect } from '@playwright/test';
import { env, hasMultiUserEnvironment } from '../helpers/env';
import { LoginPage } from '../pages/LoginPage';
import { createTemporaryGroupViaApi, deleteTemporaryGroupViaApi, joinTemporaryGroupViaApi } from '../helpers/group-api';
import { uniqueMarker } from '../helpers/test-data';

test.describe('@multiuser Права в управляемой группе', () => {
  test.skip(
    !hasMultiUserEnvironment,
    'Нужны E2E_MEMBER_EMAIL, E2E_MEMBER_PASSWORD и E2E_MANAGED_GROUP_URL',
  );

  test('администратор и участник видят разные действия', async ({ browser }) => {
    const adminContext = await browser.newContext({
      baseURL: env.baseURL, storageState: { cookies: [], origins: [] },
    });
    const memberContext = await browser.newContext({
      baseURL: env.baseURL, storageState: { cookies: [], origins: [] },
    });

    try {
      const adminPage = await adminContext.newPage();
      await new LoginPage(adminPage).login(env.email, env.password);
      await adminPage.goto(env.managedGroupUrl);
      await expect(
        adminPage.getByRole('button', { name: 'Вы администратор', exact: true }),
      ).toBeVisible();
      await adminPage.getByRole('button', { name: 'Вы администратор', exact: true }).click();
      await expect(adminPage.getByRole('menuitem', { name: 'Пригласить' })).toBeVisible();
      await expect(adminPage.getByRole('menuitem', { name: 'Удалить группу' })).toBeVisible();

      const memberPage = await memberContext.newPage();
      await new LoginPage(memberPage).login(env.memberEmail, env.memberPassword);
      await memberPage.goto(env.managedGroupUrl);
      await expect(
        memberPage.getByRole('button', { name: /Вы подписаны|Подписаться/ }),
      ).toBeVisible();

      // «Написать» — глобальная кнопка и видна всем. Право публикации в группе
      // определяется наличием самой группы в списке назначений редактора.
      const groupName = await memberPage.getByRole('heading').first().innerText();
      await memberPage.getByRole('button', { name: 'Написать', exact: true }).click();
      const composer = memberPage.getByRole('dialog', { name: /Новая публикация/ });
      await expect(composer).toBeVisible();
      await composer.getByRole('combobox').first().click();
      const groupDestination = memberPage
        .getByRole('option', { name: groupName, exact: true })
        .filter({ visible: true });
      if (env.memberCanPublish) await expect(groupDestination).toBeVisible();
      else await expect(groupDestination).toHaveCount(0);
    } finally {
      await adminContext.close();
      await memberContext.close();
    }
  });
});

test('ESN-316: баннер могут менять только владелец и администратор @multiuser @mutation', async ({ browser }) => {
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два аккаунта и mutation-режим');
  const ownerContext = await browser.newContext({ baseURL: env.baseURL, storageState: { cookies: [], origins: [] } });
  const memberContext = await browser.newContext({ baseURL: env.baseURL, storageState: { cookies: [], origins: [] } });
  const ownerPage = await ownerContext.newPage();
  const memberPage = await memberContext.newPage();
  let groupId: string | undefined;
  try {
    await new LoginPage(ownerPage).login(env.email, env.password);
    await new LoginPage(memberPage).login(env.memberEmail, env.memberPassword);
    groupId = await createTemporaryGroupViaApi(ownerPage, uniqueMarker('GROUP'), 'Публичная группа');
    await joinTemporaryGroupViaApi(memberPage, groupId);
    const detailsResponse = await ownerPage.request.get(`https://dev-social-backend.sddt.efko.ru/api/group/${groupId}`);
    expect(detailsResponse.ok()).toBe(true);
    const details = await detailsResponse.json() as { members: Array<{ id: string; email: string }> };
    const member = details.members.find((candidate) => candidate.email.toLowerCase() === env.memberEmail.toLowerCase());
    expect(member).toBeTruthy();
    const camera = (page: typeof ownerPage) => page.locator('app-group-banner svg#camera').locator('..');

    await ownerPage.goto(`/group/${groupId}/posts`);
    await expect(camera(ownerPage)).toBeVisible();
    await memberPage.goto(`/group/${groupId}/posts`);
    await expect(camera(memberPage)).toHaveCount(0);

    const setRole = async (administrator: boolean, canPost: boolean) => {
      const response = await ownerPage.request.put(
        `https://dev-social-backend.sddt.efko.ru/api/group/${groupId}/members/${member!.id}`,
        { data: { administrator, can_post: canPost, can_comment: true } },
      );
      expect(response.ok()).toBe(true);
      await memberPage.reload();
    };
    await setRole(false, true);
    await expect(camera(memberPage)).toHaveCount(0);
    await setRole(true, true);
    await expect(camera(memberPage)).toBeVisible();
    await camera(memberPage).click();
    await expect(memberPage.getByRole('heading', { name: 'Редактор изображений группы', exact: true })).toBeVisible();
  } finally {
    await deleteTemporaryGroupViaApi(ownerPage, groupId);
    await memberContext.close();
    await ownerContext.close();
  }
});
