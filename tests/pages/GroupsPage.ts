import { expect, type Locator, type Page } from '@playwright/test';
import { clickAndWaitForMutation, waitForInteractive } from '../helpers/ui-sync';

export class GroupsPage {
  readonly createDialog: Locator;

  constructor(private readonly page: Page) {
    this.createDialog = page.getByRole('dialog', { name: 'Новая группа' });
  }

  async open(): Promise<void> {
    await this.page.goto('/group', { waitUntil: 'domcontentloaded' });
    await waitForInteractive(this.page.getByRole('button', { name: 'Создать группу' }));
  }

  async openCreateDialog(): Promise<void> {
    await this.page.getByRole('button', { name: 'Создать группу' }).click();
    await expect(this.createDialog).toBeVisible();
  }

  async createPublicGroup(
    name: string,
    description: string,
    image?: { name: string; mimeType: string; buffer: Buffer },
  ): Promise<void> {
    await this.createGroup(name, description, 'Публичная группа', image);
  }

  async createGroup(
    name: string,
    description: string,
    type: 'Публичная группа' | 'Закрытая группа' | 'Скрытая группа',
    image?: { name: string; mimeType: string; buffer: Buffer },
    postingPermission: 'authors' | 'subscribers' = 'authors',
  ): Promise<void> {
    await this.openCreateDialog();

    await expect(this.createDialog.getByRole('button', { name: 'Публичная группа', exact: true })).toBeVisible();
    await expect(this.createDialog.getByRole('button', { name: /Только авторы/i })).toBeVisible();
    await expect(this.createDialog.getByRole('checkbox', { name: 'Использовать одно изображение для всех типов' })).toBeChecked();
    await expect(this.createDialog.getByRole('button', { name: /Отмена|Отменить/ })).toBeVisible();

    await this.createDialog.getByRole('textbox', { name: 'Название' }).fill(name);
    await this.createDialog.getByRole('textbox', { name: 'Описание' }).fill(description);
    if (image) {
      await this.createDialog.locator('input[type="file"]').setInputFiles(image);
      await expect(this.createDialog.getByText(image.name, { exact: true })).toBeVisible();
    }

    if (type !== 'Публичная группа') {
      await this.createDialog.getByRole('button', { name: 'Публичная группа', exact: true }).click();
      await this.page.getByRole('option', { name: type, exact: true }).click();
    }

    if (postingPermission === 'subscribers') {
      await this.createDialog.getByRole('button', { name: /Только авторы/i }).click();
      await this.page.getByRole('option', { name: /Все подписчики/i }).click();
    }

    const division = this.createDialog.getByRole('button', { name: 'Дивизион', exact: true });
    await division.click();
    await this.page.getByRole('option', { name: 'ИТ дивизион', exact: true }).click();

    const create = this.createDialog.getByRole('button', { name: 'Создать', exact: true });
    await expect(create).toBeEnabled();
    await clickAndWaitForMutation(this.page, create, /\/group(?:\/|\?|$)/i);
    await expect(this.page.getByText('Группа успешно создана')).toBeVisible();
  }

  async openOwnedGroup(name: string): Promise<void> {
    const openedGroup = this.page.getByRole('heading', { name, exact: true });
    const ownedTab = this.page.getByRole('button', { name: 'Вы автор', exact: true });
    await expect(openedGroup.or(ownedTab).first()).toBeVisible({ timeout: 20_000 });
    if (await openedGroup.isVisible()) return;

    await ownedTab.click();
    await expect(this.page).toHaveURL(/\/group\/owned/);
    await this.page.getByText(name, { exact: true }).click();
    await expect(openedGroup).toBeVisible();
  }
}
