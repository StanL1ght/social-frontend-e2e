import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { createTemporaryGroupViaApi, deleteTemporaryGroupViaApi } from '../helpers/group-api';
import { createPost, deletePostIfPresent } from '../helpers/post-lifecycle';
import { createTemporaryPostViaApi, deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { PostComposerPage } from '../pages/PostComposerPage';
import { PostPage } from '../pages/PostPage';
import { GroupsPage } from '../pages/GroupsPage';

async function repost(page: Page, sourceId: string, destination: string, title: string): Promise<string> {
  await page.goto(`/post/${sourceId}`);
  await new PostPage(page).openRepostComposer();
  const composer = new PostComposerPage(page);
  await composer.waitForRepost();
  await composer.selectDestination(destination);
  await composer.fill(title, 'Комментарий к автоматическому репосту.');
  const created = page.waitForResponse((response) =>
    response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
  );
  await composer.publishNow();
  return ((await (await created).json()) as { id: string }).id;
}

test.describe('@mutation Направления репоста', () => {
  test.skip(!env.runMutationTests, 'Репосты разрешены только в mutation-режиме');

  for (const scenario of [
    { key: 'ESN-203', type: 'Публичная группа', privacy: 'Публичная группа' },
    { key: 'ESN-208', type: 'Закрытая группа', privacy: 'Закрытая группа' },
  ] as const) {
    test(`${scenario.key}: репост из личной ленты в ${scenario.type.toLowerCase()}`, async ({ page }) => {
      const groupName = uniqueMarker(scenario.type === 'Публичная группа' ? 'GROUP-PUBLIC' : 'GROUP-PRIVATE');
      const sourceTitle = uniqueMarker('REPOST-SOURCE');
      const repostTitle = uniqueMarker('REPOST');
      let groupId: string | undefined;
      let sourceUrl: string | undefined;
      let repostId: string | undefined;
      try {
        groupId = await createTemporaryGroupViaApi(page, groupName, scenario.type);
        sourceUrl = await createPost(page, sourceTitle, 'Источник для репоста в группу.');
        const sourceId = new URL(sourceUrl).pathname.split('/').filter(Boolean).at(-1)!;
        repostId = await repost(page, sourceId, groupName, repostTitle);
        await page.goto(`/post/${repostId}`);
        const groupLink = page.getByRole('link', { name: groupName, exact: true }).first();
        await expect(groupLink).toHaveAttribute('href', `/group/${groupId}`);
        await groupLink.click();
        await expect(page).toHaveURL(new RegExp(`/group/${groupId}`));
        await expect(page.getByText(scenario.privacy, { exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: repostTitle, exact: true })).toBeVisible();
      } finally {
        await deleteTemporaryPostViaApi(page, repostId);
        await deletePostIfPresent(page, sourceUrl);
        await deleteTemporaryGroupViaApi(page, groupId);
      }
    });
  }

  test('ESN-211: репост публикации из одной публичной группы в другую', async ({ page }) => {
    const firstName = uniqueMarker('GROUP-PUBLIC');
    const secondName = uniqueMarker('GROUP');
    const sourceTitle = uniqueMarker('REPOST-SOURCE');
    const repostTitle = uniqueMarker('REPOST');
    let firstId: string | undefined;
    let secondId: string | undefined;
    let sourceId: string | undefined;
    let repostId: string | undefined;
    try {
      firstId = await createTemporaryGroupViaApi(page, firstName, 'Публичная группа');
      secondId = await createTemporaryGroupViaApi(page, secondName, 'Публичная группа');
      sourceId = await createTemporaryPostViaApi(page, sourceTitle, firstId);
      repostId = await repost(page, sourceId, secondName, repostTitle);
      await page.goto(`/group/${secondId}`);
      await expect(page.getByRole('heading', { name: repostTitle, exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: sourceTitle, exact: true })).toBeVisible();
    } finally {
      await deleteTemporaryPostViaApi(page, repostId);
      await deleteTemporaryPostViaApi(page, sourceId);
      await deleteTemporaryGroupViaApi(page, secondId);
      await deleteTemporaryGroupViaApi(page, firstId);
    }
  });

  test('ESN-212: групповой репост повторно публикуется в личной ленте', async ({ page }) => {
    const groupName = uniqueMarker('GROUP');
    const sourceTitle = uniqueMarker('REPOST-SOURCE');
    const groupRepostTitle = `${uniqueMarker('REPOST')}-GROUP`;
    const personalTitle = `${uniqueMarker('REPOST')}-PERSONAL`;
    let groupId: string | undefined;
    let sourceUrl: string | undefined;
    let groupRepostId: string | undefined;
    let personalRepostId: string | undefined;
    try {
      groupId = await createTemporaryGroupViaApi(page, groupName, 'Публичная группа');
      sourceUrl = await createPost(page, sourceTitle, 'Источник двойного репоста.');
      const sourceId = new URL(sourceUrl).pathname.split('/').filter(Boolean).at(-1)!;
      groupRepostId = await repost(page, sourceId, groupName, groupRepostTitle);
      personalRepostId = await repost(page, groupRepostId, 'Моя лента', personalTitle);
      await page.goto(`/post/${personalRepostId}`);
      await expect(page.getByRole('heading', { name: personalTitle, exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: groupRepostTitle, exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: sourceTitle, exact: true })).toBeVisible();
    } finally {
      await deleteTemporaryPostViaApi(page, personalRepostId);
      await deleteTemporaryPostViaApi(page, groupRepostId);
      await deletePostIfPresent(page, sourceUrl);
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });

  test('ESN-209: репостит публикацию в скрытую группу', async ({ page }) => {
    const groupName = `${uniqueMarker('GROUP')}-HIDDEN-REPOST`;
    const sourceTitle = `${uniqueMarker('POST')}-HIDDEN-REPOST-SOURCE`;
    const repostTitle = `${uniqueMarker('REPOST')}-HIDDEN`;
    let groupId: string | undefined;
    let sourceId: string | undefined;
    let repostId: string | undefined;
    try {
      const groups = new GroupsPage(page);
      await groups.open();
      const groupCreated = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/api\/group\/?(?:\?|$)/.test(response.url()),
      );
      await groups.createGroup(groupName, 'Скрытая группа для проверки репоста.', 'Скрытая группа');
      groupId = ((await (await groupCreated).json()) as { id: string }).id;
      sourceId = await createTemporaryPostViaApi(page, sourceTitle);

      repostId = await repost(page, sourceId, groupName, repostTitle);
      const repostHeading = page.getByRole('heading', { name: repostTitle, exact: true });
      await expect(repostHeading).toBeVisible({ timeout: 20_000 });
      const card = repostHeading.locator('xpath=ancestor::network-post-card[1]');
      const groupLink = card.getByRole('link', { name: groupName, exact: true });
      await expect(groupLink).toHaveAttribute('href', `/group/${groupId}`);
      await expect(card.getByRole('heading', { name: sourceTitle, exact: true })).toBeVisible();

      await groupLink.click();
      await expect(page).toHaveURL(new RegExp(`/group/${groupId}`));
      await expect(page.getByText('Скрытая группа', { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: repostTitle, exact: true })).toBeVisible();
    } finally {
      await deleteTemporaryPostViaApi(page, repostId);
      await deleteTemporaryPostViaApi(page, sourceId);
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });
});
