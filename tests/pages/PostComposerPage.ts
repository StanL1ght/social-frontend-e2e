import { expect, type Locator, type Page } from '@playwright/test';

export class PostComposerPage {
  readonly dialog: Locator;

  constructor(private readonly page: Page) {
    this.dialog = page.getByRole('dialog', { name: 'Новая публикация' });
  }

  async open(): Promise<void> {
    await this.page.getByRole('button', { name: 'Написать' }).click();
    await expect(this.dialog).toBeVisible();
  }

  async selectDestination(destination: 'Моя лента' | string): Promise<void> {
    const selector = this.dialog.getByRole('combobox').first();
    await selector.click();

    const option = this.page
      .getByRole('option', { name: destination, exact: true })
      .or(this.page.getByText(destination, { exact: true }));
    await option.last().click();
  }

  async fill(title: string, body: string): Promise<void> {
    const editor = this.dialog.locator('[contenteditable="true"]').first();
    const titleBlock = editor.locator('h1[data-title="true"]');

    await titleBlock.click({ position: { x: 8, y: 8 } });
    await this.page.keyboard.type(title);
    await expect(titleBlock).toHaveText(title);

    const endShortcut = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
    await editor.press(endShortcut);
    await editor.press('Enter');
    await this.page.keyboard.type(body);
    await expect(editor).toContainText(body);
  }

  async publishNow(): Promise<void> {
    const button = this.dialog.getByRole('button', { name: 'Сейчас', exact: true });
    await expect(button).toBeEnabled();
    await button.click();
    await expect(this.dialog).toBeHidden();
  }
}
