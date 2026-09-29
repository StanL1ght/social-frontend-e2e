import { test, expect } from '@playwright/test';
import { env, hasMultiUserEnvironment } from '../helpers/env';
import {
  createTemporaryGroupViaApi,
  deleteTemporaryGroupViaApi,
  joinTemporaryGroupViaApi,
} from '../helpers/group-api';
import { uniqueMarker } from '../helpers/test-data';
import { LoginPage } from '../pages/LoginPage';

test('ESN-152, ESN-157 — посторонний и подписчик не могут приглашать в группу @multiuser @mutation', async ({ browser }) => {
  test.skip(!hasMultiUserEnvironment, 'Нужны два тестовых пользователя');
  test.skip(!env.runMutationTests, 'Временная группа создаётся только в mutation-режиме');
  test.setTimeout(120_000);

  const ownerContext = await browser.newContext({ baseURL: env.baseURL });
  const memberContext = await browser.newContext({ baseURL: env.baseURL });
  let groupId: string | undefined;

  try {
    const ownerPage = await ownerContext.newPage();
    await new LoginPage(ownerPage).login(env.email, env.password);
    const groupName = uniqueMarker('GROUP-PUBLIC');
    groupId = await createTemporaryGroupViaApi(ownerPage, groupName, 'Публичная группа');

    const memberPage = await memberContext.newPage();
    await new LoginPage(memberPage).login(env.memberEmail, env.memberPassword);
    await memberPage.goto(`/group/${groupId}`);
    await expect(memberPage.getByRole('heading', { name: groupName, exact: true })).toBeVisible();
    await expect(memberPage.getByRole('button', { name: /Пригласить|Добавить/ })).toHaveCount(0);
    await expect(memberPage.getByRole('menuitem', { name: /Пригласить|Добавить/ })).toHaveCount(0);

    await joinTemporaryGroupViaApi(memberPage, groupId);
    await memberPage.reload();
    const subscribed = memberPage.getByRole('button', { name: 'Вы подписаны', exact: true });
    await expect(subscribed).toBeVisible();
    await expect(memberPage.getByRole('button', { name: /Пригласить|Добавить/ })).toHaveCount(0);
    await subscribed.click();
    await expect(memberPage.getByRole('menuitem', { name: /Пригласить|Добавить/ })).toHaveCount(0);
  } finally {
    const ownerPage = ownerContext.pages()[0];
    if (ownerPage) await deleteTemporaryGroupViaApi(ownerPage, groupId);
    await memberContext.close();
    await ownerContext.close();
  }
});
