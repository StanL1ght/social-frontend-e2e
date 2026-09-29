import { test, expect } from '@playwright/test';
import { env, hasMultiUserEnvironment } from '../helpers/env';
import { createTemporaryGroupViaApi, deleteTemporaryGroupViaApi } from '../helpers/group-api';
import { deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { LoginPage } from '../pages/LoginPage';
import { PostComposerPage } from '../pages/PostComposerPage';

test('ESN-118, ESN-119, ESN-146 — приглашение, публикация и удаление подписчика закрытой группы @multiuser @mutation', async ({ browser }) => {
  test.skip(!hasMultiUserEnvironment, 'Нужны учётные данные второго пользователя');
  test.skip(!env.runMutationTests, 'Приглашение и публикация разрешены только в mutation-режиме');
  test.setTimeout(150_000);

  const ownerContext = await browser.newContext({ baseURL: env.baseURL });
  const memberContext = await browser.newContext({ baseURL: env.baseURL });
  const groupName = uniqueMarker('GROUP-PRIVATE');
  const postTitle = uniqueMarker('POST');
  let groupId: string | undefined;
  let postId: string | undefined;

  try {
    const ownerPage = await ownerContext.newPage();
    await new LoginPage(ownerPage).login(env.email, env.password);
    let memberPage = await memberContext.newPage();
    await new LoginPage(memberPage).login(env.memberEmail, env.memberPassword);
    const currentMemberResponse = await memberPage.request.get(
      'https://dev-social-backend.sddt.efko.ru/api/user/current',
    );
    expect(currentMemberResponse.ok()).toBe(true);
    const currentMember = (await currentMemberResponse.json()) as {
      id: string;
      first_name: string;
      last_name: string;
    };
    groupId = await createTemporaryGroupViaApi(
      ownerPage,
      groupName,
      'Закрытая группа',
      'subscribers',
    );
    await ownerPage.goto(`/group/${groupId}`);
    await ownerPage.getByRole('button', { name: 'Вы администратор', exact: true }).click();
    await ownerPage.getByRole('menuitem', { name: 'Пригласить', exact: true }).click();

    const inviteDialog = ownerPage.getByRole('dialog').filter({ hasText: /Приглас/ }).last();
    await expect(inviteDialog).toBeVisible();
    await inviteDialog.getByRole('textbox', { name: 'Поиск по ФИО' }).fill(currentMember.first_name);
    const candidateProfile = inviteDialog.locator(`a[href="/profile/${currentMember.id}"]`).last();
    await expect(candidateProfile).toBeVisible({ timeout: 20_000 });
    const profileHrefs = await inviteDialog.locator('a[href^="/profile/"]').evaluateAll((links) =>
      [...new Set(links.map((link) => link.getAttribute('href')).filter(Boolean))],
    );
    const candidateIndex = profileHrefs.indexOf(`/profile/${currentMember.id}`);
    expect(candidateIndex).toBeGreaterThanOrEqual(0);
    const inviteCandidate = inviteDialog
      .getByRole('button', { name: 'Пригласить', exact: true })
      .nth(candidateIndex);
    const inviteResponse = ownerPage.waitForResponse((response) =>
      response.request().method() !== 'GET' &&
      response.url().includes(`/api/group/${groupId}`) &&
      /member|invite/i.test(response.url()),
    );
    await inviteCandidate.click();
    expect((await inviteResponse).ok()).toBe(true);

    // Редактор загружает доступные назначения при инициализации приложения.
    // Новая сессия страницы гарантирует, что только что выданное членство уже учтено.
    await memberPage.close();
    memberPage = await memberContext.newPage();
    await new LoginPage(memberPage).login(env.memberEmail, env.memberPassword);
    await memberPage.goto(`/group/${groupId}`);
    const groupResponse = await memberPage.request.get(
      `https://dev-social-backend.sddt.efko.ru/api/group/${groupId}`,
    );
    expect(groupResponse.ok()).toBe(true);
    expect(await groupResponse.json()).toMatchObject({
      is_member: true,
      is_group_admin: false,
      can_post: true,
      posting_permission: 'subscribers',
    });

    await expect(memberPage.getByRole('button', { name: 'Вы подписаны', exact: true })).toBeVisible();
    const composer = new PostComposerPage(memberPage);
    await composer.open();
    await composer.selectDestination(groupName);
    await composer.fill(postTitle, 'Публикация приглашённого подписчика закрытой группы.');
    const created = memberPage.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;
    await memberPage.goto(`/group/${groupId}`);
    await expect(memberPage.getByRole('heading', { name: postTitle, exact: true })).toBeVisible();

    await ownerPage.goto(`/group/${groupId}`);
    await ownerPage.getByRole('button', { name: 'Участники', exact: true }).filter({ visible: true }).click();
    const memberProfile = ownerPage.locator(`a[href="/profile/${currentMember.id}"]`).filter({ visible: true });
    await expect(memberProfile).toBeVisible();
    const memberRow = ownerPage.locator('div.group-authors__item').filter({ has: memberProfile });
    await expect(memberRow).toBeVisible();
    const memberActions = memberRow.getByRole('button', { name: 'Действия', exact: true });
    await memberActions.click();
    const removeMember = ownerPage
      .getByRole('menuitem', { name: /Удалить|Исключить/ })
      .or(ownerPage.getByRole('button', { name: /Удалить|Исключить/ }))
      .filter({ visible: true })
      .last();
    await expect(removeMember).toBeVisible();
    const removeResponse = ownerPage.waitForResponse((response) =>
      response.request().method() !== 'GET' &&
      response.url().includes(`/api/group/${groupId}`) &&
      !/\/feed-view(?:\?|$)/.test(response.url()),
    );
    await removeMember.click();
    const inlineConfirmation = ownerPage
      .getByRole('menuitem', { name: 'Удаляем?', exact: true })
      .or(ownerPage.getByRole('button', { name: 'Удаляем?', exact: true }))
      .filter({ visible: true })
      .last();
    await expect(inlineConfirmation).toBeVisible();
    await inlineConfirmation.click();
    expect((await removeResponse).ok()).toBe(true);
    await expect(memberProfile).toHaveCount(0);

    await expect.poll(async () => {
      const response = await memberPage.request.get(
        `https://dev-social-backend.sddt.efko.ru/api/group/${groupId}`,
      );
      const group = (await response.json()) as { is_member: boolean; can_post: boolean };
      return { is_member: group.is_member, can_post: group.can_post };
    }).toEqual({ is_member: false, can_post: false });
    await memberPage.goto(`/group/${groupId}`);
    await expect(memberPage.getByText(/Это закрытая группа/i)).toBeVisible();
    await expect(memberPage.getByRole('heading', { name: postTitle, exact: true })).toHaveCount(0);
  } finally {
    const ownerPage = ownerContext.pages()[0];
    if (ownerPage) {
      await deleteTemporaryPostViaApi(ownerPage, postId);
      await deleteTemporaryGroupViaApi(ownerPage, groupId);
    }
    await memberContext.close();
    await ownerContext.close();
  }
});
