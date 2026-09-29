import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('@auth Страница входа', () => {
  test('редиректит на Keycloak и показывает обязательные элементы входа @smoke', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/dev-keycloak\.sddt\.efko\.ru\/auth\/realms\/ucp/);
    await expect(
      page.getByRole('heading', {
        name: 'Вы входите в Единую Коммуникационную Платформу',
      }),
    ).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Email или телефон' })).toHaveAttribute(
      'placeholder',
      'Email или телефон',
    );
    await expect(page.getByRole('textbox', { name: 'Пароль' })).toHaveAttribute(
      'placeholder',
      'Пароль',
    );
    await expect(page.getByRole('checkbox')).toBeVisible();
    await expect(page.getByText('Запомнить меня', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeEnabled();
  });

  test('поля имеют корректные типы и не раскрывают пароль', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('textbox', { name: 'Email или телефон' })).toHaveAttribute(
      'type',
      'text',
    );
    await expect(page.getByRole('textbox', { name: 'Пароль' })).toHaveAttribute(
      'type',
      'password',
    );
  });
});
