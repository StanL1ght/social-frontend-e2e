import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { env, hasMultiUserEnvironment } from '../helpers/env';
import { uniqueMarker } from '../helpers/test-data';
import { createTemporaryGroupViaApi, deleteTemporaryGroupViaApi, joinTemporaryGroupViaApi } from '../helpers/group-api';
import { LoginPage } from '../pages/LoginPage';

async function loggedInContext(browser: Browser, email: string, password: string): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: env.baseURL,
    storageState: { cookies: [], origins: [] },
  });
  await new LoginPage(await context.newPage()).login(email, password);
  return context;
}

async function clickAndCheckMutation(page: Page, buttonName: RegExp): Promise<void> {
  const button = page.getByRole('button', { name: buttonName }).first();
  await expect(button).toBeVisible();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() !== 'GET' && /\/api\/group\//.test(response.url()),
    { timeout: 30_000 },
  );
  await button.click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
}

test.describe('@multiuser @mutation Подписки на группы', () => {
  test.setTimeout(120_000);
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два пользователя и mutation-режим');

  test('ESN-521: запрос доступа в скрытую группу виден заявителю и владельцу', async ({ browser }) => {
    const adminContext = await loggedInContext(browser, env.email, env.password);
    const memberContext = await loggedInContext(browser, env.memberEmail, env.memberPassword);
    const adminPage = adminContext.pages()[0];
    const memberPage = memberContext.pages()[0];
    let groupId: string | undefined;
    try {
      groupId = await createTemporaryGroupViaApi(adminPage, `${uniqueMarker('GROUP')}-SECRET`, 'Скрытая группа');
      await memberPage.goto(`/group/${groupId}/posts`);
      const request = memberPage.getByRole('button', { name: /Запросить доступ|Подать заявку/ }).first();
      await expect(request).toBeVisible();
      const requested = memberPage.waitForResponse((response) =>
        response.request().method() !== 'GET' && response.url().includes(`/api/group/${groupId}`),
      );
      await request.click();
      expect((await requested).ok()).toBe(true);
      await expect(memberPage.getByRole('button', { name: /Запрос отправлен|Доступ запрошен|Заявка отправлена/ })).toBeVisible();
      await memberPage.reload();
      await expect(memberPage.getByRole('button', { name: /Запрос отправлен|Доступ запрошен|Заявка отправлена/ })).toBeVisible();
      await expect(memberPage.getByRole('button', { name: /^(Запросить доступ|Подать заявку)$/ })).toHaveCount(0);

      await adminPage.goto(`/group/${groupId}/posts`);
      await adminPage.getByRole('button', { name: 'Вы администратор', exact: true }).click();
      await adminPage.getByRole('menuitem', { name: 'Заявки на добавление', exact: true }).click();
      const applications = adminPage.getByRole('dialog').filter({ hasText: /Заявки на добавление/ }).last();
      await expect(applications).toBeVisible();
      const current = await memberPage.request.get('https://dev-social-backend.sddt.efko.ru/api/user/current');
      expect(current.ok()).toBe(true);
      const member = await current.json() as { first_name: string; last_name: string };
      await expect(applications).toContainText(member.first_name);
      await expect(applications).toContainText(member.last_name);
    } finally {
      await deleteTemporaryGroupViaApi(adminPage, groupId);
      await memberContext.close();
      await adminContext.close();
    }
  });

  test('ESN-520 (частично): владелец принимает и отклоняет заявки в двух временных группах', async ({ browser }) => {
    test.setTimeout(150_000);
    const adminContext = await loggedInContext(browser, env.email, env.password);
    const memberContext = await loggedInContext(browser, env.memberEmail, env.memberPassword);
    const adminPage = adminContext.pages()[0];
    const memberPage = memberContext.pages()[0];
    const groupIds: string[] = [];
    try {
      for (const decision of ['Принять', 'Отклонить'] as const) {
        const groupId = await createTemporaryGroupViaApi(
          adminPage, `${uniqueMarker('GROUP')}-${decision}`, 'Закрытая группа',
        );
        groupIds.push(groupId);
        await memberPage.goto(`/group/${groupId}/posts`);
        const request = memberPage.getByRole('button', { name: /Запросить доступ|Подать заявку/ }).first();
        await expect(request).toBeVisible();
        const requested = memberPage.waitForResponse((response) =>
          response.request().method() !== 'GET' && response.url().includes(`/api/group/${groupId}`),
        );
        await request.click();
        expect((await requested).ok()).toBe(true);

        await adminPage.goto(`/group/${groupId}/posts`);
        await adminPage.getByRole('button', { name: 'Вы администратор', exact: true }).click();
        await adminPage.getByRole('menuitem', { name: 'Заявки на добавление', exact: true }).click();
        const applications = adminPage.getByRole('dialog').filter({ hasText: /Заявки на добавление/ }).last();
        await expect(applications).toBeVisible();
        await expect(applications.getByRole('button', { name: 'Принять', exact: true })).toBeVisible();
        await expect(applications.getByRole('button', { name: 'Отклонить', exact: true })).toBeVisible();
        const processed = adminPage.waitForResponse((response) =>
          response.request().method() !== 'GET' && response.url().includes(`/api/group/${groupId}`),
        );
        await applications.getByRole('button', { name: decision, exact: true }).click();
        expect((await processed).ok()).toBe(true);
        await expect(applications.getByRole('button', { name: decision, exact: true })).toHaveCount(0);
        const membership = await memberPage.request.get(`https://dev-social-backend.sddt.efko.ru/api/group/${groupId}`);
        expect(membership.ok()).toBe(true);
        expect(await membership.json()).toMatchObject({ is_member: decision === 'Принять' });
      }
    } finally {
      for (const groupId of groupIds) await deleteTemporaryGroupViaApi(adminPage, groupId);
      await memberContext.close();
      await adminContext.close();
    }
  });

  for (const groupType of ['Публичная группа', 'Закрытая группа'] as const) {
    test(`${groupType === 'Закрытая группа' ? 'ESN-144: ' : ''}${groupType}: подписка или запрос доступа`, async ({ browser }) => {
      const adminContext = await loggedInContext(browser, env.email, env.password);
      const memberContext = await loggedInContext(browser, env.memberEmail, env.memberPassword);
      const adminPage = adminContext.pages()[0];
      const memberPage = memberContext.pages()[0];
      const name = uniqueMarker(groupType === 'Публичная группа' ? 'GROUP-PUBLIC' : 'GROUP-PRIVATE');
      let groupId: string | undefined;

      try {
        groupId = await createTemporaryGroupViaApi(adminPage, name, groupType);
        const groupUrl = `/group/${groupId}/posts`;
        await memberPage.goto('/group/all');
        const allGroups = memberPage.getByRole('radiogroup').getByRole('button', { name: 'Все группы', exact: true });
        await expect(allGroups).toBeVisible();
        const search = memberPage.locator('input[placeholder="Поиск по группам"]');
        await search.fill(name);
        const groupResult = memberPage.getByText(name, { exact: true }).first();
        await expect(groupResult).toBeVisible({ timeout: 20_000 });
        await groupResult.click();
        await expect(memberPage).toHaveURL(new RegExp(`/group/${groupId}`));
        await expect(memberPage.getByRole('heading', { name, exact: true })).toBeVisible();

        if (groupType === 'Публичная группа') {
          await clickAndCheckMutation(memberPage, /^Подписаться$/);
          const subscribed = memberPage.getByRole('button', { name: 'Вы подписаны', exact: true });
          await expect(subscribed).toBeVisible();
          const apiUrl = `https://dev-social-backend.sddt.efko.ru/api/group/${groupId}`;
          const adminRole = await adminPage.request.get(apiUrl);
          const memberRole = await memberPage.request.get(apiUrl);
          expect(adminRole.ok()).toBe(true);
          expect(memberRole.ok()).toBe(true);
          const adminAccess = await adminRole.json() as {
            is_member: boolean; is_group_admin: boolean; is_group_owner: boolean; can_post: boolean;
          };
          const subscriberAccess = await memberRole.json() as {
            is_member: boolean; is_group_admin: boolean; is_group_owner: boolean; can_post: boolean;
          };
          expect(adminAccess).toMatchObject({
            is_member: true, is_group_admin: true, is_group_owner: true, can_post: true,
          });
          expect(subscriberAccess).toMatchObject({
            is_member: true, is_group_admin: false, is_group_owner: false, can_post: false,
          });
          await subscribed.click();
          const unsubscribe = memberPage.getByRole('menuitem', { name: 'Отписаться', exact: true });
          await expect(unsubscribe).toBeVisible();
          await unsubscribe.click();
          const confirmation = memberPage.getByRole('alertdialog', { name: 'Покинуть группу' });
          await expect(confirmation).toBeVisible();
          const unsubscribeResponse = memberPage.waitForResponse(
            (response) =>
              response.request().method() !== 'GET' &&
              !/\/feed-view(?:\?|$)/.test(response.url()),
            { timeout: 30_000 },
          );
          await confirmation.getByRole('button', { name: 'Отписаться', exact: true }).click();
          expect((await unsubscribeResponse).ok()).toBe(true);
          await expect(memberPage.getByRole('button', { name: 'Подписаться', exact: true })).toBeVisible();
          const outsiderRole = await memberPage.request.get(apiUrl);
          expect(outsiderRole.ok()).toBe(true);
          expect(await outsiderRole.json()).toMatchObject({
            is_member: false, is_group_admin: false, is_group_owner: false,
          });
        } else {
          const requestAccess = memberPage.getByRole('button', {
            name: /Подать заявку|Запросить доступ|Подписаться/,
          }).first();
          await expect(requestAccess).toBeVisible();
          const accessResponse = memberPage.waitForResponse(
            (response) =>
              response.request().method() !== 'GET' &&
              /\/api\/group\//.test(response.url()) &&
              response.url().includes(groupId!) &&
              !/\/feed-view(?:\?|$)/.test(response.url()),
            { timeout: 30_000 },
          );
          await requestAccess.click();
          expect((await accessResponse).ok()).toBe(true);
          await expect(
            memberPage.getByRole('button', {
              name: /Доступ запрошен|Заявка отправлена|Отменить заявку|Запрос отправлен/,
            }),
          ).toBeVisible();

          await memberPage.reload();
          await expect(
            memberPage.getByRole('button', {
              name: /Доступ запрошен|Заявка отправлена|Отменить заявку|Запрос отправлен/,
            }),
          ).toBeVisible();
          await expect(
            memberPage.getByRole('button', { name: /^(Подать заявку|Запросить доступ|Подписаться)$/ }),
            'После обновления нельзя повторно отправить тот же запрос на доступ',
          ).toHaveCount(0);
          const current = await memberPage.request.get('https://dev-social-backend.sddt.efko.ru/api/user/current');
          expect(current.ok()).toBe(true);
          const applicant = await current.json() as { first_name: string };
          await adminPage.goto(groupUrl);
          await adminPage.getByRole('button', { name: 'Вы администратор', exact: true }).click();
          await adminPage.getByRole('menuitem', { name: 'Заявки на добавление', exact: true }).click();
          const applications = adminPage.getByRole('dialog').filter({ hasText: /Заявки на добавление/ }).last();
          await expect(applications).toContainText(applicant.first_name);
          await expect(applications.getByRole('button', { name: 'Принять', exact: true })).toBeVisible();
          await expect(applications.getByRole('button', { name: 'Отклонить', exact: true })).toBeVisible();
        }
      } finally {
        await deleteTemporaryGroupViaApi(adminPage, groupId);
        await memberContext.close();
        await adminContext.close();
      }
    });
  }

  test('ESN-123: подписка на публичную группу подтверждается сервером и кнопкой', async ({ browser }) => {
    const adminContext = await loggedInContext(browser, env.email, env.password);
    const memberContext = await loggedInContext(browser, env.memberEmail, env.memberPassword);
    const adminPage = adminContext.pages()[0];
    const memberPage = memberContext.pages()[0];
    const groupName = uniqueMarker('GROUP-PUBLIC');
    let groupId: string | undefined;
    try {
      groupId = await createTemporaryGroupViaApi(adminPage, groupName, 'Публичная группа');
      await memberPage.goto(`/group/${groupId}/posts`);
      await clickAndCheckMutation(memberPage, /^Подписаться$/);
      await expect(memberPage.getByRole('button', { name: 'Вы подписаны', exact: true })).toBeVisible();
      const membership = await memberPage.request.get(`https://dev-social-backend.sddt.efko.ru/api/group/${groupId}`);
      expect(membership.ok()).toBe(true);
      expect(await membership.json()).toMatchObject({ is_member: true });
    } finally {
      await deleteTemporaryGroupViaApi(adminPage, groupId);
      await memberContext.close();
      await adminContext.close();
    }
  });

  test('ESN-143: отписывается со страницы группы после подтверждения', async ({ browser }) => {
    const adminContext = await loggedInContext(browser, env.email, env.password);
    const memberContext = await loggedInContext(browser, env.memberEmail, env.memberPassword);
    const adminPage = adminContext.pages()[0];
    const memberPage = memberContext.pages()[0];
    const name = `${uniqueMarker('GROUP-PUBLIC')}-PAGE`;
    let groupId: string | undefined;
    try {
      groupId = await createTemporaryGroupViaApi(adminPage, name, 'Публичная группа');
      await joinTemporaryGroupViaApi(memberPage, groupId);
      await memberPage.goto(`/group/${groupId}/posts`);
      await memberPage.getByRole('button', { name: 'Вы подписаны', exact: true }).click();
      await expect(memberPage.getByRole('menuitem', { name: 'Выключить уведомления', exact: true })).toBeVisible();
      await memberPage.getByRole('menuitem', { name: 'Отписаться', exact: true }).click();
      const confirmation = memberPage.getByRole('alertdialog', { name: 'Покинуть группу' });
      await expect(confirmation).toBeVisible();
      await expect(confirmation).toContainText(/Вы уверены|покинуть группу/i);
      await expect(confirmation.getByRole('button', { name: 'Отмена', exact: true })).toBeVisible();
      await expect(confirmation.getByRole('button', { name: 'Отписаться', exact: true })).toBeVisible();
      await confirmation.getByRole('button', { name: 'Отписаться', exact: true }).click();
      await expect(memberPage.getByRole('button', { name: 'Подписаться', exact: true })).toBeVisible();
      const membership = await memberPage.request.get(`https://dev-social-backend.sddt.efko.ru/api/group/${groupId}`);
      expect(membership.ok()).toBe(true);
      expect(await membership.json()).toMatchObject({ is_member: false });
    } finally {
      await deleteTemporaryGroupViaApi(adminPage, groupId);
      await memberContext.close();
      await adminContext.close();
    }
  });

  test('ESN-143-CANCEL: отмена выхода из группы сохраняет подписку', async ({ browser }) => {
    const adminContext = await loggedInContext(browser, env.email, env.password);
    const memberContext = await loggedInContext(browser, env.memberEmail, env.memberPassword);
    const adminPage = adminContext.pages()[0];
    const memberPage = memberContext.pages()[0];
    let groupId: string | undefined;
    try {
      groupId = await createTemporaryGroupViaApi(adminPage, `${uniqueMarker('GROUP')}-LEAVE-CANCEL`, 'Публичная группа');
      await joinTemporaryGroupViaApi(memberPage, groupId);
      await memberPage.goto(`/group/${groupId}/posts`);
      await memberPage.getByRole('button', { name: 'Вы подписаны', exact: true }).click();
      await memberPage.getByRole('menuitem', { name: 'Отписаться', exact: true }).click();
      const confirmation = memberPage.getByRole('alertdialog', { name: 'Покинуть группу' });
      await expect(confirmation).toBeVisible();
      await expect(confirmation).toContainText(/Вы уверены|покинуть группу/i);
      await expect(confirmation.getByRole('button', { name: 'Отписаться', exact: true })).toBeVisible();
      await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click();
      await expect(confirmation).toHaveCount(0);
      await memberPage.reload();
      await expect(memberPage.getByRole('button', { name: 'Вы подписаны', exact: true })).toBeVisible();
      const membership = await memberPage.request.get(`https://dev-social-backend.sddt.efko.ru/api/group/${groupId}`);
      expect(membership.ok()).toBe(true);
      expect(await membership.json()).toMatchObject({ is_member: true });
    } finally {
      await deleteTemporaryGroupViaApi(adminPage, groupId);
      await memberContext.close();
      await adminContext.close();
    }
  });
});
