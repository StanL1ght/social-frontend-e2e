import { expect, test } from '../fixtures/test';
import type { Page } from '@playwright/test';
import { env } from '../helpers/env';
import { deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { PostComposerPage } from '../pages/PostComposerPage';

async function createTaggedPost(page: Page, title: string, tag: string): Promise<string> {
  await page.goto('/feed');
  const composer = new PostComposerPage(page);
  await composer.open();
  await composer.selectDestination('Моя лента');
  await composer.fill(title, 'Временная публикация для проверки ленты хештега.');
  await composer.dialog.getByRole('button', { name: 'Теги', exact: true }).click();
  const tagInput = composer.dialog.getByRole('textbox', { name: 'Теги' });
  await tagInput.fill(tag);
  await tagInput.press('Enter');
  const created = page.waitForResponse(
    (response) => response.request().method() === 'POST' && /\/api\/post\/?(?:\?|$)/i.test(response.url()),
  );
  await composer.publishNow();
  const response = await created;
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { id: string }).id;
}

test.describe('@mutation Хештеги публикации', () => {
  test.skip(!env.runMutationTests, 'Для публикации нужен mutation-режим');

  test('ESN-107, ESN-111, ESN-348: создаёт несколько хештегов и открывает их ленты', async ({ page }) => {
    const title = `${uniqueMarker('POST')}-HASHTAGS`;
    const suffix = Date.now().toString(36);
    const tags = [`qatag${suffix}a`, `qatag${suffix}b`];
    let postId: string | undefined;

    try {
      await page.goto('/feed');
      const composer = new PostComposerPage(page);
      await composer.open();
      await composer.selectDestination('Моя лента');
      await composer.fill(title, 'Проверка нескольких хештегов и перехода в их ленты.');

      await composer.dialog.getByRole('button', { name: 'Теги', exact: true }).click();
      const tagInput = composer.dialog.getByRole('textbox').filter({ visible: true }).last();
      await expect(tagInput).toBeVisible();
      for (const tag of tags) {
        await tagInput.fill(tag);
        await tagInput.press('Enter');
        await expect(composer.dialog.getByRole('button', { name: `#${tag}`, exact: true })).toBeVisible();
      }

      const created = page.waitForResponse(
        (response) => response.request().method() === 'POST' && /\/api\/post\/?(?:\?|$)/i.test(response.url()),
      );
      await composer.publishNow();
      const response = await created;
      expect(response.ok()).toBe(true);
      postId = ((await response.json()) as { id: string }).id;

      await page.goto(`/post/${postId}`);
      const card = page.getByRole('heading', { name: title, exact: true })
        .locator('xpath=ancestor::network-post-card[1]');
      for (const tag of tags) {
        await expect(card.getByRole('link', { name: `#${tag}`, exact: true })).toBeVisible();
      }

      for (const tag of tags) {
        await card.getByRole('link', { name: `#${tag}`, exact: true }).click();
        await expect(page).toHaveURL(/\/hashtag\/[0-9a-f-]+(?:[/?#]|$)/i);
        await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: 20_000 });
        await page.goto(`/post/${postId}`);
      }
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

  test('ESN-109: удаляет хештег при редактировании публикации', async ({ page }) => {
    const title = `${uniqueMarker('POST')}-REMOVE-HASHTAG`;
    const tag = `qatag${Date.now().toString(36)}remove`;
    let postId: string | undefined;

    try {
      await page.goto('/feed');
      const composer = new PostComposerPage(page);
      await composer.open();
      await composer.selectDestination('Моя лента');
      await composer.fill(title, 'Проверка удаления хештега при редактировании.');
      await composer.dialog.getByRole('button', { name: 'Теги', exact: true }).click();
      const tagInput = composer.dialog.getByRole('textbox', { name: 'Теги' });
      await tagInput.fill(tag);
      await tagInput.press('Enter');
      await expect(composer.dialog.getByRole('button', { name: `#${tag}`, exact: true })).toBeVisible();

      const created = page.waitForResponse(
        (response) => response.request().method() === 'POST' && /\/api\/post\/?(?:\?|$)/i.test(response.url()),
      );
      await composer.publishNow();
      postId = ((await (await created).json()) as { id: string }).id;
      await page.goto(`/post/${postId}`);
      const card = page.getByRole('heading', { name: title, exact: true })
        .locator('xpath=ancestor::network-post-card[1]');
      await expect(card.getByRole('link', { name: `#${tag}`, exact: true })).toBeVisible();

      await card.getByRole('button', { name: 'Действия', exact: true }).click();
      await page.getByRole('menuitem', { name: /Редактировать(?: пост)?/ }).click();
      const editor = new PostComposerPage(page);
      await expect(editor.dialog).toBeVisible();
      const tagsButton = editor.dialog.getByRole('button', { name: 'Теги', exact: true });
      if ((await tagsButton.getAttribute('aria-expanded')) !== 'true') await tagsButton.click();
      await editor.dialog.getByRole('button', { name: `#${tag}`, exact: true }).click();
      await expect(editor.dialog.getByRole('button', { name: `#${tag}`, exact: true })).toBeHidden();
      await editor.saveChanges();

      await page.reload();
      const updatedCard = page.getByRole('heading', { name: title, exact: true })
        .locator('xpath=ancestor::network-post-card[1]');
      await expect(updatedCard.getByRole('link', { name: `#${tag}`, exact: true })).toHaveCount(0);
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

  test('ESN-108: удалённая публикация исчезает из ленты хештега', async ({ page }) => {
    const tag = `qatag${Date.now().toString(36)}delete`;
    const firstTitle = `${uniqueMarker('POST')}-HASHTAG-FIRST`;
    const secondTitle = `${uniqueMarker('POST')}-HASHTAG-SECOND`;
    let firstId: string | undefined;
    let secondId: string | undefined;

    try {
      firstId = await createTaggedPost(page, firstTitle, tag);
      secondId = await createTaggedPost(page, secondTitle, tag);
      await page.goto(`/post/${firstId}`);
      const hashtagLink = page.getByRole('link', { name: `#${tag}`, exact: true });
      const hashtagPath = await hashtagLink.getAttribute('href');
      expect(hashtagPath).toMatch(/^\/hashtag\//);
      await hashtagLink.click();
      await expect(page.getByRole('heading', { name: firstTitle, exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('heading', { name: secondTitle, exact: true })).toBeVisible({ timeout: 20_000 });

      await page.goto(`/post/${firstId}`);
      await page.getByRole('button', { name: 'Действия', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Удалить пост', exact: true }).click();
      const deleted = page.waitForResponse((response) =>
        response.request().method() === 'DELETE' && /\/api\/post\/?(?:[0-9a-f-]+)?(?:\?|$)/i.test(response.url()),
      );
      await page.getByRole('menuitem', { name: /Удаляем\?|Удалить пост/ }).click();
      expect((await deleted).ok()).toBe(true);
      firstId = undefined;
      await page.goto(hashtagPath!);
      await expect(page.getByRole('heading', { name: firstTitle, exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: secondTitle, exact: true })).toBeVisible({ timeout: 20_000 });
    } finally {
      await deleteTemporaryPostViaApi(page, firstId);
      await deleteTemporaryPostViaApi(page, secondId);
    }
  });
});
