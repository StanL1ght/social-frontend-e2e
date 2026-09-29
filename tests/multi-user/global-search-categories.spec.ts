import { expect, test } from '@playwright/test';
import { env, hasMultiUserEnvironment } from '../helpers/env';
import { createTemporaryGroupViaApi, deleteTemporaryGroupViaApi } from '../helpers/group-api';
import { createTemporaryPostViaApi, deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { LoginPage } from '../pages/LoginPage';
import { AppShellPage } from '../pages/AppShellPage';

test.describe('@multiuser @mutation Глобальный поиск по всем категориям', () => {
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два аккаунта и mutation-режим');

  test('ESN-56: одновременно находит пользователя, запись и группу', async ({ browser }) => {
    test.setTimeout(150_000);
    const ownerContext = await browser.newContext({ baseURL: env.baseURL });
    const memberContext = await browser.newContext({ baseURL: env.baseURL });
    const ownerPage = await ownerContext.newPage();
    const memberPage = await memberContext.newPage();
    let groupId: string | undefined;
    let postId: string | undefined;

    try {
      await new LoginPage(ownerPage).login(env.email, env.password);
      await new LoginPage(memberPage).login(env.memberEmail, env.memberPassword);
      const memberResponse = await memberPage.request.get('https://dev-social-backend.sddt.efko.ru/api/user/current');
      expect(memberResponse.ok()).toBe(true);
      const member = (await memberResponse.json()) as { first_name: string; last_name: string };
      const query = member.first_name;
      const marker = uniqueMarker('GROUP');
      const groupName = `${query} ${marker} группа`;
      const postTitle = `${query} ${marker} публикация`;

      groupId = await createTemporaryGroupViaApi(ownerPage, groupName, 'Публичная группа');
      postId = await createTemporaryPostViaApi(ownerPage, postTitle);

      await expect.poll(async () => {
        await ownerPage.goto('/feed');
        const responsePromise = ownerPage.waitForResponse(
          (response) => response.request().method() === 'POST' && /multi-search/i.test(response.url()),
          { timeout: 30_000 },
        );
        await new AppShellPage(ownerPage).searchGlobally(query);
        expect((await responsePromise).ok()).toBe(true);
        const dialog = ownerPage.getByRole('dialog', { name: 'Поиск' });
        const states = await Promise.all([
          dialog.getByText(postTitle, { exact: true }).isVisible(),
          dialog.getByText(groupName, { exact: true }).isVisible(),
          dialog.getByText(new RegExp(`${member.first_name}.*${member.last_name}`)).first().isVisible(),
        ]);
        return states.every(Boolean);
      }, {
        message: 'Все подготовленные сущности должны попасть в поисковый индекс',
        timeout: 75_000,
        intervals: [2_000, 5_000, 10_000],
      }).toBe(true);

      const dialog = ownerPage.getByRole('dialog', { name: 'Поиск' });
      await expect(dialog.getByText('Записи', { exact: true })).toBeVisible();
      await expect(dialog.getByText('Люди', { exact: true })).toBeVisible();
      await expect(dialog.getByText('Группы', { exact: true })).toBeVisible();
      await expect(dialog.getByText(postTitle, { exact: true })).toBeVisible();
      await expect(dialog.getByText(groupName, { exact: true })).toBeVisible();
      await expect(dialog.getByRole('option').filter({ hasText: member.first_name }).filter({ hasText: member.last_name }).first()).toBeVisible();

      const canScroll = await dialog.locator('*').evaluateAll((elements) => elements.some((element) => {
        const style = getComputedStyle(element);
        return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
      }));
      expect(canScroll, 'Выпадающий список результатов должен прокручиваться').toBe(true);
    } finally {
      await deleteTemporaryPostViaApi(ownerPage, postId);
      await deleteTemporaryGroupViaApi(ownerPage, groupId);
      await memberContext.close();
      await ownerContext.close();
    }
  });
});
