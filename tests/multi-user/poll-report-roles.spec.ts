import { test, expect } from '@playwright/test';
import { env, hasMultiUserEnvironment } from '../helpers/env';
import { createTemporaryGroupViaApi, deleteTemporaryGroupViaApi, joinTemporaryGroupViaApi } from '../helpers/group-api';
import { deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { LoginPage } from '../pages/LoginPage';
import { PostComposerPage } from '../pages/PostComposerPage';
import { PostPage } from '../pages/PostPage';
import { execFileSync } from 'node:child_process';

const apiBase = 'https://dev-social-backend.sddt.efko.ru/api';

test('ESN-524: отчёт результатов опроса доступен владельцу и админу, но не автору и подписчику @multiuser @mutation', async ({ browser }) => {
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два пользователя и mutation-режим');
  test.setTimeout(180_000);
  const ownerContext = await browser.newContext({ baseURL: env.baseURL });
  const memberContext = await browser.newContext({ baseURL: env.baseURL });
  const ownerPage = await ownerContext.newPage();
  const memberPage = await memberContext.newPage();
  const groupName = uniqueMarker('GROUP');
  const title = `${uniqueMarker('POST')}-POLL-REPORT`;
  let groupId: string | undefined;
  let postId: string | undefined;
  try {
    await new LoginPage(ownerPage).login(env.email, env.password);
    await new LoginPage(memberPage).login(env.memberEmail, env.memberPassword);
    groupId = await createTemporaryGroupViaApi(ownerPage, groupName, 'Публичная группа');
    await joinTemporaryGroupViaApi(memberPage, groupId);
    const current = await memberPage.request.get(`${apiBase}/user/current`);
    expect(current.ok()).toBe(true);
    const member = await current.json() as { id: string };

    await ownerPage.goto(`/group/${groupId}`);
    const composer = new PostComposerPage(ownerPage);
    await composer.open();
    await composer.selectDestination(groupName);
    await composer.fill(title, 'Опрос для проверки прав на отчёт.');
    await composer.editor.locator('p').last().click();
    await composer.dialog.getByRole('button', { name: 'Опрос', exact: true }).click();
    const question = composer.dialog.getByRole('treeitem').first();
    await question.getByRole('textbox', { name: 'Ваш вопрос' }).fill('Какой ответ выбран?');
    await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(0).fill('Первый ответ');
    await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(1).fill('Второй ответ');
    const created = ownerPage.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;

    await memberPage.goto(`/post/${postId}`);
    const voted = memberPage.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/[^/]+\/polls\/[^/]+\/questions\/[^/]+\/answers\//.test(response.url()),
    );
    await memberPage.getByText('Первый ответ', { exact: true }).click();
    expect((await voted).ok()).toBe(true);

    await ownerPage.goto(`/post/${postId}`);
    await new PostPage(ownerPage).openActions();
    await expect(ownerPage.getByRole('menuitem', { name: 'Результаты опросов', exact: true })).toBeVisible();
    await ownerPage.keyboard.press('Escape');

    const expectReportAccess = async (allowed: boolean) => {
      await memberPage.goto(`/post/${postId}`);
      await new PostPage(memberPage).openActions();
      const report = memberPage.getByRole('menuitem', { name: 'Результаты опросов', exact: true });
      if (allowed) await expect(report).toBeVisible();
      else await expect(report).toHaveCount(0);
      await memberPage.keyboard.press('Escape');
    };
    const setRole = async (administrator: boolean, canPost: boolean) => {
      const updated = await ownerPage.request.put(`${apiBase}/group/${groupId}/members/${member.id}`, {
        data: { administrator, can_post: canPost, can_comment: true },
      });
      expect(updated.ok()).toBe(true);
    };
    await expectReportAccess(false);
    await setRole(false, true);
    await expectReportAccess(false);
    await setRole(true, true);
    await expectReportAccess(true);
  } finally {
    await deleteTemporaryPostViaApi(ownerPage, postId);
    await deleteTemporaryGroupViaApi(ownerPage, groupId);
    await memberContext.close();
    await ownerContext.close();
  }
});

test('ESN-525 (первый опрос): отчёт XLSX открывается и содержит подготовленные ответы @multiuser @mutation', async ({ browser }) => {
  test.fail(true, 'Отчёт содержит только выбранный ответ; невостребованный вариант ответа отсутствует');
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два пользователя и mutation-режим');
  test.setTimeout(150_000);
  const ownerContext = await browser.newContext({ baseURL: env.baseURL, acceptDownloads: true });
  const memberContext = await browser.newContext({ baseURL: env.baseURL });
  const ownerPage = await ownerContext.newPage();
  const memberPage = await memberContext.newPage();
  const groupName = uniqueMarker('GROUP');
  const marker = uniqueMarker('POST');
  const questionText = `${marker}-QUESTION`;
  const firstAnswer = `${marker}-FIRST`;
  const secondAnswer = `${marker}-SECOND`;
  let groupId: string | undefined;
  let postId: string | undefined;
  try {
    await new LoginPage(ownerPage).login(env.email, env.password);
    await new LoginPage(memberPage).login(env.memberEmail, env.memberPassword);
    groupId = await createTemporaryGroupViaApi(ownerPage, groupName, 'Публичная группа');
    await joinTemporaryGroupViaApi(memberPage, groupId);
    await ownerPage.goto(`/group/${groupId}`);
    const composer = new PostComposerPage(ownerPage);
    await composer.open();
    await composer.selectDestination(groupName);
    await composer.fill(marker, 'Данные для отчёта результатов опросов.');
    await composer.editor.locator('p').last().click();
    await composer.dialog.getByRole('button', { name: 'Опрос', exact: true }).click();
    const question = composer.dialog.getByRole('treeitem').first();
    await question.getByRole('textbox', { name: 'Ваш вопрос' }).fill(questionText);
    await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(0).fill(firstAnswer);
    await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(1).fill(secondAnswer);
    const created = ownerPage.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;

    await memberPage.goto(`/post/${postId}`);
    const voted = memberPage.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/[^/]+\/polls\/[^/]+\/questions\/[^/]+\/answers\//.test(response.url()),
      { timeout: 30_000 },
    );
    const answer = memberPage.getByText(firstAnswer, { exact: true });
    await expect(answer).toBeVisible({ timeout: 30_000 });
    await answer.click({ timeout: 30_000 });
    expect((await voted).ok()).toBe(true);
    await ownerPage.goto(`/post/${postId}`);
    await new PostPage(ownerPage).openActions();
    const downloadPromise = ownerPage.waitForEvent('download');
    await ownerPage.getByRole('menuitem', { name: 'Результаты опросов', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/i);
    const path = await download.path();
    expect(path).toBeTruthy();
    const integrity = execFileSync('unzip', ['-t', path!], { encoding: 'utf8' });
    expect(integrity).toContain('No errors detected');
    const entries = execFileSync('unzip', ['-Z', '-1', path!], { encoding: 'utf8' }).trim().split('\n');
    expect(entries).toContain('xl/workbook.xml');
    const content = entries.filter((entry) => /^xl\/(?:sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(entry))
      .map((entry) => execFileSync('unzip', ['-p', path!, entry], { encoding: 'utf8' })).join('\n');
    expect(content.includes(questionText), 'В отчёте присутствует вопрос').toBe(true);
    expect(content.includes(firstAnswer), 'В отчёте присутствует выбранный ответ').toBe(true);
    expect(content.includes(secondAnswer), 'В отчёте присутствует и невыбранный вариант ответа').toBe(true);
  } finally {
    await deleteTemporaryPostViaApi(ownerPage, postId);
    await deleteTemporaryGroupViaApi(ownerPage, groupId);
    await memberContext.close();
    await ownerContext.close();
  }
});
