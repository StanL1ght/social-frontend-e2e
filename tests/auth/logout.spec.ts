import { test, expect } from '@playwright/test';
import { env } from '../helpers/env';
import { LoginPage } from '../pages/LoginPage';

test.describe('@mutation Выход из системы', () => {
  test.skip(!env.runMutationTests, 'Для запуска установите RUN_MUTATION_TESTS=true');

  test('завершает только изолированную тестовую сессию', async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: env.baseURL,
      storageState: { cookies: [], origins: [] },
    });

    try {
      const page = await context.newPage();
      await new LoginPage(page).login(env.email, env.password);
      await page.goto('/feed');

      const avatar = page.locator('app-avatar').first();
      await expect(avatar).toBeVisible();
      await avatar.click();
      await expect(page.getByRole('menuitem', { name: 'Выйти', exact: true })).toBeVisible();
      await page.getByRole('menuitem', { name: 'Выйти', exact: true }).click();

      await expect(page).toHaveURL(/dev-keycloak\.sddt\.efko\.ru\/auth\/realms\/ucp/);
      await expect(page.getByRole('textbox', { name: 'Пароль' })).toHaveAttribute('type', 'password');
      await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
