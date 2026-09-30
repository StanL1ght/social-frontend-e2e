import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { createTemporaryGroupViaApi, deleteTemporaryGroupViaApi } from '../helpers/group-api';
import { createTemporaryPostViaApi, deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { GroupPage } from '../pages/GroupPage';
import { GroupsPage } from '../pages/GroupsPage';
import { PostComposerPage } from '../pages/PostComposerPage';

test.describe('@mutation Жизненный цикл группы', () => {
  test.skip(!env.runMutationTests, 'Для запуска установите RUN_MUTATION_TESTS=true');

  test('ESN-115, ESN-117: создать публичную группу с изображением и удалить её через UI @critical', async ({ page }) => {
    const name = uniqueMarker('GROUP');
    const description = 'Автоматическая E2E-проверка. Группа будет удалена после теста.';
    let groupUrl: string | undefined;
    let deleted = false;

    try {
      const groups = new GroupsPage(page);
      await groups.open();
      await groups.createPublicGroup(name, description, {
        name: 'qa-e2e-group-cover.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xn4tWQAAAABJRU5ErkJggg==',
          'base64',
        ),
      });
      await groups.openOwnedGroup(name);

      groupUrl = page.url();
      await expect(page.getByText('Публичная группа', { exact: true })).toBeVisible();
      await expect(page.getByText('ИТ дивизион', { exact: true })).toBeVisible();
      await expect(page.getByText(description, { exact: true })).toBeVisible();

      for (const tab of [
        'Публикации',
        'Участники',
        'Реакции и комментарии',
        'Опросы',
      ]) {
        await expect(page.getByRole('button', { name: tab, exact: true })).toBeVisible({
          timeout: 20_000,
        });
      }

      await page.getByRole('button', { name: 'Вы администратор', exact: true }).click();
      await expect(page.getByRole('menuitem', { name: 'Пригласить' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Удалить группу' })).toBeVisible();
      await page.keyboard.press('Escape');

      await new GroupPage(page).deleteThroughUi();
      deleted = true;

      await page.goto(groupUrl);
      await expect(page.getByText('Группа не найдена', { exact: true })).toBeVisible({
        timeout: 20_000,
      });

      await page.goto('/group/all');
      const search = page.locator('input[placeholder="Поиск по группам"]');
      await expect(search).toBeVisible();
      const searched = page.waitForResponse((response) =>
        response.request().method() === 'GET' &&
        /\/api\/group\//.test(response.url()) &&
        new URL(response.url()).searchParams.get('name') === name,
      );
      await search.fill(name);
      expect((await searched).ok()).toBe(true);
      await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    } finally {
      if (groupUrl && !deleted) {
        await page.goto(groupUrl);
        if (
          await page
            .getByRole('button', { name: 'Вы администратор', exact: true })
            .isVisible()
        ) {
          await new GroupPage(page).deleteThroughUi();
        }
      }
    }
  });

  test('ESN-142: после удаления группы её публикация исчезает из ленты и по прямой ссылке', async ({ page }) => {
    const groupName = uniqueMarker('GROUP');
    const postTitle = uniqueMarker('POST');
    let groupId: string | undefined;
    let postId: string | undefined;
    let deleted = false;

    try {
      groupId = await createTemporaryGroupViaApi(page, groupName, 'Публичная группа');
      postId = await createTemporaryPostViaApi(page, postTitle, groupId);
      await page.goto(`/group/${groupId}/posts`);
      await expect(page.getByText(postTitle, { exact: true })).toBeVisible();

      await new GroupPage(page).deleteThroughUi();
      deleted = true;

      await page.goto(`/post/${postId}`);
      await expect(page.getByText('Пост не найден', { exact: true })).toBeVisible({ timeout: 20_000 });
      await page.goto('/feed');
      await expect(page.getByText(postTitle, { exact: true })).toHaveCount(0);
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
      if (!deleted) await deleteTemporaryGroupViaApi(page, groupId);
    }
  });

  test('ESN-164: название группы в публикации повторно открывает её страницу', async ({ page }) => {
    const groupName = uniqueMarker('GROUP');
    const postTitle = uniqueMarker('POST');
    let groupId: string | undefined;
    let postId: string | undefined;

    try {
      groupId = await createTemporaryGroupViaApi(page, groupName, 'Публичная группа');
      postId = await createTemporaryPostViaApi(page, postTitle, groupId);
      await page.goto(`/group/${groupId}/posts`);
      const postCard = page.getByRole('heading', { name: postTitle, exact: true })
        .locator('xpath=ancestor::network-post-card[1]');
      const groupLink = postCard.getByRole('link', { name: groupName, exact: true });
      await expect(groupLink).toBeVisible();
      const refreshed = page.waitForResponse((response) =>
        response.request().method() === 'GET' &&
        response.url().includes(`/api/group/${groupId}`) &&
        response.ok(),
      );
      await groupLink.click();
      await refreshed;
      await expect(page).toHaveURL(new RegExp(`/group/${groupId}/posts`));
      await expect(page.getByRole('heading', { name: groupName, exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: postTitle, exact: true })).toBeVisible();
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });

  test('ESN-125: вкладка участников показывает владельца новой группы', async ({ page }) => {
    const groupName = uniqueMarker('GROUP');
    let groupId: string | undefined;

    try {
      const currentResponse = await page.request.get('https://dev-social-backend.sddt.efko.ru/api/user/current');
      expect(currentResponse.ok()).toBe(true);
      const current = (await currentResponse.json()) as { id: string };
      groupId = await createTemporaryGroupViaApi(page, groupName, 'Публичная группа');
      await page.goto(`/group/${groupId}/posts`);
      await expect(page).toHaveURL(new RegExp(`/group/${groupId}/posts`));
      await page.getByRole('button', { name: 'Участники', exact: true }).filter({ visible: true }).click();

      const ownerProfile = page.locator(`a[href="/profile/${current.id}"]`).filter({ visible: true });
      await expect(ownerProfile).toBeVisible();
      const ownerRow = page.locator('div.group-authors__item').filter({ has: ownerProfile });
      await expect(ownerRow).toBeVisible();
      await expect(ownerRow.getByText(/Владелец|Администратор/, { exact: true })).toBeVisible();
    } finally {
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });

  test('ESN-135: администратор публикует запись в группе с правом публикации для всех участников', async ({ page }) => {
    const groupName = uniqueMarker('GROUP');
    const title = `${uniqueMarker('POST')}-ADMIN-SUBSCRIBERS`;
    let groupId: string | undefined;
    let postId: string | undefined;
    try {
      groupId = await createTemporaryGroupViaApi(page, groupName, 'Публичная группа', 'subscribers');
      const groupResponse = await page.request.get(`https://dev-social-backend.sddt.efko.ru/api/group/${groupId}`);
      expect(groupResponse.ok()).toBe(true);
      expect((await groupResponse.json()) as { posting_permission: string }).toMatchObject({
        posting_permission: 'subscribers',
      });

      await page.goto(`/group/${groupId}/posts`);
      await expect(page.getByRole('button', { name: 'Вы администратор', exact: true })).toBeVisible();
      const composer = new PostComposerPage(page);
      await composer.open();
      await composer.selectDestination(groupName);
      await composer.fill(title, 'Публикация администратора при настройке «Все участники».');
      await expect(composer.publishButton()).toBeEnabled();
      const created = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/api\/post\/?(?:\?|$)/.test(response.url()),
      );
      await composer.publishNow();
      postId = ((await (await created).json()) as { id: string }).id;

      await page.goto(`/group/${groupId}/posts`);
      const heading = page.getByRole('heading', { name: title, exact: true });
      await expect(heading).toBeVisible({ timeout: 30_000 });
      const firstPost = page.locator('network-post-card').first().getByRole('heading', { name: title, exact: true });
      await expect(firstPost).toBeVisible();
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });

  test('ESN-150: создаёт закрытую группу с единой обложкой через UI', async ({ page }) => {
    const name = uniqueMarker('GROUP');
    const description = 'Закрытая группа, созданная автоматическим тестом.';
    const cover = {
      name: 'qa-e2e-private-group-cover.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8Dwn4GBgYGJAQoAHgQCAZb2L9sAAAAASUVORK5CYII=', 'base64'),
    };
    let groupId: string | undefined;
    try {
      const groups = new GroupsPage(page);
      await groups.open();
      const created = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/api\/group\/?(?:\?|$)/.test(response.url()),
      );
      await groups.createGroup(name, description, 'Закрытая группа', cover);
      groupId = ((await (await created).json()) as { id: string }).id;
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
      await expect(page.getByText(description, { exact: true })).toBeVisible();
      await expect(page.getByText('Закрытая группа', { exact: true })).toBeVisible();
      const groupImages = page.getByRole('img', { name, exact: true });
      await expect(groupImages).toHaveCount(2);
      await expect.poll(() => groupImages.first().evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);

      await page.goto('/group');
      await expect(page.getByRole('radiogroup').getByRole('button', { name: 'Вы подписаны', exact: true })).toBeVisible();
      await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 30_000 });
      await page.getByText(name, { exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/group/${groupId}/posts`));
      await expect(page.getByText('Закрытая группа', { exact: true })).toBeVisible();
      await expect(page.getByText(description, { exact: true })).toBeVisible();
    } finally {
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });

  test('ESN-151: создаёт скрытую группу через UI', async ({ page }) => {
    const name = uniqueMarker('GROUP');
    const description = 'Скрытая группа, созданная автоматическим тестом.';
    const cover = {
      name: 'qa-e2e-hidden-group-cover.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8Dwn4GBgYGJAQoAHgQCAZb2L9sAAAAASUVORK5CYII=', 'base64'),
    };
    let groupId: string | undefined;
    try {
      const groups = new GroupsPage(page);
      await groups.open();
      const created = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/api\/group\/?(?:\?|$)/.test(response.url()),
      );
      await groups.createGroup(name, description, 'Скрытая группа', cover);
      const response = await created;
      expect(response.ok()).toBe(true);
      groupId = ((await response.json()) as { id: string }).id;
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
      await expect(page.getByText('Скрытая группа', { exact: true })).toBeVisible();
      await expect(page.getByText(description, { exact: true })).toBeVisible();
      const groupImages = page.getByRole('img', { name, exact: true });
      await expect(groupImages).toHaveCount(2);
      await page.goto('/group');
      await expect(page.getByRole('radiogroup').getByRole('button', { name: 'Вы подписаны', exact: true })).toBeVisible();
      await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 30_000 });
      await page.getByText(name, { exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/group/${groupId}/posts`));
    } finally {
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });
});
