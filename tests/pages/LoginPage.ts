import { expect, type Page } from '@playwright/test';

export class LoginPage {
  constructor(private readonly page: Page) {}

  async login(email: string, password: string): Promise<void> {
    await this.page.goto('/');

    if (this.page.url().includes('/feed')) return;

    const emailInput = this.page
      .getByLabel(/email|почта|логин/i)
      .or(this.page.locator('input[type="email"]'))
      .or(this.page.getByRole('textbox').first());
    const passwordInput = this.page
      .getByLabel(/пароль/i)
      .or(this.page.locator('input[type="password"]'));

    await emailInput.first().fill(email);
    await passwordInput.first().fill(password);
    await this.page.getByRole('button', { name: /войти/i }).click();

    await this.page.waitForURL(/\/feed(?:\?|$)/, { timeout: 30_000 });
    await expect(this.page.getByText('Лента', { exact: true }).first()).toBeVisible();
  }
}
