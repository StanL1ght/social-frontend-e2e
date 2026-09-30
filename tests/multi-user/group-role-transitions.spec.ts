import { test, expect, type Page } from '@playwright/test';
import { env, hasMultiUserEnvironment } from '../helpers/env';
import {
  createTemporaryGroupViaApi,
  deleteTemporaryGroupViaApi,
  joinTemporaryGroupViaApi,
} from '../helpers/group-api';
import { uniqueMarker } from '../helpers/test-data';
import { deleteTemporaryPostViaApi } from '../helpers/post-api';
import { LoginPage } from '../pages/LoginPage';
import { PostComposerPage } from '../pages/PostComposerPage';

const apiBase = 'https://dev-social-backend.sddt.efko.ru/api/group';

type GroupRole = 'Пользователь' | 'Автор' | 'Администратор';

type GroupMember = {
  id: string;
  email: string;
  administrator: boolean;
  can_post: boolean;
  can_comment: boolean;
};

type GroupDetails = {
  id: string;
  is_member: boolean;
  is_group_admin: boolean;
  is_group_owner: boolean;
  can_post: boolean;
  can_comment: boolean;
  members: GroupMember[];
};

type RolePermissions = Pick<GroupMember, 'administrator' | 'can_post' | 'can_comment'>;

const rolePermissions: Record<GroupRole, RolePermissions> = {
  Пользователь: { administrator: false, can_post: false, can_comment: true },
  Автор: { administrator: false, can_post: true, can_comment: true },
  Администратор: { administrator: true, can_post: true, can_comment: true },
};

async function getGroup(page: Page, groupId: string): Promise<GroupDetails> {
  const response = await page.request.get(`${apiBase}/${groupId}`);
  expect(response.ok(), `Получение группы: ${response.status()}`).toBe(true);
  return response.json() as Promise<GroupDetails>;
}

async function expectMemberPermissions(
  ownerPage: Page,
  groupId: string,
  memberId: string,
  expected: RolePermissions,
): Promise<void> {
  await expect
    .poll(async () => {
      const member = (await getGroup(ownerPage, groupId)).members.find(
        (candidate) => candidate.id === memberId,
      );
      return member
        ? {
            administrator: member.administrator,
            can_post: member.can_post,
            can_comment: member.can_comment,
          }
        : undefined;
    })
    .toEqual(expected);
}

async function expectAccountAccess(
  memberPage: Page,
  groupId: string,
  expected: {
    is_group_admin: boolean;
    can_post: boolean;
  },
): Promise<void> {
  await expect
    .poll(async () => {
      const group = await getGroup(memberPage, groupId);
      return {
        is_member: group.is_member,
        is_group_admin: group.is_group_admin,
        is_group_owner: group.is_group_owner,
        can_post: group.can_post,
        can_comment: group.can_comment,
      };
    })
    .toEqual({
      is_member: true,
      is_group_admin: expected.is_group_admin,
      is_group_owner: false,
      can_post: expected.can_post,
      can_comment: true,
    });
}

async function changeRoleViaUi(
  ownerPage: Page,
  groupId: string,
  memberId: string,
  currentRole: GroupRole,
  nextRole: GroupRole,
): Promise<void> {
  await ownerPage.goto(`/group/${groupId}`);
  await ownerPage
    .getByRole('button', { name: 'Участники', exact: true })
    .filter({ visible: true })
    .click();

  const profileLink = ownerPage.locator(`a[href="/profile/${memberId}"]`).filter({ visible: true });
  await expect(profileLink).toBeVisible();
  const memberRow = ownerPage.locator('div.group-authors__item').filter({ has: profileLink });
  await expect(memberRow).toBeVisible();

  const roleSelector = memberRow
    .getByText(currentRole, { exact: true })
    .filter({ visible: true })
    .locator('..');
  await roleSelector.click();

  const roleOption = ownerPage.getByRole('option', { name: nextRole, exact: true });
  await expect(roleOption).toBeVisible();
  const responsePromise = ownerPage.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === 'PUT' &&
      response.url() === `${apiBase}/${groupId}/members/${memberId}`
    );
  });
  await roleOption.click();
  const response = await responsePromise;

  expect(response.ok(), `Смена роли ${currentRole} → ${nextRole}: ${response.status()}`).toBe(true);
  expect(response.request().postDataJSON()).toEqual(rolePermissions[nextRole]);
  await expect(memberRow.getByText(nextRole, { exact: true }).filter({ visible: true })).toBeVisible();
}

test(
  'ESN-136/ESN-137/ESN-518 — роли Пользователь, Автор и Администратор сохраняются в API и UI @multiuser @mutation',
  async ({ browser }) => {
    test.skip(!hasMultiUserEnvironment, 'Нужны учётные данные двух пользователей');
    test.skip(!env.runMutationTests, 'Смена ролей разрешена только в mutation-режиме');
    test.setTimeout(180_000);

    const ownerContext = await browser.newContext({ baseURL: env.baseURL });
    const memberContext = await browser.newContext({ baseURL: env.baseURL });
    const groupName = uniqueMarker('GROUP');
    let groupId: string | undefined;
    let authorPostId: string | undefined;

    try {
      const ownerPage = await ownerContext.newPage();
      await new LoginPage(ownerPage).login(env.email, env.password);
      groupId = await createTemporaryGroupViaApi(
        ownerPage,
        groupName,
        'Публичная группа',
        'authors',
      );

      const memberPage = await memberContext.newPage();
      await new LoginPage(memberPage).login(env.memberEmail, env.memberPassword);
      await joinTemporaryGroupViaApi(memberPage, groupId);

      const member = (await getGroup(ownerPage, groupId)).members.find(
        (candidate) => candidate.email.toLowerCase() === env.memberEmail.toLowerCase(),
      );
      expect(member, 'Второй аккаунт появился в списке участников').toBeTruthy();
      const memberId = member!.id;

      await expectMemberPermissions(
        ownerPage,
        groupId,
        memberId,
        rolePermissions.Пользователь,
      );
      await expectAccountAccess(memberPage, groupId, {
        is_group_admin: false,
        can_post: false,
      });

      await changeRoleViaUi(ownerPage, groupId, memberId, 'Пользователь', 'Автор');
      await expectMemberPermissions(ownerPage, groupId, memberId, rolePermissions.Автор);
      await expectAccountAccess(memberPage, groupId, {
        is_group_admin: false,
        can_post: true,
      });

      await memberPage.goto(`/group/${groupId}`);
      await expect(
        memberPage.getByRole('button', { name: 'Вы подписаны', exact: true }),
      ).toBeVisible();
      const authorComposer = new PostComposerPage(memberPage);
      await authorComposer.open();
      await authorComposer.selectDestination(groupName);
      await expect(authorComposer.dialog.getByRole('combobox').first()).toContainText(groupName);
      const authorTitle = uniqueMarker('POST');
      await authorComposer.fill(authorTitle, 'Проверка публикации участника с ролью «Автор».');
      const authored = memberPage.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
      );
      await authorComposer.publishNow();
      authorPostId = ((await (await authored).json()) as { id: string }).id;
      await memberPage.goto(`/post/${authorPostId}`);
      await expect(memberPage.getByRole('heading', { name: authorTitle, exact: true })).toBeVisible();
      await expect(memberPage.getByRole('link', { name: groupName, exact: true }).first()).toBeVisible();

      await changeRoleViaUi(ownerPage, groupId, memberId, 'Автор', 'Администратор');
      await expectMemberPermissions(ownerPage, groupId, memberId, rolePermissions.Администратор);
      await expectAccountAccess(memberPage, groupId, {
        is_group_admin: true,
        can_post: true,
      });

      await memberPage.goto(`/group/${groupId}`);
      const administratorStatus = memberPage.getByRole('button', {
        name: 'Вы администратор',
        exact: true,
      });
      await expect(administratorStatus).toBeVisible();
      await administratorStatus.click();
      await expect(memberPage.getByRole('menuitem', { name: 'Пригласить' })).toBeVisible();
      await memberPage.keyboard.press('Escape');

      await changeRoleViaUi(ownerPage, groupId, memberId, 'Администратор', 'Пользователь');
      await expectMemberPermissions(
        ownerPage,
        groupId,
        memberId,
        rolePermissions.Пользователь,
      );
      await expectAccountAccess(memberPage, groupId, {
        is_group_admin: false,
        can_post: false,
      });

      await memberPage.goto(`/group/${groupId}`);
      const subscriberStatus = memberPage.getByRole('button', {
        name: 'Вы подписаны',
        exact: true,
      });
      await expect(subscriberStatus).toBeVisible();
      await subscriberStatus.click();
      await expect(memberPage.getByRole('menuitem', { name: 'Пригласить' })).toHaveCount(0);
      await memberPage.keyboard.press('Escape');

      const subscriberComposer = new PostComposerPage(memberPage);
      await subscriberComposer.open();
      const destination = subscriberComposer.dialog.getByRole('combobox').first();
      await destination.click();
      await expect(memberPage.getByRole('option', { name: groupName, exact: true })).toHaveCount(0);
      await subscriberComposer.discard();
    } finally {
      const ownerPage = ownerContext.pages()[0];
      if (ownerPage) await deleteTemporaryPostViaApi(ownerPage, authorPostId);
      if (ownerPage) await deleteTemporaryGroupViaApi(ownerPage, groupId);
      await memberContext.close();
      await ownerContext.close();
    }
  },
);

test('ESN-136: после назначения администратором сохраняются права @multiuser @mutation', async ({ browser }) => {
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два аккаунта и mutation-режим');
  const ownerContext = await browser.newContext({ baseURL: env.baseURL });
  const memberContext = await browser.newContext({ baseURL: env.baseURL });
  let groupId: string | undefined;
  try {
    const ownerPage = await ownerContext.newPage();
    const memberPage = await memberContext.newPage();
    await new LoginPage(ownerPage).login(env.email, env.password);
    await new LoginPage(memberPage).login(env.memberEmail, env.memberPassword);
    groupId = await createTemporaryGroupViaApi(ownerPage, uniqueMarker('GROUP'), 'Публичная группа');
    await joinTemporaryGroupViaApi(memberPage, groupId);
    const member = (await getGroup(ownerPage, groupId)).members.find(
      (candidate) => candidate.email.toLowerCase() === env.memberEmail.toLowerCase(),
    );
    expect(member).toBeTruthy();
    await changeRoleViaUi(ownerPage, groupId, member!.id, 'Пользователь', 'Администратор');
    await expectMemberPermissions(ownerPage, groupId, member!.id, rolePermissions.Администратор);
    await expectAccountAccess(memberPage, groupId, { is_group_admin: true, can_post: true });
  } finally {
    const ownerPage = ownerContext.pages()[0];
    if (ownerPage) await deleteTemporaryGroupViaApi(ownerPage, groupId);
    await memberContext.close();
    await ownerContext.close();
  }
});

test('ESN-158 — администратор покидает публичную группу, если в ней остаётся другой администратор @multiuser @mutation', async ({ browser }) => {
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два аккаунта и mutation-режим');
  test.fail(true, 'Dev не показывает меню удаления в собственной строке администратора, хотя в группе остаётся владелец');
  test.setTimeout(120_000);
  const ownerContext = await browser.newContext({ baseURL: env.baseURL });
  const memberContext = await browser.newContext({ baseURL: env.baseURL });
  let groupId: string | undefined;
  try {
    const ownerPage = await ownerContext.newPage();
    const memberPage = await memberContext.newPage();
    await new LoginPage(ownerPage).login(env.email, env.password);
    await new LoginPage(memberPage).login(env.memberEmail, env.memberPassword);
    groupId = await createTemporaryGroupViaApi(ownerPage, `${uniqueMarker('GROUP-PUBLIC')}-ADMIN-EXIT`, 'Публичная группа');
    await joinTemporaryGroupViaApi(memberPage, groupId);
    const member = (await getGroup(ownerPage, groupId)).members.find(
      (candidate) => candidate.email.toLowerCase() === env.memberEmail.toLowerCase(),
    );
    expect(member).toBeTruthy();
    await changeRoleViaUi(ownerPage, groupId, member!.id, 'Пользователь', 'Администратор');
    await expectAccountAccess(memberPage, groupId, { is_group_admin: true, can_post: true });

    await memberPage.goto(`/group/${groupId}`);
    await memberPage.getByRole('button', { name: 'Участники', exact: true }).filter({ visible: true }).click();
    const ownProfile = memberPage.locator(`a[href="/profile/${member!.id}"]`).filter({ visible: true });
    await expect(ownProfile).toBeVisible();
    const ownRow = memberPage.locator('div.group-authors__item').filter({ has: ownProfile });
    await ownRow.getByRole('button').last().click();
    await memberPage.getByText('Удалить', { exact: true }).filter({ visible: true }).click();
    const confirmation = memberPage.getByRole('alertdialog');
    await expect(confirmation).toBeVisible();
    const leaveResponse = memberPage.waitForResponse((response) =>
      response.request().method() === 'DELETE' && response.url().includes(`/group/${groupId}`),
    );
    await confirmation.getByRole('button', { name: /Удаляем\?|Удалить|Отписаться/ }).click();
    expect((await leaveResponse).ok()).toBe(true);
    await expect(memberPage.getByText('Вы покинули группу', { exact: true })).toBeVisible();
    await expect(memberPage.getByRole('button', { name: 'Подписаться', exact: true })).toBeVisible();
    await expect.poll(async () => (await getGroup(memberPage, groupId!)).is_member).toBe(false);
    await expect.poll(async () => (await getGroup(ownerPage, groupId!)).is_group_owner).toBe(true);
  } finally {
    const ownerPage = ownerContext.pages()[0];
    if (ownerPage) await deleteTemporaryGroupViaApi(ownerPage, groupId);
    await memberContext.close();
    await ownerContext.close();
  }
});
