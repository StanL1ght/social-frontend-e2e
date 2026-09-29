import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { env, hasMultiUserEnvironment } from '../helpers/env';
import { createTemporaryGroupViaApi, deleteTemporaryGroupViaApi } from '../helpers/group-api';
import { uniqueMarker } from '../helpers/test-data';
import { LoginPage } from '../pages/LoginPage';

async function loginMember(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: env.baseURL, storageState: { cookies: [], origins: [] } });
  await new LoginPage(await context.newPage()).login(env.memberEmail, env.memberPassword);
  return context;
}

async function loginOwner(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: env.baseURL, storageState: { cookies: [], origins: [] } });
  await new LoginPage(await context.newPage()).login(env.email, env.password);
  return context;
}

async function memberIdentity(page: Page): Promise<{ id: string; firstName: string }> {
  const response = await page.request.get('https://dev-social-backend.sddt.efko.ru/api/user/current');
  expect(response.ok()).toBe(true);
  const user = (await response.json()) as { id: string; first_name: string };
  return { id: user.id, firstName: user.first_name };
}

async function inviteFromDialog(page: Page, groupId: string, member: { id: string; firstName: string }): Promise<void> {
  const dialog = page.getByRole('dialog').filter({ hasText: /Приглас|Добавить подписчиков/ }).last();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: /Поиск по ФИО/ }).fill(member.firstName);
  const profile = dialog.locator(`a[href="/profile/${member.id}"]`).last();
  await expect(profile).toBeVisible({ timeout: 20_000 });
  const hrefs = await dialog.locator('a[href^="/profile/"]').evaluateAll((links) =>
    [...new Set(links.map((link) => link.getAttribute('href')).filter(Boolean))],
  );
  const index = hrefs.indexOf(`/profile/${member.id}`);
  expect(index).toBeGreaterThanOrEqual(0);
  const invited = page.waitForResponse((response) =>
    response.request().method() !== 'GET' && response.url().includes(`/api/group/${groupId}`) && /member|invite/i.test(response.url()),
  );
  await dialog.getByRole('button', { name: 'Пригласить', exact: true }).nth(index).click();
  expect((await invited).ok()).toBe(true);
  await expect(dialog.getByText('Подписан', { exact: true }).first()).toBeVisible();
}

test.describe('@multiuser @mutation Приглашение в публичную группу', () => {
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два пользователя и mutation-режим');
  test.setTimeout(120_000);

  test('ESN-349: приглашает пользователя из карточки в списке групп', async ({ browser }) => {
    const ownerContext = await loginOwner(browser);
    const memberContext = await loginMember(browser);
    const ownerPage = ownerContext.pages()[0];
    const memberPage = memberContext.pages()[0];
    const groupName = `${uniqueMarker('GROUP')}-LIST-INVITE`;
    let groupId: string | undefined;
    try {
      const member = await memberIdentity(memberPage);
      groupId = await createTemporaryGroupViaApi(ownerPage, groupName, 'Публичная группа');
      await ownerPage.goto('/group');
      const groupNameNode = ownerPage.getByText(groupName, { exact: true }).first();
      await expect(groupNameNode).toBeVisible({ timeout: 20_000 });
      const targetY = (await groupNameNode.boundingBox())!.y;
      await ownerPage.getByRole('button', { name: 'Вы администратор', exact: true }).evaluateAll((buttons, y) => {
        buttons.sort((left, right) =>
          Math.abs(left.getBoundingClientRect().top - y) - Math.abs(right.getBoundingClientRect().top - y),
        );
        buttons[0]?.setAttribute('data-e2e-target-group-admin', 'true');
      }, targetY);
      await ownerPage.locator('[data-e2e-target-group-admin="true"]').click();
      await ownerPage.getByRole('menuitem', { name: 'Пригласить', exact: true }).click();
      await inviteFromDialog(ownerPage, groupId, member);
      const access = await memberPage.request.get(`https://dev-social-backend.sddt.efko.ru/api/group/${groupId}`);
      expect(await access.json()).toMatchObject({ is_member: true });
    } finally {
      await deleteTemporaryGroupViaApi(ownerPage, groupId);
      await memberContext.close();
      await ownerContext.close();
    }
  });

  test('ESN-350: приглашает пользователя со вкладки «Участники»', async ({ browser }) => {
    const ownerContext = await loginOwner(browser);
    const memberContext = await loginMember(browser);
    const ownerPage = ownerContext.pages()[0];
    const memberPage = memberContext.pages()[0];
    const groupName = `${uniqueMarker('GROUP')}-MEMBERS-INVITE`;
    let groupId: string | undefined;
    try {
      const member = await memberIdentity(memberPage);
      groupId = await createTemporaryGroupViaApi(ownerPage, groupName, 'Публичная группа');
      await ownerPage.goto(`/group/${groupId}`);
      await ownerPage.getByRole('button', { name: 'Участники', exact: true }).filter({ visible: true }).click();
      const add = ownerPage.getByRole('button', { name: /Добавить/, exact: true }).filter({ visible: true });
      await expect(add).toBeVisible();
      await add.click();
      await inviteFromDialog(ownerPage, groupId, member);
      const memberProfile = ownerPage.locator(`a[href="/profile/${member.id}"]`).filter({ visible: true }).first();
      await expect(memberProfile).toBeVisible({ timeout: 20_000 });
      const access = await memberPage.request.get(`https://dev-social-backend.sddt.efko.ru/api/group/${groupId}`);
      expect(await access.json()).toMatchObject({ is_member: true });
    } finally {
      await deleteTemporaryGroupViaApi(ownerPage, groupId);
      await memberContext.close();
      await ownerContext.close();
    }
  });
});
