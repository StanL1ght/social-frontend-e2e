import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';

const apiBase = 'https://dev-social-backend.sddt.efko.ru/api';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test('API: текущий пользователь имеет обязательные поля идентификации', async ({ page }) => {
  const response = await page.request.get(`${apiBase}/user/current`);
  expect(response.ok()).toBe(true);
  const user = (await response.json()) as Record<string, unknown>;
  expect(user.id).toEqual(expect.stringMatching(uuid));
  expect(user.first_name).toEqual(expect.any(String));
  expect(user.last_name).toEqual(expect.any(String));
  expect(user.email).toEqual(expect.stringMatching(/^[^@\s]+@[^@\s]+\.[^@\s]+$/));
});

test('API: группа возвращает согласованную структуру прав текущего пользователя', async ({ page }) => {
  test.skip(!env.managedGroupUrl, 'Нужен E2E_MANAGED_GROUP_URL');
  const groupId = new URL(env.managedGroupUrl, env.baseURL).pathname.split('/')[2];
  expect(groupId).toMatch(uuid);
  const response = await page.request.get(`${apiBase}/group/${groupId}`);
  expect(response.ok()).toBe(true);
  const group = (await response.json()) as Record<string, unknown>;
  expect(group.id).toBe(groupId);
  expect(group.name).toEqual(expect.any(String));
  expect(group.security_level).toEqual(expect.stringMatching(/^(public|private|hidden)$/));
  for (const field of ['is_member', 'is_group_admin', 'is_group_owner', 'can_post', 'can_comment']) {
    expect(group[field], `${field} должен быть boolean`).toEqual(expect.any(Boolean));
  }
  expect(group.members).toEqual(expect.any(Array));
  expect(group.owner_user_id).toEqual(expect.stringMatching(uuid));
});
