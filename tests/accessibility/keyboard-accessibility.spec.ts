import { test, expect } from '../fixtures/test';
import { PostComposerPage } from '../pages/PostComposerPage';

test.describe('Доступность основных пользовательских путей', () => {
  test('переходит по основным разделам с клавиатуры', async ({ page }) => {
    await page.goto('/feed');
    const groups = page.getByRole('link', { name: 'Группы', exact: true });
    await groups.focus();
    await expect(groups).toBeFocused();
    await groups.press('Enter');
    await expect(page).toHaveURL(/\/group(?:[/?#]|$)/);

    const persons = page.getByRole('link', { name: 'Персоны', exact: true });
    await persons.focus();
    await expect(persons).toBeFocused();
    await persons.press('Enter');
    await expect(page).toHaveURL(/\/catalogs(?:[/?#]|$)/);
  });

  test('открывает редактор клавишей Enter и предоставляет именованные действия', async ({ page }) => {
    await page.goto('/feed');
    const write = page.getByRole('button', { name: 'Написать', exact: true });
    await write.focus();
    await expect(write).toBeFocused();
    await write.press('Enter');

    const composer = new PostComposerPage(page);
    await expect(composer.dialog).toBeVisible();
    await expect(composer.dialog.getByRole('button', { name: 'Импорт', exact: true })).toBeVisible();
    await expect(composer.dialog.getByRole('button', { name: 'Предпросмотр', exact: true })).toBeVisible();
    await expect(composer.dialog.getByRole('button', { name: 'Сохранить в черновики', exact: true })).toBeVisible();
    await expect(composer.dialog.getByRole('button', { name: 'Сейчас', exact: true })).toBeVisible();
    await expect(composer.dialog.getByRole('button', { name: 'В точное время', exact: true })).toBeVisible();
    await composer.discard();
  });
});
