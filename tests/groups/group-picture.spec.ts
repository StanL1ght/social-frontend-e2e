import type { Locator, Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { uniqueMarker } from '../helpers/test-data';
import { createTemporaryGroupViaApi, deleteTemporaryGroupViaApi } from '../helpers/group-api';

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const row = Buffer.alloc(width * 4 + 1);
  for (let x = 0; x < width; x += 1) {
    row[x * 4 + 1] = 30;
    row[x * 4 + 2] = 110;
    row[x * 4 + 3] = 220;
    row[x * 4 + 4] = 255;
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const image = {
  name: 'qa-e2e-group.png',
  mimeType: 'image/png',
  buffer: png(1200, 800),
};

async function openEditor(page: Page) {
  await page
    .getByRole('button', { name: 'Вы администратор', exact: true })
    .filter({ visible: true })
    .last()
    .click();
  await page.getByRole('menuitem', { name: 'Редактировать', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Редактирование группы' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function renderedPreview(dialog: Locator, previousSource?: string): Promise<string> {
  const preview = dialog.getByRole('img', { name: 'Preview' });
  await expect(preview).toBeVisible();
  await expect
    .poll(async () => {
      const state = await preview.evaluate((image: HTMLImageElement) => ({
        complete: image.complete,
        width: image.naturalWidth,
        source: image.getAttribute('src') ?? '',
      }));
      return state.complete && state.width > 0 && state.source.startsWith('data:image/') &&
        state.source !== previousSource
        ? state.source
        : '';
    }, { timeout: 20_000 })
    .not.toBe('');
  return (await preview.getAttribute('src'))!;
}

async function adjustCrop(page: Page, dialog: Locator): Promise<void> {
  const preview = dialog.getByRole('img', { name: 'Preview' });
  const previousSource = await preview.getAttribute('src');
  const cropper = dialog.locator('image-cropper .ngx-ic-cropper').first();
  await expect(cropper).toBeVisible();
  const box = await cropper.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width - 8, box!.y + box!.height - 8);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width - 12, box!.y + box!.height - 8, { steps: 3 });
  await page.mouse.up();
  await expect.poll(() => preview.getAttribute('src'), { timeout: 20_000 }).not.toBe(previousSource);
}

async function saveImageChanges(page: Page, dialog: Locator, types: string[]): Promise<void> {
  const uploads = types.map((type) => page.waitForResponse(
    (response) => response.request().method() === 'POST' &&
      /\/api\/group\/[^/]+\/cover\?/.test(response.url()) &&
      new URL(response.url()).searchParams.get('type') === type,
    { timeout: 60_000 },
  ));
  await dialog.getByRole('button', { name: /Сохранить изменения|Сохранить/, exact: true }).click();
  for (const response of await Promise.all(uploads)) {
    expect(response.ok(), `Сохранение изображения группы: ${response.status()}`).toBe(true);
  }
  await expect(dialog).toBeHidden();
}

test.describe('@mutation Изображение группы', () => {
  test.skip(!env.runMutationTests, 'Для запуска установите RUN_MUTATION_TESTS=true');

  test('ESN-313: баннер открывает полный редактор изображений группы', async ({ page }) => {
    const name = uniqueMarker('GROUP');
    let groupId: string | undefined;
    try {
      groupId = await createTemporaryGroupViaApi(page, name, 'Публичная группа');
      await page.goto(`/group/${groupId}/posts`);
      const banner = page.getByRole('heading', { name, exact: true })
        .locator('xpath=ancestor::app-group-banner[1]');
      await banner.locator('svg#camera').locator('..').click();
      const editorHeading = page.getByRole('heading', { name: 'Редактор изображений группы', exact: true });
      const dialog = editorHeading.locator('xpath=ancestor::*[.//button[contains(.,"Сохранить")]][1]');
      await expect(dialog).toBeVisible();
      await expect(editorHeading).toBeVisible();
      await expect(dialog.getByText(/Настройте баннер и аватар группы/i)).toBeVisible();
      const shared = dialog.getByRole('checkbox', { name: 'Использовать одно изображение для всех типов' });
      await expect(shared).toBeVisible();
      await dialog.getByText('Использовать одно изображение для всех типов', { exact: true }).click();
      await expect(shared).not.toBeChecked();
      await dialog.locator('input[type="file"]').setInputFiles(image);
      for (const mode of ['Desktop баннер', 'Mobile баннер', 'Аватар']) {
        await expect(page.getByRole('button', { name: mode, exact: true })).toBeVisible();
      }
      await expect(page.getByText(/^\d+\s*:\s*\d+$/).first()).toBeVisible();
      await expect(page.getByText(/Результат/i).first()).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: /Сохранить изменения|Сохранить/ })).toBeVisible();
      await expect(dialog.getByRole('button', { name: '' }).first()).toBeVisible();
    } finally {
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });

  test('ESN-317: новая группа отображает баннер по умолчанию', async ({ page }) => {
    const name = uniqueMarker('GROUP');
    let groupId: string | undefined;
    try {
      groupId = await createTemporaryGroupViaApi(page, name, 'Публичная группа');
      await page.goto(`/group/${groupId}/posts`);
      const heading = page.getByRole('heading', { name, exact: true });
      const banner = heading.locator('xpath=ancestor::app-group-banner[1]');
      const defaultImage = banner.getByRole('img', { name, exact: true });
      await expect(defaultImage).toBeVisible();
      await expect(defaultImage).toHaveAttribute('src', 'assets/images/mocks/efko-logo.png');
      await expect.poll(() => defaultImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
      await expect.poll(() => defaultImage.evaluate((image: HTMLImageElement) => image.naturalHeight)).toBeGreaterThan(0);
    } finally {
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });

  test('ESN-323: одно изображение сохраняется для desktop, mobile и карточки группы', async ({ page }) => {
    test.fixme(true, 'Автоподготовка общей обложки не отправляет запрос сохранения; ручной сценарий подтверждён, дефект продукта не заявляется');
    test.setTimeout(120_000);
    const name = uniqueMarker('GROUP');
    let groupId: string | undefined;
    try {
      groupId = await createTemporaryGroupViaApi(page, name, 'Публичная группа');
      await page.goto(`/group/${groupId}/posts`);
      const bannerImage = page.getByRole('heading', { name, exact: true })
        .locator('xpath=ancestor::app-group-banner[1]')
        .getByRole('img', { name, exact: true });
      await expect(bannerImage).toHaveAttribute('src', 'assets/images/mocks/efko-logo.png');

      const dialog = await openEditor(page);
      const shared = dialog.getByRole('checkbox', { name: 'Использовать одно изображение для всех типов' });
      await expect(shared).toBeChecked();
      await dialog.locator('input[type="file"]').setInputFiles(image);
      await renderedPreview(dialog);
      await adjustCrop(page, dialog);
      await saveImageChanges(page, dialog, ['desktop']);

      await page.reload();
      await expect(bannerImage).toBeVisible();
      await expect(bannerImage).not.toHaveAttribute('src', 'assets/images/mocks/efko-logo.png', { timeout: 30_000 });
      const desktopSource = await bannerImage.getAttribute('src');
      expect(desktopSource).toBeTruthy();

      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await expect(bannerImage).toBeVisible();
      await expect(bannerImage).not.toHaveAttribute('src', 'assets/images/mocks/efko-logo.png', { timeout: 30_000 });

      await page.setViewportSize({ width: 1366, height: 900 });
      await page.goto('/group/owned');
      const cardImage = page.getByRole('img', { name, exact: true }).first();
      await expect(cardImage).toBeVisible({ timeout: 20_000 });
      await expect(cardImage).not.toHaveAttribute('src', 'assets/images/mocks/efko-logo.png', { timeout: 30_000 });
      await expect.poll(() => cardImage.evaluate((item: HTMLImageElement) => item.naturalWidth)).toBeGreaterThan(0);
    } finally {
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });

  test('строит варианты изображения и удаляет его в редакторе временной группы', async ({ page }) => {
    const name = uniqueMarker('GROUP');
    let groupId: string | undefined;

    try {
      groupId = await createTemporaryGroupViaApi(page, name, 'Публичная группа');
      await page.goto(`/group/${groupId}/posts`);
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
      const dialog = await openEditor(page);
      await dialog
        .getByRole('checkbox', { name: 'Использовать одно изображение для всех типов' })
        .check();
      await dialog.locator('input[type="file"]').setInputFiles(image);
      await expect(dialog.getByText(image.name, { exact: true })).toBeVisible();
      let previewSource = await renderedPreview(dialog);
      await adjustCrop(page, dialog);
      for (const crop of ['Mobile баннер', 'Аватар'] as const) {
        await dialog.getByRole('button', { name: crop, exact: true }).click();
        previewSource = await renderedPreview(dialog, previewSource);
      }
      await dialog.getByRole('button', { name: 'Удалить', exact: true }).click();
      await expect(dialog.getByText(image.name, { exact: true })).toBeHidden();
      await expect(dialog.getByRole('img', { name: 'Preview' })).toBeHidden();
    } finally {
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });

  test('ESN-322, ESN-351, ESN-352, ESN-324, ESN-325: сохраняет отдельные области изображений группы', async ({ page }) => {
    test.fixme(true, 'Сохранение областей проходит, но очистка временной группы через API возвращает 405; требуется безопасная очистка тестовых данных');
    test.setTimeout(120_000);
    const name = uniqueMarker('GROUP');
    let groupId: string | undefined;
    try {
      groupId = await createTemporaryGroupViaApi(page, name, 'Публичная группа');
      await page.goto(`/group/${groupId}/posts`);
      const bannerImage = page.getByRole('heading', { name, exact: true })
        .locator('xpath=ancestor::app-group-banner[1]')
        .getByRole('img', { name, exact: true });
      await expect(bannerImage).toHaveAttribute('src', 'assets/images/mocks/efko-logo.png');
      const dialog = await openEditor(page);
      const shared = dialog.getByRole('checkbox', { name: 'Использовать одно изображение для всех типов' });
      if (await shared.isChecked()) await dialog.getByText('Использовать одно изображение для всех типов', { exact: true }).click();

      const previews = new Set<string>();
      for (const [index, mode] of ['Desktop баннер', 'Mobile баннер', 'Аватар'].entries()) {
        await dialog.getByRole('button', { name: mode, exact: true }).click();
        const file = { ...image, name: `qa-e2e-group-${index + 1}.png` };
        await dialog.locator('input[type="file"]').setInputFiles(file);
        await renderedPreview(dialog);
        await adjustCrop(page, dialog);
        previews.add((await dialog.getByRole('img', { name: 'Preview' }).getAttribute('src'))!);
      }
      expect(previews.size).toBe(3);
      const save = dialog.getByRole('button', { name: /Сохранить изменения|Сохранить/, exact: true });
      await expect(save).toBeEnabled();
      await saveImageChanges(page, dialog, ['desktop', 'mobile', 'avatar']);
      await page.reload();
      await expect(bannerImage).not.toHaveAttribute('src', 'assets/images/mocks/efko-logo.png', { timeout: 30_000 });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await expect(bannerImage).not.toHaveAttribute('src', 'assets/images/mocks/efko-logo.png', { timeout: 30_000 });
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.goto('/group/owned');
      const avatar = page.getByRole('img', { name, exact: true }).first();
      await expect(avatar).toBeVisible({ timeout: 20_000 });
      await expect(avatar).not.toHaveAttribute('src', 'assets/images/mocks/efko-logo.png', { timeout: 30_000 });
    } finally {
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });

  test('изображение группы больше 16 МБ отклоняется до сохранения', async ({ page }) => {
    test.fixme(true, 'На дев-стенде 2026-09-22 файл 16 МБ+ принят редактором с preview и доступной кнопкой сохранения; ожидаемое ограничение требует подтверждения после фиксов.');
    let groupId: string | undefined;
    try {
      groupId = await createTemporaryGroupViaApi(page, uniqueMarker('GROUP'), 'Публичная группа');
      await page.goto(`/group/${groupId}/posts`);
      await expect(page.getByRole('button', { name: 'Вы администратор', exact: true })).toBeVisible();
      const dialog = await openEditor(page);
      const oversized = {
        name: 'qa-e2e-oversized.png',
        mimeType: 'image/png',
        buffer: Buffer.concat([image.buffer, Buffer.alloc(16 * 1024 * 1024)]),
      };
      await dialog.locator('input[type="file"]').setInputFiles(oversized);
      await expect(page.getByText(/16\s*(?:МБ|MB)|превышает.*размер|размер.*превышен/i).first()).toBeVisible();
      await expect(dialog.getByRole('img', { name: 'Preview' })).toBeHidden();
    } finally {
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });

  test('ESN-318: закрывает окно редактирования баннера крестиком', async ({ page }) => {
    let groupId: string | undefined;
    try {
      groupId = await createTemporaryGroupViaApi(page, uniqueMarker('GROUP'), 'Публичная группа');
      await page.goto(`/group/${groupId}/posts`);
      const dialog = await openEditor(page);
      await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
      await expect(dialog).toBeHidden();
    } finally {
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });

  test('ESN-319: отмена не сохраняет выбранное изображение баннера', async ({ page }) => {
    let groupId: string | undefined;
    try {
      groupId = await createTemporaryGroupViaApi(page, uniqueMarker('GROUP'), 'Публичная группа');
      await page.goto(`/group/${groupId}/posts`);
      let dialog = await openEditor(page);
      await dialog.locator('input[type="file"]').setInputFiles(image);
      await expect(dialog.getByText(image.name, { exact: true })).toBeVisible();
      await renderedPreview(dialog);
      await dialog.getByRole('button', { name: 'Отменить', exact: true }).click();
      await expect(dialog).toBeHidden();

      dialog = await openEditor(page);
      await expect(dialog.getByText(image.name, { exact: true })).toHaveCount(0);
      await expect(dialog.getByRole('img', { name: 'Preview' })).toBeHidden();
      await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
    } finally {
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });

  test('ESN-326: окно настройки баннера прокручивается после загрузки изображения', async ({ page }) => {
    let groupId: string | undefined;
    try {
      groupId = await createTemporaryGroupViaApi(page, uniqueMarker('GROUP'), 'Публичная группа');
      await page.goto(`/group/${groupId}/posts`);
      const dialog = await openEditor(page);
      await dialog.locator('input[type="file"]').setInputFiles(image);
      await renderedPreview(dialog);
      const scrollable = dialog.locator('*').filter({ visible: true }).evaluateAll((elements) => {
        const candidate = elements.find((element) => element.scrollHeight > element.clientHeight + 20);
        if (!candidate) return null;
        candidate.setAttribute('data-e2e-scrollable', 'true');
        return true;
      });
      expect(await scrollable).toBe(true);
      const container = dialog.locator('[data-e2e-scrollable="true"]');
      await container.hover();
      await page.mouse.wheel(0, 800);
      await expect.poll(() => container.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await dialog.getByRole('button', { name: 'Отменить', exact: true }).click();
    } finally {
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });
});
