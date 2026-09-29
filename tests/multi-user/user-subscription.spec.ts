import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import { env, hasMultiUserEnvironment } from '../helpers/env';
import { LoginPage } from '../pages/LoginPage';

async function login(browser: Browser, email: string, password: string): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: env.baseURL,
    storageState: { cookies: [], origins: [] },
  });
  await new LoginPage(await context.newPage()).login(email, password);
  return context;
}

function subscriptionMutation(page: import('@playwright/test').Page) {
  return page.waitForResponse(
    (response) =>
      response.request().method() !== 'GET' &&
      !/\/feed-view(?:\?|$)/.test(response.url()),
    { timeout: 30_000 },
  );
}

async function unsubscribeIfNeeded(page: import('@playwright/test').Page): Promise<void> {
  const subscribed = page.getByRole('button', { name: 'Вы подписаны', exact: true });
  const subscribe = page.getByRole('button', { name: 'Подписаться', exact: true });
  await expect(subscribed.or(subscribe)).toBeVisible();
  if (await subscribe.isVisible()) return;

  await subscribed.click();
  const unsubscribe = page.getByRole('menuitem', { name: 'Отписаться', exact: true });
  await expect(unsubscribe).toBeVisible();
  const response = subscriptionMutation(page);
  await unsubscribe.click();
  expect((await response).ok()).toBe(true);
  await expect(subscribe).toBeVisible();
}

async function ownProfile(page: import('@playwright/test').Page): Promise<{ url: string; id: string }> {
  await page.goto('/feed');
  await page.getByText('Моя страница', { exact: true }).first().click();
  await expect(page).toHaveURL(/\/profile\/[^/]+/);
  const url = page.url();
  return { url, id: new URL(url).pathname.split('/').filter(Boolean).at(-1)! };
}

async function subscribeIfNeeded(page: import('@playwright/test').Page): Promise<void> {
  const subscribed = page.getByRole('button', { name: 'Вы подписаны', exact: true });
  const subscribe = page.getByRole('button', { name: 'Подписаться', exact: true });
  await expect(subscribed.or(subscribe)).toBeVisible();
  if (await subscribed.isVisible()) return;
  const response = subscriptionMutation(page);
  await subscribe.click();
  expect((await response).ok()).toBe(true);
  await expect(subscribed).toBeVisible();
}

test.describe('@multiuser @mutation Подписка на пользователя', () => {
  test.setTimeout(120_000);
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два пользователя и mutation-режим');

  test('ESN-79, ESN-80: подписывается и отписывается в чужом профиле со счётчиком', async ({ browser }) => {
    const ownerContext = await login(browser, env.email, env.password);
    const subscriberContext = await login(browser, env.memberEmail, env.memberPassword);

    try {
      const ownerPage = ownerContext.pages()[0];
      await ownerPage.goto('/feed');
      await ownerPage.getByText('Моя страница', { exact: true }).first().click();
      await expect(ownerPage).toHaveURL(/\/profile\/[^/]+/);
      const ownerProfileUrl = ownerPage.url();

      const page = subscriberContext.pages()[0];
      await page.goto(ownerProfileUrl);
      await unsubscribeIfNeeded(page);
      const followerCount = async () => {
        const match = (await page.locator('body').innerText()).match(/(\d+)\s+подписчик(?:а|ов)?/i);
        expect(match, 'В шапке профиля должен отображаться счётчик подписчиков').toBeTruthy();
        return Number(match![1]);
      };
      const initialFollowers = await followerCount();
      const subscribe = page.getByRole('button', { name: 'Подписаться', exact: true });
      await expect(subscribe).toBeVisible();
      const subscribeResponse = subscriptionMutation(page);
      await subscribe.click();
      expect((await subscribeResponse).ok()).toBe(true);
      await expect.poll(followerCount).toBe(initialFollowers + 1);

      await unsubscribeIfNeeded(page);
      await expect.poll(followerCount).toBe(initialFollowers);
    } finally {
      await subscriberContext.close();
      await ownerContext.close();
    }
  });

  test('ESN-83: подписывается на пользователя из каталога «Персоны»', async ({ browser }) => {
    test.fixme(true, 'Два выделенных тестовых аккаунта не находятся поиском в каталоге; подписываться на случайного сотрудника нельзя');
    const ownerContext = await login(browser, env.email, env.password);
    const subscriberContext = await login(browser, env.memberEmail, env.memberPassword);
    try {
      const ownerResponse = await ownerContext.pages()[0].request.get('https://dev-social-backend.sddt.efko.ru/api/user/current');
      expect(ownerResponse.ok()).toBe(true);
      const target = await ownerResponse.json() as { id: string; first_name: string };
      const page = subscriberContext.pages()[0];
      await page.goto('/feed');
      await page.getByText('Моя страница', { exact: true }).first().click();
      await expect(page).toHaveURL(/\/profile\/[^/]+/);
      const subscriberId = new URL(page.url()).pathname.split('/').filter(Boolean).pop()!;
      await page.goto('/catalogs');
      const search = page.locator('input[placeholder="Поиск по ФИО, Email или должности"]');
      const catalogResponse = page.waitForResponse((response) =>
        response.url().includes('/api/person/search?') &&
        new URL(response.url()).searchParams.get('search') === target.first_name &&
        response.ok(),
      );
      await search.fill(target.first_name);
      const payload = (await (await catalogResponse).json()) as {
        data?: { list?: Array<{ id: string; email: string; firstName: string; lastName: string; fullName: string }> };
      };
      const owner = payload.data?.list?.find((person) => person.id !== subscriberId && person.id === target.id);
      expect(owner, 'Поиск по имени должен вернуть второго тестового пользователя').toBeTruthy();

      let profileLink = page.getByRole('link', {
        name: `${owner!.firstName} ${owner!.lastName}`,
        exact: true,
      });
      await expect(profileLink).toBeVisible();
      await profileLink.click();
      await expect(page).toHaveURL(/\/profile\//);
      await unsubscribeIfNeeded(page);
      await page.goto('/catalogs');
      await search.fill(target.first_name);
      profileLink = page.getByRole('link', {
        name: `${owner!.firstName} ${owner!.lastName}`,
        exact: true,
      });
      await expect(profileLink).toBeVisible();
      const card = profileLink.locator('xpath=ancestor::social-persons-list-item[1]');
      const subscribe = card.getByRole('button', { name: /Подписа(?:ть|ться)/ });
      await subscribe.click();
      await expect(card.getByRole('button', { name: 'Вы подписаны', exact: true })).toBeVisible();

      await profileLink.click();
      await expect(page).toHaveURL(/\/profile\//);
      await expect(page.getByRole('button', { name: 'Вы подписаны', exact: true })).toBeVisible();
      await unsubscribeIfNeeded(page);
    } finally {
      await subscriberContext.close();
      await ownerContext.close();
    }
  });

  test('ESN-99: подписывается и отписывается через списки профиля', async ({ browser }) => {
    const ownerContext = await login(browser, env.email, env.password);
    const memberContext = await login(browser, env.memberEmail, env.memberPassword);
    const ownerPage = ownerContext.pages()[0];
    const memberPage = memberContext.pages()[0];
    let owner: { url: string; id: string } | undefined;
    let member: { url: string; id: string } | undefined;

    try {
      owner = await ownProfile(ownerPage);
      member = await ownProfile(memberPage);

      await ownerPage.goto(member.url);
      await unsubscribeIfNeeded(ownerPage);
      await memberPage.goto(owner.url);
      await subscribeIfNeeded(memberPage);

      await ownerPage.goto(owner.url);
      const followersCounter = ownerPage.getByText(/^подписчик(?:а|ов)?$/i).first().locator('..');
      await followersCounter.click();
      const followersDialog = ownerPage.getByRole('dialog');
      await expect(followersDialog).toBeVisible();
      const memberLink = followersDialog.locator(`a[href="/profile/${member.id}"]`).first();
      await expect(memberLink).toBeVisible({ timeout: 20_000 });
      const memberRow = memberLink.locator('xpath=ancestor::social-persons-list-item[1]');
      const subscribe = memberRow.getByRole('button', { name: 'Подписаться', exact: true });
      const subscribed = memberRow.getByRole('button', { name: 'Вы подписаны', exact: true });
      await expect(subscribe.or(subscribed)).toBeVisible();
      if (await subscribe.isVisible()) {
        const response = subscriptionMutation(ownerPage);
        await subscribe.click();
        expect((await response).ok()).toBe(true);
      }
      await expect(subscribed).toBeVisible();

      await ownerPage.goto(member.url);
      await expect(ownerPage.getByRole('button', { name: 'Вы подписаны', exact: true })).toBeVisible();
      await memberPage.goto(member.url);
      await memberPage.getByText(/^подписчик(?:а|ов)?$/i).first().locator('..').click();
      const memberFollowers = memberPage.getByRole('dialog');
      await expect(memberFollowers.locator(`a[href="/profile/${owner.id}"]`).first()).toBeVisible({ timeout: 20_000 });

      await ownerPage.goto(owner.url);
      await ownerPage.getByText(/^подписк(?:а|и|ок)$/i).first().locator('..').click();
      const followingDialog = ownerPage.getByRole('dialog');
      await followingDialog.getByRole('button', { name: /Подписки/ }).last().click();
      const followingLink = followingDialog.locator(`a[href="/profile/${member.id}"]`).first();
      await expect(followingLink).toBeVisible({ timeout: 20_000 });
      const followingRow = followingLink.locator('xpath=ancestor::social-persons-list-item[1]');
      await followingRow.getByRole('button', { name: 'Вы подписаны', exact: true }).click();
      const unsubscribe = ownerPage.getByRole('menuitem', { name: 'Отписаться', exact: true });
      const removed = subscriptionMutation(ownerPage);
      await unsubscribe.click();
      expect((await removed).ok()).toBe(true);
      await expect(followingLink).toBeHidden();

      await ownerPage.goto(member.url);
      await expect(ownerPage.getByRole('button', { name: 'Подписаться', exact: true })).toBeVisible();
      await memberPage.reload();
      await memberPage.getByText(/^подписчик(?:а|ов)?$/i).first().locator('..').click();
      await expect(memberPage.getByRole('dialog').locator(`a[href="/profile/${owner.id}"]`)).toHaveCount(0);
    } finally {
      if (member) {
        await ownerPage.goto(member.url, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => undefined);
        await unsubscribeIfNeeded(ownerPage).catch(() => undefined);
      }
      if (owner) {
        await memberPage.goto(owner.url, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => undefined);
        await unsubscribeIfNeeded(memberPage).catch(() => undefined);
      }
      await memberContext.close();
      await ownerContext.close();
    }
  });
});
