import { expect, type Page } from '@playwright/test';

export class PostPage {
  constructor(private readonly page: Page) {}

  async addLike(): Promise<void> {
    await this.page.getByRole('button', { name: 'Нравится', exact: true }).click();
    await expect(this.page.getByRole('button', { name: /Симпатия/ }).last()).toBeVisible();
  }

  async addComment(text: string): Promise<void> {
    const comments = this.page.getByRole('dialog', { name: 'Комментарии' });
    const editor = comments.locator('.ql-editor[contenteditable="true"]');
    await editor.fill(text);

    const send = comments.getByRole('button', { name: 'Отправить' });
    await expect(send).toBeEnabled();
    await send.click();
    await expect(comments.getByText(text, { exact: true })).toBeVisible({ timeout: 15_000 });
  }

  async deleteThroughUi(): Promise<void> {
    await this.page.getByRole('button', { name: 'Действия', exact: true }).click();
    await this.page.getByRole('menuitem', { name: 'Удалить пост', exact: true }).click();
    await this.page.getByRole('menuitem', { name: 'Удаляем?', exact: true }).click();
    await this.page.waitForURL(/\/my-publications\/published/);
  }
}
