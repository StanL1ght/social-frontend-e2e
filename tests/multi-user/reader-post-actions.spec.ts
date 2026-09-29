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

test('ESN-364: читатель видит только репост и копирование ссылки @multiuser @mutation', async ({ browser }) => {
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два пользователя и mutation-режим');
  const ownerContext = await browser.newContext({ baseURL: env.baseURL });
  const readerContext = await browser.newContext({ baseURL: env.baseURL });
  let groupId: string | undefined;
  let postId: string | undefined;
  try {
    const ownerPage = await ownerContext.newPage();
    await new LoginPage(ownerPage).login(env.email, env.password);
    groupId = await createTemporaryGroupViaApi(ownerPage, uniqueMarker('GROUP-PUBLIC'), 'Публичная группа');
    postId = await createTemporaryPostViaApi(ownerPage, uniqueMarker('POST'), groupId);

    const readerPage = await readerContext.newPage();
    await new LoginPage(readerPage).login(env.memberEmail, env.memberPassword);
    await joinTemporaryGroupViaApi(readerPage, groupId);
    await readerPage.goto(`/post/${postId}`);
    await readerPage.getByRole('button', { name: 'Действия', exact: true }).click();
    await expect(readerPage.getByRole('menuitem', { name: /^Репост/ })).toBeVisible();
    await expect(readerPage.getByRole('menuitem', { name: 'Копировать ссылку', exact: true })).toBeVisible();
    await expect(readerPage.getByRole('menuitem', { name: /Редактировать|Удалить|Скрыть/ })).toHaveCount(0);
  } finally {
    const ownerPage = ownerContext.pages()[0];
    if (ownerPage) {
      await deleteTemporaryPostViaApi(ownerPage, postId);
      await deleteTemporaryGroupViaApi(ownerPage, groupId);
    }
    await readerContext.close();
    await ownerContext.close();
  }
});
