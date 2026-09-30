import { test, expect } from '../fixtures/test';
import { uniqueMarker } from '../helpers/test-data';
import { PostComposerPage } from '../pages/PostComposerPage';

test('ESN-494: несохранённый текст редактора исчезает после обновления страницы', async ({ page }) => {
  const title = uniqueMarker('POST');
  const body = 'Несохранённый текст после обновления страницы.';
  await page.goto('/feed');
  const composer = new PostComposerPage(page);
  await composer.open();
  await composer.fill(title, body);

  await page.reload();
  await expect(composer.dialog).toBeHidden();
  await composer.open();
  try {
    await expect(composer.titleBlock).toBeEmpty();
    await expect(composer.editor).not.toContainText(body);
  } finally {
    await composer.discard();
  }
});

test('ESN-526: дата планирования проверяется, отмена не создаёт публикацию', async ({ page }) => {
  await page.goto('/feed');
  const composer = new PostComposerPage(page);
  await composer.open();
  await composer.fill(uniqueMarker('POST'), 'Проверка времени публикации без сохранения.');
  try {
    await composer.dialog.getByRole('button', { name: 'В точное время', exact: true }).click();
    const scheduling = page.getByRole('dialog', { name: /Публикация в точное время/ });
    await expect(scheduling).toBeVisible();
    const date = scheduling.locator('input[type="date"]');
    const time = scheduling.locator('input[type="time"]');
    const publish = scheduling.getByRole('button', { name: 'Опубликовать в указанное время', exact: true });
    const cancel = scheduling.getByRole('button', { name: 'Отменить', exact: true });
    await expect(date).toBeVisible();
    await expect(time).toBeVisible();
    await expect(cancel).toBeVisible();
    await expect(scheduling).toContainText(/не раньше чем через (?:одну|1) минуту/i);
    await expect(scheduling).toContainText(/пять минут|5 минут/i);

    const moments = await page.evaluate(() => {
      const formatDate = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
      const formatTime = (value: Date) => `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
      const now = new Date();
      return {
        yesterday: formatDate(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
        pastDate: formatDate(new Date(now.getTime() - 60 * 60 * 1000)),
        past: formatTime(new Date(now.getTime() - 60 * 60 * 1000)),
        validDate: formatDate(new Date(now.getTime() + 10 * 60 * 1000)),
        validTime: formatTime(new Date(now.getTime() + 10 * 60 * 1000)),
      };
    });
    await date.fill(moments.pastDate);
    await time.fill(moments.past);
    await expect(publish).toBeDisabled();
    await expect(scheduling).toContainText(/нельзя публиковать задним числом|не раньше чем через (?:одну|1) минуту/i);

    await date.fill(moments.yesterday);
    await expect(publish).toBeDisabled();

    await date.fill(moments.validDate);
    await time.fill(moments.validTime);
    await expect(publish).toBeEnabled();
    await cancel.click();
    await expect(scheduling).toBeHidden();
    await expect(composer.dialog).toBeVisible();
  } finally {
    const scheduling = page.getByRole('dialog', { name: /Публикация в точное время/ });
    if (await scheduling.isVisible().catch(() => false)) {
      await scheduling.getByRole('button', { name: 'Отменить', exact: true }).click();
    }
    await composer.discard();
  }
});
