import { test, expect } from '../fixtures/test';
import { PostComposerPage } from '../pages/PostComposerPage';

test.describe('Редактор публикации: обязательные поля и границы', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/feed');
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination('Моя лента');
  });

  test.afterEach(async ({ page }) => {
    await new PostComposerPage(page).discard();
  });

  test('ESN-380: показывает полный основной интерфейс редактора', async ({ page }) => {
    const composer = new PostComposerPage(page);

    await expect(composer.dialog.getByRole('combobox').first()).toBeVisible();
    await expect(composer.dialog.getByRole('combobox').nth(1)).toBeVisible();
    const anonymous = composer.dialog.locator('ekp-checkbox[label="Опубликовать анонимно"]');
    await expect(anonymous).toBeVisible();
    await expect(anonymous.locator('input[type="checkbox"]')).toBeDisabled();
    await expect(composer.titleBlock).toHaveAttribute('data-title', 'true');
    await expect(composer.editor).toBeVisible();
    await expect(composer.dialog.getByRole('group', { name: 'Блоки' })).toBeVisible();
    await expect(composer.dialog.getByRole('group', { name: 'Списки' })).toBeVisible();
    await expect(composer.dialog.getByRole('button', { name: 'Закрыть', exact: true })).toBeVisible();
    await expect(composer.dialog.getByRole('button', { name: 'Импорт', exact: true })).toBeVisible();
    await expect(composer.dialog.getByRole('button', { name: 'Предпросмотр', exact: true })).toBeVisible();
    await expect(composer.dialog.getByText(/ТЕГИ|Теги/, { exact: true })).toBeVisible();
    await expect(composer.dialog.getByText(/Сохранить в черновики/)).toBeVisible();
    await expect(composer.dialog.getByText(/В точное время/)).toBeVisible();
    await expect(composer.publishButton()).toBeDisabled();
  });

  test('ESN-382: действия блокируются без заголовка и повторно после его удаления', async ({ page }) => {
    const composer = new PostComposerPage(page);
    const actions = [
      composer.dialog.getByRole('button', { name: 'Предпросмотр', exact: true }),
      composer.publishButton(),
    ];
    for (const action of actions) {
      await expect(action).toBeDisabled();
      await action.locator('..').hover();
      await expect(
        page.getByRole('tooltip', { name: 'Без заголовка публикацию нельзя опубликовать' })
          .filter({ visible: true })
          .first(),
      ).toBeVisible();
    }
    await composer.editor.press('End');
    await composer.editor.press('Enter');
    await page.keyboard.insertText('Тело без заголовка');
    for (const action of actions) await expect(action).toBeDisabled();

    await composer.replaceTitle('Временный заголовок');
    for (const action of actions) await expect(action).toBeEnabled();
    await composer.replaceTitle('');
    for (const action of actions) await expect(action).toBeDisabled();
  });

  test('сохраняет длинный заголовок без потери введённых символов', async ({ page }) => {
    const composer = new PostComposerPage(page);
    const publish = composer.publishButton();

    await expect(publish).toBeDisabled();

    await composer.replaceTitle('П');
    await expect(publish).toBeEnabled();

    await composer.replaceTitle('А'.repeat(120));
    await expect(composer.titleBlock).toHaveText('А'.repeat(120));
    await expect(publish).toBeEnabled();

    await composer.replaceTitle('А'.repeat(121));
    await expect(composer.titleBlock).toHaveText('А'.repeat(121));
    await expect(publish).toBeEnabled();
  });

  test('ESN-385: заголовок ограничен 350 символами', async ({ page }) => {
    const composer = new PostComposerPage(page);
    await composer.replaceTitle('А'.repeat(349));
    await expect(composer.titleBlock).toHaveText('А'.repeat(349));
    await composer.replaceTitle('Б'.repeat(350));
    await expect(composer.titleBlock).toHaveText('Б'.repeat(350));
    await composer.replaceTitle('В'.repeat(351));
    await expect(composer.titleBlock).toHaveText('В'.repeat(350));
    await expect(composer.titleBlock).toHaveAttribute('aria-invalid', 'true');
    await expect(composer.titleBlock).toHaveClass(/is-over-limit/);
    await expect(page.getByRole('tooltip', { name: 'Заголовок не длиннее 350 символов' })).toBeVisible();
  });

  test('несохранённый текст можно закрыть без публикации', async ({ page }) => {
    const composer = new PostComposerPage(page);
    await composer.replaceTitle('QA-E2E-DRAFT-NOT-PUBLISHED');
    await composer.discard();

    await expect(composer.dialog).toBeHidden();
    await expect(page.getByText('QA-E2E-DRAFT-NOT-PUBLISHED', { exact: true })).toHaveCount(0);
  });

  test('ESN-415: закрытие и перезагрузка очищают несохранённое содержимое', async ({ page }) => {
    const composer = new PostComposerPage(page);
    const firstTitle = 'QA-E2E-UNSAVED-CLOSE';
    await composer.fill(firstTitle, 'Несохранённое тело после закрытия.');
    await composer.discard();
    await composer.open();
    await expect(composer.editor).not.toContainText(firstTitle);
    await expect(composer.editor).not.toContainText('Несохранённое тело после закрытия.');

    const secondTitle = 'QA-E2E-UNSAVED-RELOAD';
    await composer.fill(secondTitle, 'Несохранённое тело после обновления.');
    await page.reload();
    await expect(composer.dialog).toBeHidden();
    await composer.open();
    await expect(composer.editor).not.toContainText(secondTitle);
    await expect(composer.editor).not.toContainText('Несохранённое тело после обновления.');
  });
});
