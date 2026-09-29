import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import { env, hasMultiUserEnvironment } from '../helpers/env';
import { deleteTemporaryGroupViaApi } from '../helpers/group-api';
import { createTemporaryPostViaApi, deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { GroupsPage } from '../pages/GroupsPage';
import { LoginPage } from '../pages/LoginPage';
import { PostComposerPage } from '../pages/PostComposerPage';

async function login(browser: Browser, email: string, password: string): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: env.baseURL, storageState: { cookies: [], origins: [] } });
  await new LoginPage(await context.newPage()).login(email, password);
  return context;
}

test('ESN-145, ESN-147: прямая ссылка и публикация участника скрытой группы @multiuser @mutation', async ({ browser }) => {
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два пользователя и mutation-режим');
  test.setTimeout(150_000);
  const ownerContext = await browser.newContext({ baseURL: env.baseURL, storageState: '.auth/user.json' });
  const memberContext = await login(browser, env.memberEmail, env.memberPassword);
  const ownerPage = await ownerContext.newPage();
  let memberPage = memberContext.pages()[0];
  const groupName = `${uniqueMarker('GROUP')}-HIDDEN`;
  const sourceTitle = `${uniqueMarker('POST')}-HIDDEN-LINK`;
  const memberTitle = `${uniqueMarker('POST')}-HIDDEN-MEMBER`;
  let groupId: string | undefined;
  let sourceId: string | undefined;
  let memberPostId: string | undefined;

  try {
    const groups = new GroupsPage(ownerPage);
    await groups.open();
    const created = ownerPage.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/group\/?(?:\?|$)/.test(response.url()),
    );
    await groups.createGroup(
      groupName,
      'Скрытая группа для проверки прямой ссылки и публикации подписчика.',
      'Скрытая группа',
      undefined,
      'subscribers',
    );
    groupId = ((await (await created).json()) as { id: string }).id;
    sourceId = await createTemporaryPostViaApi(ownerPage, sourceTitle, groupId);

    await memberPage.goto('/feed');
    await expect(memberPage.getByRole('heading', { name: sourceTitle, exact: true })).toHaveCount(0);
    await memberPage.goto(`/post/${sourceId}`);
    await expect(memberPage.getByRole('heading', { name: sourceTitle, exact: true })).toBeVisible();
    await expect(memberPage.getByRole('link', { name: groupName, exact: true }).first()).toBeVisible();

    const currentResponse = await memberPage.request.get('https://dev-social-backend.sddt.efko.ru/api/user/current');
    expect(currentResponse.ok()).toBe(true);
    const member = (await currentResponse.json()) as { id: string; first_name: string };
    await ownerPage.goto(`/group/${groupId}`);
    await ownerPage.getByRole('button', { name: 'Вы администратор', exact: true }).click();
    await ownerPage.getByRole('menuitem', { name: 'Пригласить', exact: true }).click();
    const inviteDialog = ownerPage.getByRole('dialog').filter({ hasText: /Приглас/ }).last();
    await inviteDialog.getByRole('textbox', { name: 'Поиск по ФИО' }).fill(member.first_name);
    const memberLink = inviteDialog.locator(`a[href="/profile/${member.id}"]`).last();
    await expect(memberLink).toBeVisible({ timeout: 20_000 });
    const profileHrefs = await inviteDialog.locator('a[href^="/profile/"]').evaluateAll((links) =>
      [...new Set(links.map((link) => link.getAttribute('href')).filter(Boolean))],
    );
    const candidateIndex = profileHrefs.indexOf(`/profile/${member.id}`);
    expect(candidateIndex).toBeGreaterThanOrEqual(0);
    const invited = ownerPage.waitForResponse((response) =>
      response.request().method() !== 'GET' && response.url().includes(`/api/group/${groupId}`) && /member|invite/i.test(response.url()),
    );
    await inviteDialog.getByRole('button', { name: 'Пригласить', exact: true }).nth(candidateIndex).click();
    expect((await invited).ok()).toBe(true);

    await memberPage.close();
    memberPage = await memberContext.newPage();
    await new LoginPage(memberPage).login(env.memberEmail, env.memberPassword);
    await memberPage.goto(`/group/${groupId}`);
    await expect(memberPage.getByRole('button', { name: 'Вы подписаны', exact: true })).toBeVisible();
    const access = await memberPage.request.get(`https://dev-social-backend.sddt.efko.ru/api/group/${groupId}`);
    expect(await access.json()).toMatchObject({ is_member: true, can_post: true, posting_permission: 'subscribers' });

    const composer = new PostComposerPage(memberPage);
    await composer.open();
    await composer.selectDestination(groupName);
    await composer.fill(memberTitle, 'Публикация участника скрытой группы.');
    const published = memberPage.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    memberPostId = ((await (await published).json()) as { id: string }).id;
    await memberPage.goto(`/group/${groupId}`);
    await expect(memberPage.getByRole('heading', { name: memberTitle, exact: true })).toBeVisible({ timeout: 20_000 });
  } finally {
    await deleteTemporaryPostViaApi(ownerPage, memberPostId);
    await deleteTemporaryPostViaApi(ownerPage, sourceId);
    await deleteTemporaryGroupViaApi(ownerPage, groupId);
    await memberContext.close();
    await ownerContext.close();
  }
});
