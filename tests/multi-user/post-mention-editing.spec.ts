import { test, expect } from '@playwright/test';
import { env, hasMultiUserEnvironment } from '../helpers/env';
import { deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { LoginPage } from '../pages/LoginPage';
import { PostComposerPage } from '../pages/PostComposerPage';
import { PostPage } from '../pages/PostPage';

const apiBase = 'https://dev-social-backend.sddt.efko.ru/api';

test('ESN-411 — упоминание второго пользователя сохраняется после редактирования @multiuser @mutation', async ({
  browser,
}) => {
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два пользователя и mutation-режим');
  test.setTimeout(120_000);
  const authorContext = await browser.newContext({ baseURL: env.baseURL });
  const mentionedContext = await browser.newContext({ baseURL: env.baseURL });
  let postId: string | undefined;

  try {
    const authorPage = await authorContext.newPage();
    const mentionedPage = await mentionedContext.newPage();
    await new LoginPage(authorPage).login(env.email, env.password);
    await new LoginPage(mentionedPage).login(env.memberEmail, env.memberPassword);

    const currentResponse = await mentionedPage.request.get(`${apiBase}/user/current`);
    expect(currentResponse.ok()).toBe(true);
    const mentioned = (await currentResponse.json()) as {
      id: string;
      first_name: string;
      last_name: string;
    };
    const fullName = `${mentioned.first_name} ${mentioned.last_name}`.trim();
    const title = uniqueMarker('POST');

    await authorPage.goto('/feed');
    const composer = new PostComposerPage(authorPage);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.fill(title, 'Упоминание пользователя: ');
    await authorPage.keyboard.type(`@${mentioned.first_name}`);
    const suggestion = authorPage
      .getByRole('option')
      .filter({ hasText: new RegExp(`${mentioned.first_name}.*${mentioned.last_name}`, 'i'), visible: true })
      .first();
    await expect(suggestion).toBeVisible({ timeout: 20_000 });
    await suggestion.click();
    await expect(composer.editor.locator('a').filter({ hasText: fullName })).toBeVisible();

    const created = authorPage.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;
    await authorPage.goto(`/post/${postId}`);

    const mentionLink = authorPage.locator(`a[href="/profile/${mentioned.id}"]`).filter({ hasText: fullName });
    await expect(mentionLink).toBeVisible();
    await mentionLink.click();
    await expect(authorPage).toHaveURL(new RegExp(`/profile/${mentioned.id}(?:[/?#]|$)`));

    await authorPage.goto(`/post/${postId}`);
    await new PostPage(authorPage).openEditor();
    const editor = new PostComposerPage(authorPage);
    await expect(editor.editor.locator('a').filter({ hasText: fullName })).toBeVisible();
    const endShortcut = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
    await editor.editor.press(endShortcut);
    await authorPage.keyboard.insertText(' Упоминание сохранено после редактирования.');
    await editor.saveChanges();

    await authorPage.goto(`/post/${postId}`);
    await expect(authorPage.locator(`a[href="/profile/${mentioned.id}"]`).filter({ hasText: fullName })).toBeVisible();
    await expect(authorPage.getByText('Упоминание сохранено после редактирования.', { exact: false })).toBeVisible();
  } finally {
    const authorPage = authorContext.pages()[0];
    if (authorPage) await deleteTemporaryPostViaApi(authorPage, postId);
    await mentionedContext.close();
    await authorContext.close();
  }
});
