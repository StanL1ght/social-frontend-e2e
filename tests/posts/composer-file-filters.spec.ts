import { test, expect } from '../fixtures/test';
import { PostComposerPage } from '../pages/PostComposerPage';

test.describe('Фильтры системного выбора вложений', () => {
  const cases = [
    { key: 'ESN-391', button: 'Изображение', allowed: /image|\.png|\.jpe?g/i },
    { key: 'ESN-396', button: 'Видео', allowed: /video|\.mp4/i },
    { key: 'ESN-399', button: 'Аудио', allowed: /audio|\.mp3/i },
    { key: 'ESN-404', button: 'Документ (Word, PDF)', allowed: /\.pdf|application\/pdf/i },
  ] as const;

  for (const item of cases) {
    test(`${item.key}: ${item.button} предлагает фильтр допустимых форматов`, async ({ page }) => {
      await page.goto('/feed');
      const composer = new PostComposerPage(page);
      try {
        await composer.open();
        await composer.selectDestination('Моя лента');
        await composer.fill('QA-E2E-FILE-FILTER', 'Проверка фильтра выбора файла.');
        const chooserPromise = page.waitForEvent('filechooser');
        await composer.dialog.getByRole('button', { name: item.button, exact: true }).click();
        const chooser = await chooserPromise;
        const accept = await chooser.element().getAttribute('accept');
        expect(accept).toMatch(item.allowed);
        expect(accept).not.toMatch(/\.txt|text\/plain/i);
        await chooser.setFiles([]);
        await expect(composer.dialog).toBeVisible();
        await expect(composer.titleBlock).toHaveText('QA-E2E-FILE-FILTER');
        await expect(composer.dialog.getByText('qa-e2e-invalid.txt', { exact: true })).toHaveCount(0);
      } finally {
        await composer.discard();
      }
    });
  }
});
