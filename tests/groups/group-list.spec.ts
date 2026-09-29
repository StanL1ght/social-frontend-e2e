import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { createTemporaryGroupViaApi, deleteTemporaryGroupViaApi } from '../helpers/group-api';
import { uniqueMarker } from '../helpers/test-data';

test.describe('Список групп', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/group');
    await expect(page.locator('input[placeholder="Поиск по группам"]')).toBeVisible();
  });

  for (const tab of [
    { name: 'Вы подписаны', url: /\/group$/ },
    { name: 'Вы автор', url: /\/group\/owned/ },
    { name: 'Все группы', url: /\/group\/all/ },
  ]) {
    test('вкладка: ' + tab.name, async ({ page }) => {
      await page
        .getByRole('radiogroup')
        .getByRole('button', { name: tab.name, exact: true })
        .click();
      await expect(page).toHaveURL(tab.url);
    });
  }

  test('поиск фильтрует список групп', async ({ page }) => {
    await page.getByRole('button', { name: 'Все группы', exact: true }).click();
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        /\/api\/group\//.test(response.url()) &&
        new URL(response.url()).searchParams.get('name') === 'Тест',
      { timeout: 30_000 },
    );
    const search = page.locator('input[placeholder="Поиск по группам"]');
    await search.fill('Тест');
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    await expect(search).toHaveValue('Тест');
  });

  test('ESN-161, ESN-163: созданная группа отображается в подписках и управлении @mutation', async ({ page }) => {
    test.skip(!env.runMutationTests, 'Для проверки нужна временная группа');
    const name = uniqueMarker('GROUP');
    let groupId: string | undefined;
    try {
      groupId = await createTemporaryGroupViaApi(page, name, 'Публичная группа');
      await page.goto('/group');
      const subscribed = page.getByRole('radiogroup').getByRole('button', { name: 'Вы подписаны', exact: true });
      await expect(subscribed).toBeVisible();
      await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('button', { name: 'Вы администратор', exact: true }).first()).toBeVisible();

      const owned = page.getByRole('radiogroup').getByRole('button', { name: 'Вы автор', exact: true });
      await owned.click();
      await expect(page).toHaveURL(/\/group\/owned/);
      await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('button', { name: 'Вы администратор', exact: true }).first()).toBeVisible();
    } finally {
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });

  test('ESN-153: карточки групп имеют одинаковые размеры на основных вкладках @mutation', async ({ page }) => {
    test.skip(!env.runMutationTests, 'Для проверки нужны временные группы одинакового типа');
    const marker = uniqueMarker('GROUP-PUBLIC');
    const names = Array.from({ length: 3 }, (_, index) => `${marker}-CARD-${index + 1}`);
    const groupIds: string[] = [];
    try {
      for (const name of names) groupIds.push(await createTemporaryGroupViaApi(page, name, 'Публичная группа'));

      for (const tab of ['Вы подписаны', 'Все группы'] as const) {
        await page.goto('/group');
        await page.getByRole('radiogroup').getByRole('button', { name: tab, exact: true }).click();
        await page.locator('input[placeholder="Поиск по группам"]').fill(marker);
        for (const [index, name] of names.entries()) {
          const title = page.getByText(name, { exact: true });
          await expect(title).toBeVisible({ timeout: 20_000 });
          await title.locator('xpath=../../../..').evaluate((element, cardIndex) =>
            element.setAttribute('data-e2e-group-card', String(cardIndex)), index);
        }

        const cards = page.locator('[data-e2e-group-card]');
        await expect(cards).toHaveCount(names.length);
        const geometry = await cards.evaluateAll((elements) => elements.map((element) => {
          const card = element.getBoundingClientRect();
          const image = element.querySelector('img')?.getBoundingClientRect();
          return {
            width: Math.round(card.width),
            height: Math.round(card.height),
            imageWidth: Math.round(image?.width ?? 0),
            imageHeight: Math.round(image?.height ?? 0),
          };
        }));
        expect(new Set(geometry.map((item) => item.width)).size).toBe(1);
        const heights = geometry.map((item) => item.height);
        expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);
        expect(new Set(geometry.map((item) => item.imageWidth)).size).toBe(1);
        expect(new Set(geometry.map((item) => item.imageHeight)).size).toBe(1);
        expect(geometry.every((item) => item.width > 0 && item.height > 0 && item.imageWidth > 0 && item.imageHeight > 0)).toBe(true);
      }
    } finally {
      for (const groupId of groupIds) await deleteTemporaryGroupViaApi(page, groupId);
    }
  });

  test('ESN-176: после возврата восстанавливается позиция списка групп', async ({ page }) => {
    test.fail(true, 'Dev возвращает список групп к scrollTop=0 вместо позиции открытой карточки');
    await page.goto('/group/all');
    await expect(page.getByText(/Публичная группа|Закрытая группа|Скрытая группа/).first()).toBeVisible({ timeout: 20_000 });
    const foundScrollable = await page.locator('body *').evaluateAll((elements) => {
      const candidates = elements
        .filter((element) => element.scrollHeight > element.clientHeight + 300)
        .sort((left, right) => right.scrollHeight - left.scrollHeight);
      const container = candidates[0];
      if (!container) return false;
      container.setAttribute('data-e2e-group-scroll', 'true');
      (container as HTMLElement).scrollTop = Math.floor((container.scrollHeight - container.clientHeight) * 0.7);
      return true;
    });
    expect(foundScrollable, 'На странице должен быть прокручиваемый список групп').toBe(true);

    const container = page.locator('[data-e2e-group-scroll="true"]');
    const savedPosition = await container.evaluate((element) => element.scrollTop);
    expect(savedPosition).toBeGreaterThan(0);
    const visibleGroupImage = container.locator('img[alt]').filter({ visible: true }).evaluateAll((images) => {
      const image = images.reverse().find((candidate) => {
        const alt = candidate.getAttribute('alt') ?? '';
        const box = candidate.getBoundingClientRect();
        return alt.length > 2 && !alt.includes(',') && box.top >= 0 && box.bottom <= innerHeight;
      });
      if (!image) return null;
      image.setAttribute('data-e2e-selected-group', 'true');
      return image.getAttribute('alt');
    });
    const groupName = await visibleGroupImage;
    expect(groupName, 'После прокрутки должна быть видна карточка группы').toBeTruthy();
    await container.locator('[data-e2e-selected-group="true"]').click();
    await expect(page).toHaveURL(/\/group\/[0-9a-f-]+/i);

    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(page).toHaveURL(/\/group\/all/);
    const restoredContainer = page.locator('[data-e2e-group-scroll="true"]');
    await expect.poll(() => restoredContainer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(page.getByText(groupName!, { exact: true }).filter({ visible: true }).first()).toBeInViewport();
  });
});
