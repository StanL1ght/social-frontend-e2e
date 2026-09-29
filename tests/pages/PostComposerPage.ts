import { expect, type Locator, type Page } from '@playwright/test';
import { clickAndWaitForMutation, waitForInteractive } from '../helpers/ui-sync';

export class PostComposerPage {
  readonly dialog: Locator;
  readonly editor: Locator;
  readonly titleBlock: Locator;

  constructor(private readonly page: Page) {
    this.dialog = page.getByRole('dialog', {
      name: /Новая публикация|Редактирование публикации|Редактировать публикацию|Репост/,
    });
    this.editor = this.dialog.locator('[contenteditable="true"]').first();
    this.titleBlock = this.editor.locator('h1[data-title="true"]');
  }

  async open(): Promise<void> {
    const write = this.page.getByRole('button', { name: 'Написать' });
    await waitForInteractive(write);
    await write.click();
    if (!(await this.dialog.isVisible())) {
      await waitForInteractive(write);
      await write.click();
    }
    await expect(this.dialog).toBeVisible();
    await waitForInteractive(this.dialog.getByRole('combobox').first());
  }

  async waitForRepost(): Promise<void> {
    await expect(this.page.getByRole('dialog', { name: 'Репост', exact: true })).toBeVisible();
    await expect(this.titleBlock).toBeVisible();
  }

  async selectDestination(destination: 'Моя лента' | string): Promise<void> {
    const selector = this.dialog.getByRole('combobox').first();
    await waitForInteractive(selector);
    const selectedDestination = selector.getByRole('button').first();
    if ((await selectedDestination.innerText()).includes(destination)) return;
    await selector.click();

    const visibleOption = this.page
      .getByRole('option')
      .filter({ hasText: destination })
      .filter({ visible: true })
      .last();
    await waitForInteractive(visibleOption);
    await visibleOption.click();
    await expect(selector).toContainText(destination);
  }

  async fill(title: string, body: string): Promise<void> {
    await expect(this.titleBlock).toBeVisible();
    await this.titleBlock.fill(title);
    await expect(this.titleBlock).toHaveText(title);

    const endShortcut = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
    await this.editor.press(endShortcut);
    await this.editor.press('Enter');
    await this.page.keyboard.insertText(body);
    await expect(this.editor).toContainText(body);
  }

  async replaceTitle(title: string): Promise<void> {
    await this.titleBlock.fill(title);
  }

  publishButton(): Locator {
    return this.dialog
      .getByRole('button', { name: 'Сейчас', exact: true })
      .or(this.dialog.getByRole('button', { name: 'Опубликовать', exact: true }))
      .first();
  }

  async publishNow(): Promise<void> {
    const button = this.publishButton();
    await expect(button).toBeEnabled();
    await clickAndWaitForMutation(this.page, button, /\/post(?:\/|\?|$)/i);
    await expect(this.dialog).toBeHidden();
  }

  async saveChanges(): Promise<void> {
    const save = this.dialog.getByRole('button', {
      name: /Сохранить|Переопубликовать/,
    });
    await expect(save).toBeEnabled();
    await clickAndWaitForMutation(this.page, save, /\/post(?:\/|\?|$)/i);
    await expect(this.dialog).toBeHidden();
  }

  async discard(): Promise<void> {
    if (!(await this.dialog.isVisible())) return;

    const close = this.dialog.getByRole('button', { name: 'Закрыть', exact: true });
    if (await close.isVisible()) await close.click();
    else await this.page.keyboard.press('Escape');
    const discard = this.page
      .getByRole('button', { name: /Закрыть и удалить изменения|Отменить изменения|Не сохранять|^Выйти$|Выйти без сохранения/ })
      .filter({ visible: true });
    if (await discard.first().isVisible()) await discard.first().click();
    await expect(this.dialog).toBeHidden();
  }
}
