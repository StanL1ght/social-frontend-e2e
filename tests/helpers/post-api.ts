import { expect, type Page } from '@playwright/test';

const apiBase = 'https://dev-social-backend.sddt.efko.ru/api';

export async function createTemporaryPostViaApi(page: Page, title: string, groupId?: string): Promise<string> {
  const profilesResponse = await page.request.get(`${apiBase}/user/profiles`);
  expect(profilesResponse.ok(), 'Профили автора должны быть доступны').toBe(true);
  const profiles = (await profilesResponse.json()) as { data?: { id: string; IsDefault?: boolean }[] };
  const profile = profiles.data?.find((item) => item.IsDefault) ?? profiles.data?.[0];
  expect(profile?.id, 'У пользователя должен быть профиль автора').toBeTruthy();

  let publishingContext: { group_id: string; publish_as_user_id: string } | undefined;
  if (groupId) {
    const currentResponse = await page.request.get(`${apiBase}/user/current`);
    expect(currentResponse.ok()).toBe(true);
    const currentUser = (await currentResponse.json()) as { id: string };
    publishingContext = { group_id: groupId, publish_as_user_id: currentUser.id };
  }

  const response = await page.request.post(`${apiBase}/post/`, {
    data: {
      tiptap_doc: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { isTitle: true, textAlign: 'left', level: 1 }, content: [{ type: 'text', text: title }] },
          { type: 'paragraph', attrs: { textAlign: 'left' }, content: [{ type: 'text', text: 'Временная публикация для E2E-проверки.' }] },
        ],
      },
      attachments: [],
      type: 'common',
      format: 'self',
      is_anonymous: false,
      mentions: [],
      author_profile_id: profile!.id,
      ...publishingContext,
    },
  });
  expect(response.ok(), `Создание публикации: ${response.status()}`).toBe(true);
  const post = (await response.json()) as { id: string };
  expect(post.id).toBeTruthy();
  return post.id;
}

export async function deleteTemporaryPostViaApi(page: Page, postId?: string): Promise<void> {
  if (!postId) return;
  // Это мягкое удаление: запись остаётся во вкладке «Удалённые».
  const response = await page.request.delete(`${apiBase}/post/${postId}`);
  expect([200, 204, 404].includes(response.status()), `Очистка публикации: ${response.status()}`).toBe(true);
}
