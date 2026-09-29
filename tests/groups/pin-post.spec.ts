import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { createTemporaryGroupViaApi, deleteTemporaryGroupViaApi } from '../helpers/group-api';
import { createTemporaryPostViaApi, deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { PostPage } from '../pages/PostPage';

test('ESN-120, ESN-366: администратор закрепляет и открепляет публикацию временной группы @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Тест создаёт временную группу и публикацию');
  test.setTimeout(120_000);
  let groupId: string | undefined;
  let postId: string | undefined;
  let secondPostId: string | undefined;
  const groupName = uniqueMarker('GROUP');
  const title = uniqueMarker('POST');
  const secondTitle = `${uniqueMarker('POST')}-NEWER`;
  try {
    groupId = await createTemporaryGroupViaApi(page, groupName, 'Публичная группа');
    postId = await createTemporaryPostViaApi(page, title, groupId);
    secondPostId = await createTemporaryPostViaApi(page, secondTitle, groupId);
    await page.goto(`/post/${postId}`);
    await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible();
    const post = new PostPage(page);
    await post.openActions();
    for (const action of [/Прикрепить пост/, /Репост/, /Копировать ссылку/, /Редактировать(?: пост)?/, /Удалить пост/]) {
      await expect(page.getByRole('menuitem', { name: action })).toBeVisible();
    }
    await page.getByRole('menuitem', { name: 'Прикрепить пост', exact: true }).click();
    const confirmPin = page.getByRole('menuitem', { name: 'Прикрепить пост?', exact: true });
    if (await confirmPin.isVisible()) await confirmPin.click();

    await page.goto(`/group/${groupId}/posts`);
    const pinnedHeading = page.getByRole('heading', { name: title, exact: true }).first();
    const newerHeading = page.getByRole('heading', { name: secondTitle, exact: true }).first();
    await expect(pinnedHeading).toBeVisible();
    await expect(newerHeading).toBeVisible();
    await expect.poll(async () => pinnedHeading.evaluate(
      (element, newer) => Boolean(element.compareDocumentPosition(newer) & Node.DOCUMENT_POSITION_FOLLOWING),
      await newerHeading.elementHandle(),
    )).toBe(true);

    const pinnedTab = page.getByRole('button', { name: /Закрепл[её]нные публикации/i }).filter({ visible: true });
    await expect(pinnedTab).toBeVisible();
    await pinnedTab.click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: secondTitle, exact: true })).toHaveCount(0);

    await page.goto(`/post/${postId}`);
    await post.openActions();
    await page.getByRole('menuitem', { name: /Открепить пост/ }).click();
    const confirmUnpin = page.getByRole('menuitem', { name: 'Открепить пост?', exact: true });
    if (await confirmUnpin.isVisible()) await confirmUnpin.click();
    await page.goto(`/group/${groupId}/posts`);
    await page.getByRole('button', { name: /Закрепл[её]нные публикации/i }).filter({ visible: true }).click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);

    await page.goto(`/post/${postId}`);
    await post.openActions();
    await expect(page.getByRole('menuitem', { name: 'Прикрепить пост', exact: true })).toBeVisible();
  } finally {
    await deleteTemporaryPostViaApi(page, secondPostId);
    await deleteTemporaryPostViaApi(page, postId);
    await deleteTemporaryGroupViaApi(page, groupId);
  }
});

test('ESN-121: перемещает раннюю закреплённую публикацию наверх @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Тест создаёт временную группу и пять публикаций');
  test.fail(true, 'Dev показывает действие «Переместить наверх», но не меняет порядок закреплённых публикаций');
  test.setTimeout(180_000);
  const groupName = uniqueMarker('GROUP');
  const titles = Array.from({ length: 5 }, (_, index) => `${uniqueMarker('POST')}-PIN-${index + 1}`);
  let groupId: string | undefined;
  const postIds: string[] = [];
  const pinnedIndexes = [1, 3, 4];
  const pin = async (postId: string) => {
    await page.goto(`/post/${postId}`);
    await new PostPage(page).openActions();
    await page.getByRole('menuitem', { name: 'Прикрепить пост', exact: true }).click();
    const confirmation = page.getByRole('menuitem', { name: 'Прикрепить пост?', exact: true });
    if (await confirmation.isVisible()) await confirmation.click();
  };
  const appearsBefore = async (left: import('@playwright/test').Locator, right: import('@playwright/test').Locator) => left.evaluate(
    (element, other) => Boolean(element.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING),
    await right.elementHandle(),
  );

  try {
    groupId = await createTemporaryGroupViaApi(page, groupName, 'Публичная группа');
    for (const title of titles) postIds.push(await createTemporaryPostViaApi(page, title, groupId));
    for (const index of pinnedIndexes) {
      await pin(postIds[index]);
      await page.waitForTimeout(1_100);
    }

    await page.goto(`/group/${groupId}/posts`);
    const publications = page.getByRole('button', { name: 'Публикации', exact: true }).filter({ visible: true });
    const pinnedTab = page.getByRole('button', { name: /Закрепл[её]нные публикации/i }).filter({ visible: true });
    await expect(publications).toBeVisible();
    await pinnedTab.click();
    const pinnedHeadings = pinnedIndexes.map((index) => page.getByRole('heading', { name: titles[index], exact: true }));
    for (const heading of pinnedHeadings) await expect(heading).toBeVisible();

    await page.goto(`/post/${postIds[pinnedIndexes[0]]}`);
    await new PostPage(page).openActions();
    for (const action of ['Открепить пост', 'Переместить наверх', 'Удалить пост']) {
      await expect(page.getByRole('menuitem', { name: action, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('menuitem', { name: /Редактировать/ })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Переместить наверх', exact: true }).click();

    await page.goto(`/group/${groupId}/posts`);
    await pinnedTab.click();
    const moved = page.getByRole('heading', { name: titles[pinnedIndexes[0]], exact: true });
    const formerlyTop = page.getByRole('heading', { name: titles[pinnedIndexes[2]], exact: true });
    await expect.poll(() => appearsBefore(moved, formerlyTop)).toBe(true);

    await publications.click();
    const wallMoved = page.getByRole('heading', { name: titles[pinnedIndexes[0]], exact: true });
    await expect(wallMoved).toBeVisible();
    const otherVisibleHeadings = titles.filter((_, index) => index !== pinnedIndexes[0])
      .map((title) => page.getByRole('heading', { name: title, exact: true }).filter({ visible: true }));
    for (const heading of otherVisibleHeadings) {
      if (await heading.count()) await expect.poll(() => appearsBefore(wallMoved, heading.first())).toBe(true);
    }
  } finally {
    for (const postId of postIds) await deleteTemporaryPostViaApi(page, postId);
    await deleteTemporaryGroupViaApi(page, groupId);
  }
});

test('ESN-124: последняя закреплённая публикация находится сверху списка @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Тест создаёт временную группу и публикации');
  test.setTimeout(120_000);
  const groupName = uniqueMarker('GROUP');
  const titles = [`${uniqueMarker('POST')}-FIRST-PIN`, `${uniqueMarker('POST')}-LAST-PIN`];
  let groupId: string | undefined;
  const postIds: string[] = [];
  try {
    groupId = await createTemporaryGroupViaApi(page, groupName, 'Публичная группа');
    for (const title of titles) postIds.push(await createTemporaryPostViaApi(page, title, groupId));
    for (const postId of postIds) {
      await page.goto(`/post/${postId}`);
      await new PostPage(page).openActions();
      await page.getByRole('menuitem', { name: 'Прикрепить пост', exact: true }).click();
      const confirmation = page.getByRole('menuitem', { name: 'Прикрепить пост?', exact: true });
      if (await confirmation.isVisible()) await confirmation.click();
      await page.waitForTimeout(1_100);
    }
    await page.goto(`/group/${groupId}/posts`);
    await page.getByRole('button', { name: /Закрепл[её]нные публикации/i }).filter({ visible: true }).click();
    const first = page.getByRole('heading', { name: titles[0], exact: true });
    const last = page.getByRole('heading', { name: titles[1], exact: true });
    await expect(first).toBeVisible();
    await expect(last).toBeVisible();
    const firstHandle = await first.elementHandle();
    await expect.poll(() => last.evaluate(
      (element, other) => Boolean(element.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING),
      firstHandle,
    )).toBe(true);
  } finally {
    for (const postId of postIds) await deleteTemporaryPostViaApi(page, postId);
    await deleteTemporaryGroupViaApi(page, groupId);
  }
});
