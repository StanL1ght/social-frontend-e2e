import { test, expect } from '../fixtures/test';

test.describe('Мои публикации — новые вкладки', () => {
  for (const tab of [
    { label: 'Скрытые', route: 'hidden' },
    { label: 'Удалённые', route: 'deleted' },
  ]) {
    test(`вкладка «${tab.label}» открывается и сохраняется после обновления`, async ({ page }) => {
      await page.goto('/my-publications/published');
      const button = page.getByRole('button', { name: new RegExp(`^${tab.label}(?: \\d+)?$`) });
      await expect(button).toBeVisible();
      await button.click();
      await expect(page).toHaveURL(new RegExp(`/my-publications/${tab.route}(?:[/?#]|$)`));

      await page.reload();
      await expect(page).toHaveURL(new RegExp(`/my-publications/${tab.route}(?:[/?#]|$)`));
      await expect(button).toBeVisible();
    });
  }
});
