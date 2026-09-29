import { expect, type Page } from '@playwright/test';

export class LoginPage {
  constructor(private readonly page: Page) {}

  async login(email: string, password: string): Promise<void> {
    await this.installBlockingBannerHandlers();
    await this.page.goto('/');

    const emailInput = this.page
      .getByLabel(/email|почта|логин/i)
      .or(this.page.getByRole('textbox', { name: 'Email или телефон', exact: true }))
      .or(this.page.locator('input[type="email"]'));
    const passwordInput = this.page
      .getByLabel(/пароль/i)
      .or(this.page.locator('input[type="password"]'));

    const ready = this.page
      .getByRole('button', { name: 'Написать', exact: true })
      .filter({ visible: true })
      .first();
    await expect(passwordInput.first().or(ready).first(),
      'Должна загрузиться форма входа или авторизованная лента',
    ).toBeVisible({ timeout: 30_000 });
    if (await ready.isVisible()) return;

    if (await emailInput.first().isVisible()) {
      await emailInput.first().fill(email);
    }
    await passwordInput.first().fill(password);
    await this.page.getByRole('button', { name: /войти/i }).click();

    const firstAttempt = await Promise.race([
      this.page.waitForURL(/\/feed(?:\?|$)/, { timeout: 30_000 }).then(() => 'feed' as const),
      this.page.getByText(/Please re-authenticate to continue/i)
        .waitFor({ state: 'visible', timeout: 30_000 })
        .then(() => 'reauthenticate' as const),
    ]);
    if (firstAttempt === 'reauthenticate') {
      await passwordInput.first().fill(password);
      await this.page.getByRole('button', { name: /войти/i }).click();
    }
    if (!/\/feed(?:\?|$)/.test(new URL(this.page.url()).pathname)) {
      const postLogin = await Promise.race([
        this.page.waitForURL(/\/feed(?:\?|$)/, { timeout: 30_000 }).then(() => 'feed' as const),
        this.page.getByRole('button', { name: 'Закрыть', exact: true })
          .filter({ visible: true })
          .last()
          .waitFor({ state: 'visible', timeout: 30_000 })
          .then(() => 'promo' as const),
      ]);
      if (postLogin === 'promo') {
        await this.page.getByRole('button', { name: 'Закрыть', exact: true }).filter({ visible: true }).last().click();
        await this.page.goto('/feed');
      }
    }
    await this.page.waitForURL(/\/feed(?:\?|$)/, { timeout: 30_000 });
    await expect(ready).toBeVisible({ timeout: 30_000 });
  }

  private async installBlockingBannerHandlers(): Promise<void> {
    for (const selector of ['#ekp-browser-banner', '#ekp-browser-top-banner']) {
      const banner = this.page.locator(selector);
      await this.page.addLocatorHandler(banner, async () => {
        const closeInsideBanner = banner.getByRole('button', {
          name: 'Закрыть',
          exact: true,
        });
        const closeButton = closeInsideBanner.or(banner.locator('button')).first();
        if (await closeButton.isVisible().catch(() => false)) {
          await closeButton.click({ timeout: 3_000 }).catch(() => undefined);
        }
      }, { noWaitAfter: true });
    }
  }
}
