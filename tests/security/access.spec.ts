import { test, expect } from '../fixtures/test';

test.describe('Ограничение доступа', () => {
  test('не-администратор не остаётся на /admin', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).not.toHaveURL(/\/admin(?:\/|$)/, { timeout: 20_000 });
  });
});
