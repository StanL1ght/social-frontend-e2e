import { test, expect } from '../fixtures/test';
import { PostComposerPage } from '../pages/PostComposerPage';

test.describe('@mobile Мобильный и узкий вид', () => {
  test('ESN-36: основные разделы не выходят за viewport от desktop до 320 px', async ({ page }) => {
    test.setTimeout(120_000);
    const currentResponse = await page.request.get('https://dev-social-backend.sddt.efko.ru/api/user/current');
    expect(currentResponse.ok()).toBe(true);
    const current = (await currentResponse.json()) as { id: string };
    const sections = [
      { path: '/feed', ready: page.locator('network-post-card').first() },
      { path: '/group', ready: page.getByRole('button', { name: 'Создать группу' }) },
      { path: '/catalogs', ready: page.getByPlaceholder(/Поиск/i).first() },
      { path: `/profile/${current.id}`, ready: page.getByRole('button', { name: 'Публикации', exact: true }) },
      { path: '/my-publications', ready: page.getByRole('button', { name: /^Опубликованные/ }) },
    ];

    for (const section of sections) {
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.goto(section.path);
      await expect(section.ready).toBeVisible({ timeout: 20_000 });
      for (const width of [1366, 1024, 768, 480, 320]) {
        await page.setViewportSize({ width, height: width <= 480 ? 720 : 900 });
        await expect(section.ready).toBeVisible();
        const layout = await page.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          document: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
        }));
        expect(
          Math.max(layout.document, layout.body),
          `${section.path}: горизонтальный overflow при ширине ${width}px`,
        ).toBeLessThanOrEqual(layout.viewport + 1);
      }
    }
  });

  test('ESN-2: лента сохраняет контент при переходе desktop → mobile → desktop', async ({ page }) => {
    const hasHorizontalOverflow = () => page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );

    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('/feed');
    const firstCard = page.locator('network-post-card').first();
    await expect(firstCard).toBeVisible({ timeout: 20_000 });
    const title = (await firstCard.getByRole('heading').first().innerText()).trim();
    expect(title).toBeTruthy();
    expect(await hasHorizontalOverflow()).toBe(false);
    await expect(page.getByRole('link', { name: 'Лента', exact: true })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: 20_000 });
    expect(await hasHorizontalOverflow()).toBe(false);
    await expect(page.getByRole('button', { name: 'Написать', exact: true })).toBeVisible();

    for (const width of [480, 768, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      expect(await hasHorizontalOverflow(), `Горизонтальная прокрутка при ширине ${width}px`).toBe(false);
    }

    await page.setViewportSize({ width: 1366, height: 900 });
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Лента', exact: true })).toBeVisible();
    expect(await hasHorizontalOverflow()).toBe(false);
  });

  test('шапка групп содержит мобильные элементы', async ({ page }) => {
    await page.goto('/group');

    await expect(page.getByRole('button', { name: 'Создать группу' })).toBeVisible();
    await expect(page.locator('input[placeholder="Поиск"]:visible').first()).toBeVisible();
    await expect(page.getByText('Дивизион', { exact: true }).first()).toBeVisible();
  });

  test('ширина страницы не превышает viewport', async ({ page }) => {
    await page.goto('/feed');
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));

    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
  });

  test('ESN-327: кнопка «Действия» открывает кнопки сохранения и публикации', async ({ page }) => {
    await page.goto('/feed');
    const composer = new PostComposerPage(page);
    await composer.open();
    try {
      await composer.dialog.getByRole('button', { name: 'Действия', exact: true }).click();
      const actions = page.getByRole('dialog', { name: 'Действия', exact: true });
      await expect(actions).toBeVisible();
      for (const name of ['Импорт', 'Предпросмотр', 'Сохранить в черновики', 'Сейчас', 'В точное время']) {
        await expect(actions.getByRole('button', { name, exact: true })).toBeVisible();
      }
      await actions.getByRole('button', { name: 'Закрыть', exact: true }).click();
    } finally {
      await composer.discard();
    }
  });
});
