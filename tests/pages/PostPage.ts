import { expect, type Locator, type Page } from '@playwright/test';
import { clickAndWaitForMutation, waitForInteractive } from '../helpers/ui-sync';

export class PostPage {
  constructor(private readonly page: Page) {}

  commentsDialog(): Locator {
    return this.page.getByRole('dialog', { name: 'Комментарии' });
  }

  async openActions(): Promise<void> {
    const actions = this.page.getByRole('button', { name: 'Действия', exact: true });
    await waitForInteractive(actions);
    await actions.click();
  }

  async openEditor(): Promise<void> {
    await this.openActions();
    await this.page
      .getByRole('menuitem', { name: /Редактировать(?: пост)?/ })
      .first()
      .click();
  }

  async openRepostComposer(): Promise<void> {
    await this.openActions();
    await this.page.getByRole('menuitem', { name: /Репост/ }).click();
    await expect(this.page.getByRole('dialog', { name: 'Репост', exact: true })).toBeVisible();
  }

  async addLike(): Promise<void> {
    const like = this.page.getByRole('button', { name: 'Нравится', exact: true });
    await clickAndWaitForMutation(this.page, like, /\/post\/.*\/react\/?(?:\?|$)/i);
    await expect(this.page.getByRole('button', { name: /Симпатия/ }).last()).toBeVisible();
  }

  async addComment(text: string): Promise<void> {
    const comments = this.commentsDialog();
    const editor = comments.locator('.ql-editor[contenteditable="true"]');
    await editor.fill(text);

    const send = comments.getByRole('button', { name: 'Отправить' });
    await expect(send).toBeEnabled();
    await clickAndWaitForMutation(this.page, send, /\/comment(?:\/|\?|$)/i);
    await expect(comments.getByText(text, { exact: true })).toBeVisible({ timeout: 15_000 });
  }

  async addCommentWithTextAttachment(text: string): Promise<void> {
    const comments = this.commentsDialog();
    const fileName = 'qa-e2e-note.txt';
    const input = comments.locator('input[type="file"]').last();
    await input.setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from('Playwright E2E attachment'),
    });

    await comments.locator('.ql-editor[contenteditable="true"]').fill(text);
    await clickAndWaitForMutation(
      this.page,
      comments.getByRole('button', { name: 'Отправить' }),
      /\/comment(?:\/|\?|$)/i,
    );
    await expect(comments.getByText(text, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(comments.getByText(fileName, { exact: true })).toBeVisible({ timeout: 15_000 });
  }

  private async commentCard(text: string): Promise<Locator> {
    const comments = this.commentsDialog();
    const customElement = comments.locator('network-comment-card').filter({
      has: this.page.locator('.comment-card__text', { hasText: text }),
    });
    if ((await customElement.count()) > 0) {
      await expect(customElement.first()).toBeVisible({ timeout: 20_000 });
      return customElement.first();
    }

    const article = comments.locator('article').filter({ hasText: text }).first();
    await expect(article).toBeVisible({ timeout: 20_000 });
    return article;
  }

  async editComment(currentText: string, updatedText: string): Promise<void> {
    const card = await this.commentCard(currentText);
    const edit = card.getByRole('button', { name: 'Редактировать', exact: true });
    await waitForInteractive(edit);
    await edit.click();

    const editor = this.commentsDialog().locator('.ql-editor[contenteditable="true"]');
    await editor.fill(updatedText);
    await clickAndWaitForMutation(
      this.page,
      this.commentsDialog().getByRole('button', { name: 'Отправить' }),
      /\/comment(?:\/|\?|$)/i,
    );
    await expect(this.commentsDialog().getByText(updatedText, { exact: true })).toBeVisible();
  }

  async replyToComment(commentText: string, replyText: string): Promise<void> {
    const card = await this.commentCard(commentText);
    const reply = card.getByRole('button', { name: 'Ответить', exact: true });
    await waitForInteractive(reply);
    await reply.click();

    const editor = this.commentsDialog().locator('.ql-editor[contenteditable="true"]').last();
    // Режим ответа инициализируется асинхронно и сначала добавляет обращение автору.
    // Если заполнить поле раньше, инициализация перезапишет введённый текст.
    await expect(editor).not.toBeEmpty({ timeout: 20_000 });
    await editor.press('End');
    await this.page.keyboard.insertText(` ${replyText}`);
    await expect(editor).toContainText(replyText);
    await clickAndWaitForMutation(
      this.page,
      this.commentsDialog().getByRole('button', { name: 'Отправить' }).last(),
      /\/comment(?:\/|\?|$)/i,
    );
    await expect(this.commentsDialog().getByText(new RegExp(replyText))).toBeVisible({
      timeout: 20_000,
    });
  }

  async deleteComment(text: string): Promise<void> {
    const comments = this.commentsDialog();
    const card = await this.commentCard(text);
    const deleteButton = card
      .getByRole('button', { name: 'Удалить', exact: true })
      .filter({ visible: true })
      .last();
    await waitForInteractive(deleteButton);
    const deleteResponse = this.page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        /\/comment(?:\/|\?|$)/i.test(response.url()),
      { timeout: 30_000 },
    );
    await deleteButton.click();

    const confirmation = comments
      .getByRole('button', { name: 'Удаляем?', exact: true })
      .filter({ visible: true })
      .last();
    const nextState = await Promise.race([
      deleteResponse.then(() => 'deleted' as const),
      confirmation
        .waitFor({ state: 'visible', timeout: 2_000 })
        .then(() => 'confirmation' as const)
        .catch(() => 'no-confirmation' as const),
    ]);
    if (nextState === 'confirmation') {
      await waitForInteractive(confirmation);
      await confirmation.click();
    }

    const response = await deleteResponse;
    expect(response.ok(), `DELETE ${response.url()} завершился со статусом ${response.status()}`).toBe(
      true,
    );
    await expect(comments.getByText(text, { exact: true })).toBeHidden({ timeout: 20_000 });
  }

  async deleteThroughUi(expectedRedirect: RegExp = /\/my-publications\/published/): Promise<void> {
    await this.openActions();
    const deletePost = this.page.getByRole('menuitem', {
      name: 'Удалить пост',
      exact: true,
    });
    await waitForInteractive(deletePost);
    await deletePost.click();

    // Подтверждение находится в том же пункте меню: первый клик меняет его на «Удаляем?»,
    // второй клик действительно отправляет запрос удаления.
    const confirmDelete = this.page.getByRole('menuitem', {
      name: /Удаляем\?|Удалить пост/,
    });
    await clickAndWaitForMutation(this.page, confirmDelete, /\/post(?:\/|\?|$)/i);
    await this.page.waitForURL(expectedRedirect, { timeout: 30_000 });
  }
}
