import { expect, type Page } from '@playwright/test';

const apiBase = 'https://dev-social-backend.sddt.efko.ru/api/group';

export async function createTemporaryGroupViaApi(
  page: Page,
  name: string,
  type: 'Публичная группа' | 'Закрытая группа' | 'Скрытая группа',
  postingPermission: 'authors' | 'subscribers' = 'authors',
): Promise<string> {
  const response = await page.request.post(`${apiBase}/`, {
    data: {
      name,
      description: 'Временная группа для E2E-проверки.',
      security_level:
        type === 'Закрытая группа' ? 'private' : type === 'Скрытая группа' ? 'secret' : 'public',
      posting_permission: postingPermission,
      community_id: 1,
      shared_cover_image: true,
    },
  });
  expect(response.ok(), `Создание группы через API: ${response.status()}`).toBe(true);
  const group = (await response.json()) as { id: string };
  expect(group.id).toBeTruthy();
  return group.id;
}

export async function joinTemporaryGroupViaApi(page: Page, groupId: string): Promise<void> {
  const response = await page.request.post(`${apiBase}/${groupId}/members`);
  expect(response.ok(), `Вступление в группу: ${response.status()}`).toBe(true);
}

export async function deleteTemporaryGroupViaApi(page: Page, groupId?: string): Promise<void> {
  if (!groupId) return;
  const response = await page.request.delete(`${apiBase}/${groupId}`);
  expect([200, 204, 404].includes(response.status()), `Удаление группы: ${response.status()}`).toBe(true);
}
