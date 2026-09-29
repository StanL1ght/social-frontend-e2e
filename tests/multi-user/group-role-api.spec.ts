import { test, expect } from '@playwright/test';
import { env, hasMultiUserEnvironment } from '../helpers/env';
import { LoginPage } from '../pages/LoginPage';

type GroupAccess = {
  id: string;
  is_member: boolean;
  is_group_admin: boolean;
  is_group_owner: boolean;
  can_post: boolean;
  can_comment: boolean;
};

test('права владельца группы и пользователя вне группы согласованы в API и UI', async ({ browser }) => {
  test.skip(!hasMultiUserEnvironment, 'Нужны два аккаунта и URL управляемой группы');
  const groupId = new URL(env.managedGroupUrl, env.baseURL).pathname.split('/')[2];
  expect(groupId).toBeTruthy();

  for (const account of [
    { email: env.email, password: env.password, role: 'owner' as const },
    { email: env.memberEmail, password: env.memberPassword, role: 'outsider' as const },
  ]) {
    const context = await browser.newContext({
      baseURL: env.baseURL,
      storageState: { cookies: [], origins: [] },
    });
    try {
      const page = await context.newPage();
      await new LoginPage(page).login(account.email, account.password);
      const response = await page.request.get(`https://dev-social-backend.sddt.efko.ru/api/group/${groupId}`);
      expect(response.ok()).toBe(true);
      const group = (await response.json()) as GroupAccess;
      expect(group.id).toBe(groupId);

      await page.goto(env.managedGroupUrl);
      if (account.role === 'owner') {
        expect(group.is_member).toBe(true);
        expect(group.is_group_admin).toBe(true);
        expect(group.is_group_owner).toBe(true);
        expect(group.can_post).toBe(true);
        await expect(page.getByRole('button', { name: 'Вы администратор', exact: true })).toBeVisible();
      } else {
        expect(group.is_member).toBe(false);
        expect(group.is_group_admin).toBe(false);
        expect(group.is_group_owner).toBe(false);
        await expect(page.getByRole('button', { name: 'Вы администратор', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /Подписаться|Запросить доступ|Подать заявку/ })).toBeVisible();
      }
    } finally {
      await context.close();
    }
  }
});
