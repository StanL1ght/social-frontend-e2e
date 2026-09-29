import { expect, type Page } from '@playwright/test';

export async function createTemporaryCommentViaApi(
  page: Page,
  postId: string,
  text: string,
): Promise<string> {
  const response = await page.request.post(
    `https://dev-social-backend.sddt.efko.ru/api/post/${postId}/comment`,
    { data: { text, attachments: [], mentions: [] } },
  );
  expect(response.ok(), `Создание комментария через API: ${response.status()}`).toBe(true);
  const comment = (await response.json()) as { id: string };
  expect(comment.id).toBeTruthy();
  return comment.id;
}
