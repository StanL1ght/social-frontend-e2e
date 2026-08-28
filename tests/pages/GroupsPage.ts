import { expect, type Locator, type Page } from '@playwright/test';

export class GroupsPage {
  readonly createDialog: Locator;

  constructor(private readonly page: Page) {
    this.createDialog = page.getByRole('dialog', { name: 'Новая группа' });
  }

  async open(): Promise<void> {
    await this.page.goto('/group');
    await expect(this.page.getByRole('button', { name: 'Создать группу' })).toBeVisible();
  }

  async createPublicGroup(name: string, description: string): Promise<void> {
    await this.page.getByRole('button', { name: 'Создать группу' }).click();
    await expect(this.createDialog).toBeVisible();

    await this.createDialog.getByRole('textbox', { name: 'Название' }).fill(name);
    await this.createDialog.getByRole('textbox', { name: 'Описание' }).fill(description);

    const division = this.createDialog.getByRole('button', { name: 'Дивизион', exact: true });
    await division.click();
    await this.page.getByRole('option', { name: 'ИТ дивизион', exact: true }).click();

    const create = this.createDialog.getByRole('button', { name: 'Создать', exact: true });
    await expect(create).toBeEnabled();
    await create.click();
    await expect(this.page.getByText('Группа успешно создана')).toBeVisible();
  }

  async openOwnedGroup(name: string): Promise<void> {
    await this.page.getByRole('button', { name: 'Вы автор', exact: true }).click();
    await expect(this.page).toHaveURL(/\/group\/owned/);
    await this.page.getByText(name, { exact: true }).click();
    await expect(this.page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
}
