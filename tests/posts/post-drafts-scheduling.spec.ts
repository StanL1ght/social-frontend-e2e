import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { uniqueMarker } from '../helpers/test-data';
import { PostComposerPage } from '../pages/PostComposerPage';
import { deleteTemporaryPostViaApi } from '../helpers/post-api';

async function deleteDraftByTitle(page: import('@playwright/test').Page, title: string): Promise<void> {
  await page.goto('/my-publications/drafts');
  const heading = page.getByRole('heading', { name: title, exact: true });
  if (!(await heading.isVisible().catch(() => false))) return;
  await page.getByRole('button', { name: 'Действия', exact: true }).filter({ visible: true }).click();
  await page.getByRole('menuitem', { name: 'Удалить пост', exact: true }).click();
  const confirmation = page.getByRole('menuitem', { name: /Удаляем\?|Удалить пост/ });
  const deleted = page.waitForResponse((response) =>
    response.request().method() === 'DELETE' && /\/api\/post\//.test(response.url()),
  );
  await confirmation.click();
  expect((await deleted).ok()).toBe(true);
  await expect(heading).toBeHidden();
}

test.describe('@mutation Черновики и планирование', () => {
  test.skip(!env.runMutationTests, 'Сценарии создают временные публикации');

  test('ESN-429 — сохраняет публикацию в черновики и показывает её в списке', async ({ page }) => {
    const title = uniqueMarker('POST');
    try {
      await page.goto('/feed');
      const composer = new PostComposerPage(page);
      await composer.open();
      await composer.selectDestination('Моя лента');
      await composer.fill(title, 'Временный черновик для E2E-проверки.');

      const saveDraft = composer.dialog.getByRole('button', {
        name: 'Сохранить в черновики',
        exact: true,
      });
      await expect(saveDraft).toBeEnabled();
      await saveDraft.click();
      await expect(composer.dialog).toBeHidden();
      await expect(page).toHaveURL(/\/my-publications\/drafts(?:[/?#]|$)/);
      const heading = page.getByRole('heading', { name: title, exact: true });
      await expect(heading).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await deleteDraftByTitle(page, title);
    }
  });

  test('ESN-492 — возобновляет сохранённый черновик и публикует его', async ({ page }) => {
    const title = uniqueMarker('POST');
    const draftBody = 'Содержимое возобновляемого черновика.';
    const resumedSuffix = ' Дополнение перед публикацией.';
    let postId: string | undefined;
    try {
      await page.goto('/feed');
      const composer = new PostComposerPage(page);
      await composer.open();
      await composer.selectDestination('Моя лента');
      await composer.fill(title, draftBody);
      await composer.dialog.getByRole('button', { name: 'Сохранить в черновики', exact: true }).click();
      await expect(page).toHaveURL(/\/my-publications\/drafts(?:[/?#]|$)/);

      const heading = page.getByRole('heading', { name: title, exact: true });
      await expect(heading).toBeVisible();
      const draftCard = heading.locator('xpath=ancestor::network-post-card[1]');
      await draftCard.getByRole('button', { name: 'Действия', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Продолжить', exact: true }).click();
      const resumed = new PostComposerPage(page);
      await expect(resumed.dialog).toBeVisible();
      await expect(resumed.titleBlock).toHaveText(title);
      await expect(resumed.editor).toContainText(draftBody);
      await resumed.editor.locator('p').last().click();
      await page.keyboard.press('End');
      await page.keyboard.insertText(resumedSuffix);
      const published = page.waitForResponse((response) =>
        ['POST', 'PUT', 'PATCH'].includes(response.request().method()) && /\/api\/post\/?(?:\?|$)/.test(response.url()),
      );
      await resumed.publishNow();
      const response = await published;
      expect(response.ok()).toBe(true);
      postId = ((await response.json()) as { id: string }).id;
      await page.goto(`/post/${postId}`);
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(page.getByText(`${draftBody}${resumedSuffix}`, { exact: false })).toBeVisible();
      await page.goto('/my-publications/drafts');
      await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
      if (!postId) await deleteDraftByTitle(page, title);
    }
  });

  test('ESN-430 — планирует публикацию на допустимое будущее время', async ({ page }) => {
    const title = uniqueMarker('POST');
    let scheduledId: string | undefined;

    try {
      await page.goto('/feed');
      const composer = new PostComposerPage(page);
      await composer.open();
      await composer.selectDestination('Моя лента');
      await composer.fill(title, 'Временная запланированная публикация для E2E.');
      await composer.dialog.getByRole('button', { name: 'В точное время', exact: true }).click();

      const scheduling = page.getByRole('dialog', { name: /Публикация в точное время/ });
      await expect(scheduling).toBeVisible();
      const future = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const date = [
        future.getFullYear(),
        String(future.getMonth() + 1).padStart(2, '0'),
        String(future.getDate()).padStart(2, '0'),
      ].join('-');
      await scheduling.locator('input[type="date"]').fill(date);
      await scheduling.locator('input[type="time"]').fill('12:34');
      const confirm = scheduling.getByRole('button', {
        name: 'Опубликовать в указанное время',
        exact: true,
      });
      await expect(confirm).toBeEnabled();

      const scheduled = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/api\/scheduled-post\/?(?:\?|$)/.test(response.url()),
      );
      await confirm.click();
      const response = await scheduled;
      expect(response.ok()).toBe(true);
      const data = (await response.json()) as { id?: string };
      scheduledId = data.id;
      await expect(composer.dialog).toBeHidden();
      await page.goto('/my-publications/scheduled');
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: 20_000 });
    } finally {
      if (scheduledId) {
        const cleanup = await page.request.delete(
          `https://dev-social-backend.sddt.efko.ru/api/scheduled-post/${scheduledId}`,
        );
        expect([200, 204, 404].includes(cleanup.status()), 'Очистка запланированной публикации').toBe(true);
      }
    }
  });

  test('ESN-493 — запланированная публикация появляется один раз в заданное время', async ({ page }) => {
    test.setTimeout(300_000);
    const title = `${uniqueMarker('POST')}-SCHEDULED-DELIVERY`;
    let scheduledId: string | undefined;
    let publishedId: string | undefined;
    try {
      await page.goto('/feed');
      const composer = new PostComposerPage(page);
      await composer.open();
      await composer.selectDestination('Моя лента');
      await composer.fill(title, 'Публикация должна появиться автоматически и без дубликатов.');
      await composer.dialog.getByRole('button', { name: 'В точное время', exact: true }).click();
      const scheduling = page.getByRole('dialog', { name: /Публикация в точное время/ });
      const { date, time } = await page.evaluate(() => {
        const future = new Date(Date.now() + 2 * 60 * 1000);
        return {
          date: `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`,
          time: `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`,
        };
      });
      await scheduling.locator('input[type="date"]').fill(date);
      await scheduling.locator('input[type="time"]').fill(time);
      const scheduled = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/api\/scheduled-post\/?(?:\?|$)/.test(response.url()),
      );
      await scheduling.getByRole('button', { name: 'Опубликовать в указанное время', exact: true }).click();
      const response = await scheduled;
      expect(response.ok()).toBe(true);
      scheduledId = ((await response.json()) as { id?: string }).id;

      await page.goto('/my-publications/scheduled');
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await page.goto('/my-publications/published');
      await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);

      await expect.poll(async () => {
        await page.goto('/my-publications/published');
        const matchingPosts = page.getByRole('heading', { name: title, exact: true });
        await matchingPosts.first().waitFor({ state: 'visible', timeout: 6_000 }).catch(() => undefined);
        return matchingPosts.count();
      }, { timeout: 240_000, intervals: [10_000] }).toBe(1);

      const heading = page.getByRole('heading', { name: title, exact: true });
      await expect(heading).toHaveCount(1);
      const href = await heading.evaluate((node) => {
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          const link = parent.querySelector<HTMLAnchorElement>('a[href*="/post/"]');
          if (link) return link.getAttribute('href');
        }
        return null;
      });
      expect(href, 'Ссылка на опубликованный пост нужна для очистки тестовых данных').toBeTruthy();
      publishedId = href?.match(/\/post\/([^/?#]+)/)?.[1];
      await page.reload();
      await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(1);
    } finally {
      await deleteTemporaryPostViaApi(page, publishedId);
      if (scheduledId && !publishedId) {
        // После публикации scheduled-post уже не удаляется этим endpoint (405).
        // Не маскируем им результат основной проверки.
        await page.request.delete(`https://dev-social-backend.sddt.efko.ru/api/scheduled-post/${scheduledId}`);
      }
    }
  });

  test('ESN-527 @slow — за пять минут нельзя редактировать, отменённая запись не публикуется', async ({ page }) => {
    test.setTimeout(360_000);
    const title = `${uniqueMarker('POST')}-CANCEL-SCHEDULE`;
    let scheduledId: string | undefined;
    try {
      await page.goto('/feed');
      const composer = new PostComposerPage(page);
      await composer.open();
      await composer.selectDestination('Моя лента');
      await composer.fill(title, 'Эта запланированная публикация будет отменена.');
      await composer.dialog.getByRole('button', { name: 'В точное время', exact: true }).click();
      const scheduling = page.getByRole('dialog', { name: /Публикация в точное время/ });
      const { date, time, dueAt } = await page.evaluate(() => {
        const future = new Date(Date.now() + 3 * 60 * 1000);
        return {
          date: `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`,
          time: `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`,
          dueAt: future.getTime(),
        };
      });
      await scheduling.locator('input[type="date"]').fill(date);
      await scheduling.locator('input[type="time"]').fill(time);
      const scheduled = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/api\/scheduled-post\/?(?:\?|$)/.test(response.url()),
      );
      await scheduling.getByRole('button', { name: 'Опубликовать в указанное время', exact: true }).click();
      const response = await scheduled;
      expect(response.ok()).toBe(true);
      scheduledId = ((await response.json()) as { id: string }).id;

      await page.goto('/my-publications/scheduled');
      const heading = page.getByRole('heading', { name: title, exact: true });
      await expect(heading).toBeVisible();
      const card = heading.locator('xpath=ancestor::network-post-card[1]');
      await card.getByRole('button', { name: 'Действия', exact: true }).click();
      await expect(page.getByRole('menuitem', { name: /Редактировать/ })).toHaveCount(0);
      const cancel = page.getByRole('menuitem', { name: /Отменить/ });
      await expect(cancel).toBeVisible();
      await cancel.click();
      const confirmation = page.getByRole('menuitem', { name: /Отменить публикацию\?/ });
      await expect(confirmation).toBeVisible();
      await expect(heading).toBeVisible();
      const cancelled = page.waitForResponse((next) =>
        next.request().method() !== 'GET' && next.url().includes(`/api/scheduled-post/${scheduledId}`),
      );
      await confirmation.click();
      expect((await cancelled).ok()).toBe(true);
      await expect(heading).toHaveCount(0);

      await expect.poll(() => Date.now(), { timeout: 300_000, intervals: [10_000] }).toBeGreaterThan(dueAt + 30_000);
      await page.goto('/my-publications/published');
      await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
    } finally {
      if (scheduledId) await page.request.delete(`https://dev-social-backend.sddt.efko.ru/api/scheduled-post/${scheduledId}`);
    }
  });

  test('ESN-528 (частично): раннее редактирование сохраняет исходное расписание', async ({ page }) => {
    test.setTimeout(120_000);
    const originalTitle = `${uniqueMarker('POST')}-SCHEDULE-EDIT`;
    const editedTitle = `${originalTitle}-UPDATED`;
    let scheduledId: string | undefined;
    try {
      await page.goto('/feed');
      const composer = new PostComposerPage(page);
      await composer.open();
      await composer.selectDestination('Моя лента');
      await composer.fill(originalTitle, 'Контент запланированной публикации.');
      await composer.dialog.getByRole('button', { name: 'В точное время', exact: true }).click();
      const scheduling = page.getByRole('dialog', { name: /Публикация в точное время/ });
      const { date, time } = await page.evaluate(() => {
        const future = new Date(Date.now() + 8 * 60 * 1000);
        return {
          date: `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`,
          time: `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`,
        };
      });
      await scheduling.locator('input[type="date"]').fill(date);
      await scheduling.locator('input[type="time"]').fill(time);
      const scheduled = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/api\/scheduled-post\/?(?:\?|$)/.test(response.url()),
      );
      await scheduling.getByRole('button', { name: 'Опубликовать в указанное время', exact: true }).click();
      const response = await scheduled;
      expect(response.ok()).toBe(true);
      scheduledId = ((await response.json()) as { id: string }).id;

      await page.goto('/my-publications/scheduled');
      const heading = page.getByRole('heading', { name: originalTitle, exact: true });
      await expect(heading).toBeVisible();
      const card = heading.locator('xpath=ancestor::network-post-card[1]');
      await card.getByRole('button', { name: 'Действия', exact: true }).click();
      const edit = page.getByRole('menuitem', { name: /Редактировать/ });
      await expect(edit).toBeEnabled();
      await edit.click();
      const editor = new PostComposerPage(page);
      await expect(editor.dialog).toBeVisible();
      await expect(editor.titleBlock).toHaveText(originalTitle);
      await editor.replaceTitle(editedTitle);
      const saved = page.waitForResponse((next) =>
        ['PUT', 'PATCH'].includes(next.request().method()) && next.url().includes(`/api/scheduled-post/${scheduledId}`),
      );
      await editor.dialog.getByRole('button', { name: /Сохранить/ }).click();
      expect((await saved).ok()).toBe(true);
      await expect(editor.dialog).toBeHidden();

      await page.goto('/my-publications/scheduled');
      await expect(page.getByRole('heading', { name: editedTitle, exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: originalTitle, exact: true })).toHaveCount(0);
      await expect(page.locator('.social-tag-chip--post-status').filter({
        hasText: new RegExp(`${date.slice(8, 10)}\\.${date.slice(5, 7)}\\.${date.slice(0, 4)} / ${time}`),
      }).first()).toBeVisible();
      await page.reload();
      await expect(page.getByRole('heading', { name: editedTitle, exact: true })).toBeVisible();
      await expect(page.getByText('Контент запланированной публикации.', { exact: true })).toBeVisible();
    } finally {
      if (scheduledId) await page.request.delete(`https://dev-social-backend.sddt.efko.ru/api/scheduled-post/${scheduledId}`);
    }
  });
});
