import { expect, type Page } from '@playwright/test';
import { clickAndWaitForMutation, waitForInteractive } from '../helpers/ui-sync';

export class GroupPage {
  constructor(private readonly page: Page) {}

  async deleteThroughUi(): Promise<void> {
    const administrator = this.page.getByRole('button', {
      name: 'Вы администратор',
      exact: true,
    }).filter({ visible: true }).last();
    await waitForInteractive(administrator);
    await administrator.click();
    const deleteGroup = this.page.getByRole('menuitem', {
      name: 'Удалить группу',
      exact: true,
    });
    await waitForInteractive(deleteGroup);
    await deleteGroup.click();

    const dialog = this.page.getByRole('alertdialog', { name: 'Удалить группу' });
    await expect(dialog).toBeVisible();
    await clickAndWaitForMutation(
      this.page,
      dialog.getByRole('button', { name: 'Удалить', exact: true }),
      /\/group(?:\/|\?|$)/i,
    );

    await this.page.waitForURL(/\/group$/);
    await expect(this.page.getByText('Группа успешно удалена')).toBeVisible();
  }
}
