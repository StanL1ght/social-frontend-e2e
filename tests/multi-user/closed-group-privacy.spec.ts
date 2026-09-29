import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import { env, hasMultiUserEnvironment } from '../helpers/env';
import { createTemporaryGroupViaApi, deleteTemporaryGroupViaApi } from '../helpers/group-api';
import { createTemporaryPostViaApi, deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { AppShellPage } from '../pages/AppShellPage';
import { LoginPage } from '../pages/LoginPage';
import { GroupsPage } from '../pages/GroupsPage';

async function loggedInContext(
  browser: Browser,
  email: string,
  password: string,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: env.baseURL,
    storageState: { cookies: [], origins: [] },
  });
  await new LoginPage(await context.newPage()).login(email, password);
  return context;
}

test.describe('@multiuser @mutation Конфиденциальность закрытой группы', () => {
  test.setTimeout(120_000);
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два пользователя и mutation-режим');

  test('ESN-141: пост закрытой группы недоступен постороннему в ленте, поиске и группе', async ({ browser }) => {
    const ownerContext = await loggedInContext(browser, env.email, env.password);
    const outsiderContext = await loggedInContext(browser, env.memberEmail, env.memberPassword);
    const ownerPage = ownerContext.pages()[0];
    const outsiderPage = outsiderContext.pages()[0];
    const groupName = uniqueMarker('GROUP-PRIVATE');
    const postTitle = uniqueMarker('POST');
    let groupId: string | undefined;
    let postId: string | undefined;

    try {
      groupId = await createTemporaryGroupViaApi(ownerPage, groupName, 'Закрытая группа');
      postId = await createTemporaryPostViaApi(ownerPage, postTitle, groupId);

      await outsiderPage.goto('/feed');
      await expect(outsiderPage.getByText(postTitle, { exact: true })).toHaveCount(0);

      const shell = new AppShellPage(outsiderPage);
      await shell.searchGlobally(postTitle);
      const searchDialog = outsiderPage.getByRole('dialog', { name: 'Поиск' });
      await expect(searchDialog).toBeVisible();
      await expect(searchDialog.getByText(postTitle, { exact: true })).toHaveCount(0);
      await shell.closeGlobalSearch();

      await outsiderPage.goto(`/group/${groupId}/posts`);
      await expect(outsiderPage).toHaveURL(new RegExp(`/group/${groupId}`));

      await expect(outsiderPage.getByRole('heading', { name: groupName, exact: true })).toBeVisible();
      await expect(outsiderPage.getByText('Временная группа для E2E-проверки.', { exact: true })).toBeVisible();
      await expect(outsiderPage.getByText(/Это закрытая группа/i)).toBeVisible();
      await expect(outsiderPage.getByText(postTitle, { exact: true })).toHaveCount(0);

      const access = await outsiderPage.request.get(
        `https://dev-social-backend.sddt.efko.ru/api/group/${groupId}`,
      );
      expect(access.ok()).toBe(true);
      expect(await access.json()).toMatchObject({
        is_member: false,
        is_group_admin: false,
        is_group_owner: false,
        can_post: false,
      });
    } finally {
      await deleteTemporaryPostViaApi(ownerPage, postId);
      await deleteTemporaryGroupViaApi(ownerPage, groupId);
      await outsiderContext.close();
      await ownerContext.close();
    }
  });

  test('ESN-57: поиск показывает закрытую группу постороннему', async ({ browser }) => {
    const ownerContext = await loggedInContext(browser, env.email, env.password);
    const outsiderContext = await loggedInContext(browser, env.memberEmail, env.memberPassword);
    const ownerPage = ownerContext.pages()[0];
    const outsiderPage = outsiderContext.pages()[0];
    const privateName = `${uniqueMarker('GROUP')}-PRIVATE-SEARCH`;
    let privateId: string | undefined;

    try {
      privateId = await createTemporaryGroupViaApi(ownerPage, privateName, 'Закрытая группа');
      const shell = new AppShellPage(outsiderPage);

      await shell.goto('/feed');
      await shell.searchGlobally(privateName);
      const privateResult = outsiderPage.getByRole('dialog', { name: 'Поиск' })
        .getByText(privateName, { exact: true });
      await expect(privateResult).toBeVisible({ timeout: 20_000 });
      await privateResult.click();
      await expect(outsiderPage).toHaveURL(new RegExp(`/group/${privateId}`));
      await expect(outsiderPage.getByRole('heading', { name: privateName, exact: true })).toBeVisible();
      await expect(outsiderPage.getByText('Временная группа для E2E-проверки.', { exact: true })).toBeVisible();
      await expect(outsiderPage.getByText(/Это закрытая группа/i)).toBeVisible();
      await expect(outsiderPage.locator('network-post-card')).toHaveCount(0);

    } finally {
      await deleteTemporaryGroupViaApi(ownerPage, privateId);
      await outsiderContext.close();
      await ownerContext.close();
    }
  });

  test('ESN-58: поиск скрывает скрытую группу от постороннего', async ({ browser }) => {
    const ownerContext = await loggedInContext(browser, env.memberEmail, env.memberPassword);
    const outsiderContext = await loggedInContext(browser, env.email, env.password);
    const ownerPage = ownerContext.pages()[0];
    const outsiderPage = outsiderContext.pages()[0];
    const hiddenName = `${uniqueMarker('GROUP')}-HIDDEN-SEARCH`;
    let hiddenId: string | undefined;

    try {
      const groups = new GroupsPage(ownerPage);
      await groups.open();
      const created = ownerPage.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/api\/group\/?(?:\?|$)/.test(response.url()),
      );
      await groups.createGroup(hiddenName, 'Скрытая группа для проверки поиска.', 'Скрытая группа');
      hiddenId = ((await (await created).json()) as { id: string }).id;
      const shell = new AppShellPage(outsiderPage);
      await shell.goto('/feed');
      await shell.searchGlobally(hiddenName);
      const search = outsiderPage.getByRole('dialog', { name: 'Поиск' });
      await expect(search.getByText(hiddenName, { exact: true })).toHaveCount(0);
    } finally {
      await deleteTemporaryGroupViaApi(ownerPage, hiddenId);
      await outsiderContext.close();
      await ownerContext.close();
    }
  });
});
