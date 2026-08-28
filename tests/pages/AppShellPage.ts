import { expect, type Page } from '@playwright/test';

export class AppShellPage {
  constructor(private readonly page: Page) {}

  async goto(path = '/feed'): Promise<void> {
    await this.page.goto(path);
    await expect(this.page.getByText('Лента', { exact: true }).first()).toBeVisible();
  }

  async openSection(name: 'Лента' | 'Группы' | 'Персоны' | 'Моя страница' | 'Мои публикации') {
    await this.page.getByText(name, { exact: true }).first().click();
  }

  async openGlobalSearch(): Promise<void> {
    await this.page.getByRole('search').getByRole('button').first().click();
    await expect(
      this.page.getByRole('searchbox', { name: 'Поиск по записям, людям и группам' }),
    ).toBeVisible();
  }

  async searchGlobally(query: string): Promise<void> {
    await this.openGlobalSearch();
    await this.page
      .getByRole('searchbox', { name: 'Поиск по записям, людям и группам' })
      .fill(query);
  }

  async closeGlobalSearch(): Promise<void> {
    await this.page
      .getByRole('searchbox', { name: 'Поиск по записям, людям и группам' })
      .press('Escape');
  }
}
