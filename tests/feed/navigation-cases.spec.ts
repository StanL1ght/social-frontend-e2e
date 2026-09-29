import { test, expect } from '../fixtures/test';
import { PostComposerPage } from '../pages/PostComposerPage';

test('ESN-378: кнопка «Написать» доступна в основных разделах', async ({ page }) => {
  for (const route of ['/feed', '/group', '/catalogs', '/ranking', '/my-publications']) {
    await page.goto(route);
    await expect(page.getByRole('button', { name: 'Написать', exact: true })).toBeVisible();
  }
});

test('ESN-381: редактор закрывается крестиком', async ({ page }) => {
  await page.goto('/feed');
  const composer = new PostComposerPage(page);
  await composer.open();
  await composer.dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(composer.dialog).toBeHidden();
});

test('ESN-207: кнопка возврата наверх появляется после прокрутки и поднимает ленту', async ({ page }) => {
  await page.goto('/feed');
  await expect(page.locator('a[href*="/post/"]').first()).toBeVisible({ timeout: 20_000 });
  const scrollTop = async () => page.evaluate(() => {
    const candidates = [document.scrollingElement, ...document.querySelectorAll<HTMLElement>('*')]
      .filter((element): element is HTMLElement => Boolean(element))
      .filter((element) => element.scrollHeight > element.clientHeight + 300);
    const container = candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    return container?.scrollTop ?? 0;
  });
  await page.evaluate(() => {
    const candidates = [document.scrollingElement, ...document.querySelectorAll<HTMLElement>('*')]
      .filter((element): element is HTMLElement => Boolean(element))
      .filter((element) => element.scrollHeight > element.clientHeight + 300);
    candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0]?.scrollTo({ top: 6_000 });
  });
  await expect.poll(scrollTop).toBeGreaterThan(300);
  const buttons = page.getByRole('button').filter({ visible: true });
  const viewport = page.viewportSize()!;
  let backToTop = buttons.last();
  for (let index = 0; index < await buttons.count(); index += 1) {
    const candidate = buttons.nth(index);
    const box = await candidate.boundingBox();
    if (box && box.x > viewport.width - 100 && box.y > viewport.height - 100) {
      backToTop = candidate;
      break;
    }
  }
  await expect(backToTop).toBeVisible();
  await backToTop.click();
  await expect.poll(scrollTop).toBeLessThan(100);
});

test('ESN-426: поле создания публикации уходит из видимой области при прокрутке ленты', async ({ page }) => {
  await page.goto('/feed');
  const composerField = page.getByText('О чем вы хотите написать?', { exact: true });
  await expect(composerField).toBeInViewport();
  await expect(page.locator('a[href*="/post/"]').first()).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => {
    const candidates = [document.scrollingElement, ...document.querySelectorAll<HTMLElement>('*')]
      .filter((element): element is HTMLElement => Boolean(element))
      .filter((element) => element.scrollHeight > element.clientHeight + 300);
    candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0]?.scrollTo({ top: 2_000 });
  });
  await expect(composerField).not.toBeInViewport();
});
