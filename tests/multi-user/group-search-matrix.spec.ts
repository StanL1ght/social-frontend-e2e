import { expect, test, type Page } from '@playwright/test';
import { env, hasMultiUserEnvironment } from '../helpers/env';
import {
  createTemporaryGroupViaApi,
  deleteTemporaryGroupViaApi,
  joinTemporaryGroupViaApi,
} from '../helpers/group-api';
import { uniqueMarker } from '../helpers/test-data';
import { LoginPage } from '../pages/LoginPage';

async function searchGroup(page: Page, path: string, name: string, shouldExist: boolean): Promise<void> {
  await page.goto(path);
  const search = page.locator('input[placeholder="Поиск по группам"]');
  await expect(search).toBeVisible();
  await search.fill(name);
  const result = page.getByText(name, { exact: true });
  if (shouldExist) await expect(result.first()).toBeVisible({ timeout: 20_000 });
  else await expect(result).toHaveCount(0, { timeout: 20_000 });
}

test('ESN-175: поиск по подпискам, управляемым и всем публичным группам @multiuser @mutation', async ({ browser }) => {
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два аккаунта и mutation-режим');
  test.setTimeout(150_000);
  const ownerContext = await browser.newContext({ baseURL: env.baseURL });
  const otherContext = await browser.newContext({ baseURL: env.baseURL });
  const ownerPage = await ownerContext.newPage();
  const otherPage = await otherContext.newPage();
  const ownedName = `${uniqueMarker('GROUP')}-OWNED`;
  const subscribedName = `${uniqueMarker('GROUP')}-SUBSCRIBED`;
  const outsiderName = `${uniqueMarker('GROUP')}-OUTSIDER`;
  let ownedId: string | undefined;
  let subscribedId: string | undefined;
  let outsiderId: string | undefined;

  try {
    await new LoginPage(ownerPage).login(env.email, env.password);
    await new LoginPage(otherPage).login(env.memberEmail, env.memberPassword);
    ownedId = await createTemporaryGroupViaApi(ownerPage, ownedName, 'Публичная группа');
    subscribedId = await createTemporaryGroupViaApi(otherPage, subscribedName, 'Публичная группа');
    outsiderId = await createTemporaryGroupViaApi(otherPage, outsiderName, 'Публичная группа');
    await joinTemporaryGroupViaApi(ownerPage, subscribedId);

    await searchGroup(ownerPage, '/group', ownedName, true);
    await searchGroup(ownerPage, '/group', subscribedName, true);
    await searchGroup(ownerPage, '/group', outsiderName, false);

    await searchGroup(ownerPage, '/group/owned', ownedName, true);
    await searchGroup(ownerPage, '/group/owned', subscribedName, false);
    await searchGroup(ownerPage, '/group/owned', outsiderName, false);

    await searchGroup(ownerPage, '/group/all', ownedName, true);
    await searchGroup(ownerPage, '/group/all', subscribedName, true);
    await searchGroup(ownerPage, '/group/all', outsiderName, true);
  } finally {
    await deleteTemporaryGroupViaApi(ownerPage, ownedId);
    await deleteTemporaryGroupViaApi(otherPage, subscribedId);
    await deleteTemporaryGroupViaApi(otherPage, outsiderId);
    await otherContext.close();
    await ownerContext.close();
  }
});

test('ESN-162, ESN-175: чужая скрытая группа отсутствует во вкладке «Все группы» @multiuser @mutation', async ({ browser }) => {
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два аккаунта и mutation-режим');
  const viewerContext = await browser.newContext({ baseURL: env.baseURL });
  const ownerContext = await browser.newContext({ baseURL: env.baseURL });
  const viewerPage = await viewerContext.newPage();
  const ownerPage = await ownerContext.newPage();
  const hiddenName = `${uniqueMarker('GROUP')}-HIDDEN`;
  let hiddenId: string | undefined;
  try {
    await new LoginPage(viewerPage).login(env.email, env.password);
    await new LoginPage(ownerPage).login(env.memberEmail, env.memberPassword);
    hiddenId = await createTemporaryGroupViaApi(ownerPage, hiddenName, 'Скрытая группа');
    await viewerPage.goto('/group/all');
    const allGroups = viewerPage.getByRole('radiogroup').getByRole('button', { name: 'Все группы', exact: true });
    await expect(allGroups).toBeVisible();
    await expect(viewerPage).toHaveURL(/\/group\/all/);
    await viewerPage.locator('input[placeholder="Поиск по группам"]').fill(hiddenName);
    await expect(viewerPage.getByText(hiddenName, { exact: true })).toHaveCount(0);
  } finally {
    await deleteTemporaryGroupViaApi(ownerPage, hiddenId);
    await ownerContext.close();
    await viewerContext.close();
  }
});
