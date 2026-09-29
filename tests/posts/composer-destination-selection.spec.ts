import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { createTemporaryGroupViaApi, deleteTemporaryGroupViaApi } from '../helpers/group-api';
import { deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { PostComposerPage } from '../pages/PostComposerPage';

test('ESN-384: последовательно публикует в группу и личную ленту @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Нужен mutation-режим');
  const groupName = uniqueMarker('GROUP-PUBLIC');
  const groupTitle = uniqueMarker('POST');
  const personalTitle = uniqueMarker('POST');
  let groupId: string | undefined;
  let groupPostId: string | undefined;
  let personalPostId: string | undefined;
  try {
    groupId = await createTemporaryGroupViaApi(page, groupName, 'Публичная группа');
    await page.goto('/feed');
    const groupComposer = new PostComposerPage(page);
    await groupComposer.open();
    await groupComposer.selectDestination(groupName);
    await groupComposer.fill(groupTitle, 'Публикация в выбранной группе.');
    const groupCreated = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await groupComposer.publishNow();
    groupPostId = ((await (await groupCreated).json()) as { id: string }).id;
    await page.goto(`/group/${groupId}`);
    await expect(page.getByRole('heading', { name: groupTitle, exact: true })).toBeVisible();

    const personalComposer = new PostComposerPage(page);
    await personalComposer.open();
    await personalComposer.selectDestination('Моя лента');
    await personalComposer.fill(personalTitle, 'Публикация в личной ленте.');
    const personalCreated = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await personalComposer.publishNow();
    personalPostId = ((await (await personalCreated).json()) as { id: string }).id;
    await page.goto(`/post/${personalPostId}`);
    await expect(page.getByRole('heading', { name: personalTitle, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: groupName, exact: true })).toHaveCount(0);
  } finally {
    await deleteTemporaryPostViaApi(page, personalPostId);
    await deleteTemporaryPostViaApi(page, groupPostId);
    await deleteTemporaryGroupViaApi(page, groupId);
  }
});
