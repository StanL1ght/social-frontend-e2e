import { expect, type Page } from '@playwright/test';

export class GroupPage {
  constructor(private readonly page: Page) {}

  async deleteThroughUi(): Promise<void> {
    await this.page.getByRole('button', { name: 'Вы администратор', exact: true }).click();
    await this.page.getByRole('menuitem', { name: 'Удалить группу', exact: true }).click();

    const dialog = this.page.getByRole('alertdialog', { name: 'Удалить группу' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Удалить', exact: true }).click();

    await this.page.waitForURL(/\/group$/);
    await expect(this.page.getByText('Группа успешно удалена')).toBeVisible();
  }
}
