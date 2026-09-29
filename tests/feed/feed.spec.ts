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
      ).first(),
    ).toBeVisible();
  });

  test('сохраняет загруженные публикации при прокрутке до конца ленты', async ({ page }) => {
    const postLinks = page.locator('a[href*="/post/"]');
    await expect(postLinks.first()).toBeVisible({ timeout: 20_000 });
    const before = await postLinks.count();

    await page.mouse.wheel(0, 3_000);
    await expect(postLinks.last()).toBeVisible({ timeout: 15_000 });
    expect(await postLinks.count()).toBeGreaterThanOrEqual(before);
  });

  test('ESN-221: после возврата открытый пост остаётся в ленте', async ({ page }) => {
    const postLinks = page.locator('a[href*="/post/"]');
    await expect(postLinks.first()).toBeVisible({ timeout: 20_000 });

    const hasScrollable = await page.locator('*').evaluateAll((elements) => {
      const candidates = elements
        .filter((element) => element.scrollHeight > element.clientHeight + 300)
        .sort((left, right) => right.scrollHeight - left.scrollHeight);
      const container = candidates[0] as HTMLElement | undefined;
      if (!container) return false;
      container.setAttribute('data-e2e-feed-scroll', 'true');
      container.scrollTop = Math.max(500, container.scrollHeight * 0.65);
      return true;
    });
    expect(hasScrollable).toBe(true);

    const container = page.locator('[data-e2e-feed-scroll="true"]');
    await expect.poll(() => container.evaluate((element) => element.scrollTop)).toBeGreaterThan(400);
    const openedLink = postLinks.filter({ visible: true }).last();
    await expect(openedLink).toBeVisible();
    const href = await openedLink.getAttribute('href');
    expect(href).toMatch(/\/post\//);

    await openedLink.click();
    await expect(page).toHaveURL(/\/post\//);
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(page).toHaveURL(/\/feed/);
    await expect(page.locator(`a[href^="${href!.split('?')[0]}"]`).filter({ visible: true }).first()).toBeVisible();
  });
});
