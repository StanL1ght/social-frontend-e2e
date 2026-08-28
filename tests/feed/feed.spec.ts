import { test, expect } from '../fixtures/test';

test.describe('Лента', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/feed');
    await expect(page.getByText('Лента', { exact: true }).first()).toBeVisible();
  });

  test('загружает публикации и writer @smoke', async ({ page }) => {
    await expect(page.locator('a[href*="/post/"]').first()).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByText('О чем вы хотите написать?', { exact: true }).or(
        page.getByRole('button', { name: 'Написать' }),
      ),
    ).toBeVisible();
  });

  test('подгружает дополнительные публикации при прокрутке', async ({ page }) => {
    const postLinks = page.locator('a[href*="/post/"]');
    await expect(postLinks.first()).toBeVisible({ timeout: 20_000 });
    const before = await postLinks.count();

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await page.mouse.wheel(0, 3_000);
      await page.waitForTimeout(500);
      if ((await postLinks.count()) > before) break;
    }

    expect(await postLinks.count()).toBeGreaterThan(before);
  });
});
