import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { PostComposerPage } from '../pages/PostComposerPage';
import { createTemporaryGroupViaApi, deleteTemporaryGroupViaApi } from '../helpers/group-api';
import { deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';

test.describe('Редактор публикации: форматирование и вставки', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/feed');
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.replaceTitle('QA-E2E-EDITOR-CHECK');
  });

  test.afterEach(async ({ page }) => {
    await new PostComposerPage(page).discard();
  });

  test('сохраняет семантику полужирного и курсивного текста в DOM', async ({ page }) => {
    const composer = new PostComposerPage(page);
    const endShortcut = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

    await composer.editor.press(endShortcut);
    await composer.editor.press('Enter');
    await composer.editor.press(`${modifier}+b`);
    await page.keyboard.type('Полужирный');
    await composer.editor.press(`${modifier}+b`);
    await page.keyboard.type(' ');
    await composer.editor.press(`${modifier}+i`);
    await page.keyboard.type('Курсив');
    await composer.editor.press(`${modifier}+i`);

    await expect(composer.editor.locator('strong')).toHaveText('Полужирный');
    await expect(composer.editor.locator('em')).toHaveText('Курсив');
  });

  test('слеш-команда открывает каталог вставок', async ({ page }) => {
    const composer = new PostComposerPage(page);
    const endShortcut = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
    await composer.editor.press(endShortcut);
    await composer.editor.press('Enter');
    await page.keyboard.type('/');
    await expect(page.getByRole('option').filter({ visible: true }).first()).toBeVisible();
  });

  test('упоминание открывает список подходящих пользователей', async ({ page }) => {
    const composer = new PostComposerPage(page);
    const endShortcut = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';

    await composer.editor.press(endShortcut);
    await composer.editor.press('Enter');
    await page.keyboard.type(`@${env.mentionQuery}`);

    const suggestion = page
      .getByRole('option')
      .filter({ hasText: new RegExp(env.mentionQuery, 'i'), visible: true })
      .first();
    await expect(suggestion).toBeVisible({ timeout: 15_000 });
  });

  test('ESN-428: упоминание группы публикуется и открывает страницу группы @mutation', async ({ page }) => {
    test.skip(!env.runMutationTests, 'Сценарий создаёт временную группу и публикацию');
    test.fail(true, 'Редактор dev предлагает для @-упоминания только пользователей; группы отсутствуют в выдаче');
    const groupName = `${uniqueMarker('GROUP-PUBLIC')}-MENTION`;
    const title = `${uniqueMarker('POST')}-GROUP-MENTION`;
    let groupId: string | undefined;
    let postId: string | undefined;
    try {
      groupId = await createTemporaryGroupViaApi(page, groupName, 'Публичная группа');
      const composer = new PostComposerPage(page);
      await composer.replaceTitle(title);
      await composer.editor.locator('p').first().fill('Упоминание группы: ');
      await composer.editor.press('End');
      await page.keyboard.type(`@${groupName}`);
      const suggestion = page.getByRole('option').filter({ hasText: groupName, visible: true }).first();
      await expect(suggestion).toBeVisible({ timeout: 20_000 });
      await suggestion.click();
      const editorMention = composer.editor.locator(`a[href="/group/${groupId}"]`).filter({ hasText: groupName });
      await expect(editorMention).toBeVisible();

      const created = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
      );
      await composer.publishNow();
      postId = ((await (await created).json()) as { id: string }).id;
      await page.goto(`/post/${postId}`);
      const publishedMention = page.locator(`a[href="/group/${groupId}"]`).filter({ hasText: groupName });
      await expect(publishedMention).toBeVisible();
      await publishedMention.click();
      await expect(page).toHaveURL(new RegExp(`/group/${groupId}(?:[/?#]|$)`));
      await expect(page.getByText(groupName, { exact: true }).first()).toBeVisible();
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });
});
