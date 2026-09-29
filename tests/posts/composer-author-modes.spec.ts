import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { PostComposerPage } from '../pages/PostComposerPage';
import { createTemporaryGroupViaApi, deleteTemporaryGroupViaApi } from '../helpers/group-api';
import { deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';

test.describe('Режимы автора публикации', () => {
  test.skip(!env.managedGroupUrl, 'Нужен E2E_MANAGED_GROUP_URL');

  test.beforeEach(async ({ page }) => {
    await page.goto(env.managedGroupUrl);
    const groupName = (await page.getByRole('heading').first().innerText()).trim();
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination(groupName);
  });

  test.afterEach(async ({ page }) => {
    await new PostComposerPage(page).discard();
  });

  test('показывает выбранного реального автора', async ({ page }) => {
    const composer = new PostComposerPage(page);
    const authorLabel = composer.dialog.getByText('Опубликовать от имени', { exact: true });
    await expect(authorLabel).toBeVisible();

    const authorSelector = authorLabel.locator('..').getByRole('combobox');
    await expect(authorSelector).toBeVisible();
    await expect(authorSelector.getByRole('button')).toHaveAccessibleName(/\S+/);
  });

  test('включает и выключает анонимную публикацию', async ({ page }) => {
    const composer = new PostComposerPage(page);
    const host = composer.dialog.locator('ekp-checkbox[label="Опубликовать анонимно"]');
    const input = host.locator('input[type="checkbox"]');

    await expect(input).not.toBeChecked();
    await host.click();
    await expect(input).toBeChecked();
    await host.click();
    await expect(input).not.toBeChecked();
  });
});

test('ESN-154 — публикует анонимный пост во временной группе @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Публикация разрешена только в mutation-режиме');
  const groupName = uniqueMarker('GROUP');
  const title = uniqueMarker('POST');
  let groupId: string | undefined;
  let postId: string | undefined;

  try {
    groupId = await createTemporaryGroupViaApi(page, groupName, 'Публичная группа');
    await page.goto(`/group/${groupId}`);
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination(groupName);

    const anonymous = composer.dialog.locator('ekp-checkbox[label="Опубликовать анонимно"]');
    const authorLabel = composer.dialog.getByText('Опубликовать от имени', { exact: true });
    await expect(authorLabel).toBeVisible();
    await anonymous.click();
    await expect(anonymous.locator('input[type="checkbox"]')).toBeChecked();
    await expect(authorLabel).toBeHidden();
    await composer.fill(title, 'Анонимная временная публикация для E2E.');

    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;
    const card = page.getByRole('heading', { name: title, exact: true }).locator('xpath=ancestor::*[.//a[contains(@href,"/post/")]][1]');
    await expect(card).toContainText('Пост');
    await expect(card).toContainText(groupName);
  } finally {
    await deleteTemporaryPostViaApi(page, postId);
    await deleteTemporaryGroupViaApi(page, groupId);
  }
});

test('ESN-148 — администратор публикует пост в закрытой группе @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Публикация разрешена только в mutation-режиме');
  const groupName = uniqueMarker('GROUP-PRIVATE');
  const title = uniqueMarker('POST');
  let groupId: string | undefined;
  let postId: string | undefined;

  try {
    groupId = await createTemporaryGroupViaApi(page, groupName, 'Закрытая группа');
    const [groupResponse, userResponse] = await Promise.all([
      page.request.get(`https://dev-social-backend.sddt.efko.ru/api/group/${groupId}`),
      page.request.get('https://dev-social-backend.sddt.efko.ru/api/user/current'),
    ]);
    expect(groupResponse.ok()).toBe(true);
    expect(userResponse.ok()).toBe(true);
    const group = (await groupResponse.json()) as {
      is_group_admin: boolean;
      is_group_owner: boolean;
      can_post: boolean;
    };
    expect(group).toMatchObject({ is_group_admin: true, is_group_owner: true, can_post: true });
    const user = (await userResponse.json()) as { first_name: string; last_name: string };
    const fullName = `${user.first_name} ${user.last_name}`.trim();

    await page.goto(`/group/${groupId}`);
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination(groupName);
    const authorLabel = composer.dialog.getByText('Опубликовать от имени', { exact: true });
    await expect(authorLabel).toBeVisible();
    await composer.fill(title, 'Публикация администратора закрытой группы.');
    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;

    const card = page.getByRole('heading', { name: title, exact: true }).locator('xpath=ancestor::*[.//a[contains(@href,"/post/")]][1]');
    await expect(card).toContainText(fullName);
    await expect(card).toContainText(groupName);
    await expect(card.getByText('Пост', { exact: true })).toHaveCount(0);
  } finally {
    await deleteTemporaryPostViaApi(page, postId);
    await deleteTemporaryGroupViaApi(page, groupId);
  }
});

test('ESN-149 — администратор публикует пост в скрытой группе @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Публикация разрешена только в mutation-режиме');
  const groupName = uniqueMarker('GROUP');
  const title = uniqueMarker('POST');
  let groupId: string | undefined;
  let postId: string | undefined;

  try {
    groupId = await createTemporaryGroupViaApi(page, groupName, 'Скрытая группа', 'subscribers');
    const groupResponse = await page.request.get(
      `https://dev-social-backend.sddt.efko.ru/api/group/${groupId}`,
    );
    expect(groupResponse.ok()).toBe(true);
    const group = (await groupResponse.json()) as {
      security_level: string;
      is_group_admin: boolean;
      can_post: boolean;
    };
    expect(group).toMatchObject({ security_level: 'secret', is_group_admin: true, can_post: true });

    await page.goto(`/group/${groupId}`);
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination(groupName);
    await composer.fill(title, 'Публикация администратора скрытой группы.');
    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;
    const card = page
      .getByRole('heading', { name: title, exact: true })
      .locator('xpath=ancestor::*[.//a[contains(@href,"/post/")]][1]');
    await expect(card).toContainText(groupName);
  } finally {
    await deleteTemporaryPostViaApi(page, postId);
    await deleteTemporaryGroupViaApi(page, groupId);
  }
});
