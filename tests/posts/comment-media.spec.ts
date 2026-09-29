import { expect, test, type Locator, type Page } from '@playwright/test';
import { env } from '../helpers/env';
import { createPost, deletePostIfPresent } from '../helpers/post-lifecycle';
import { uniqueMarker } from '../helpers/test-data';

type MediaFile = { name: string; mimeType: string; buffer: Buffer };

function wav(): Buffer {
  const sampleRate = 8_000;
  const samples = sampleRate * 2;
  const size = samples * 2;
  const result = Buffer.alloc(44 + size);
  result.write('RIFF', 0);
  result.writeUInt32LE(36 + size, 4);
  result.write('WAVEfmt ', 8);
  result.writeUInt32LE(16, 16);
  result.writeUInt16LE(1, 20);
  result.writeUInt16LE(1, 22);
  result.writeUInt32LE(sampleRate, 24);
  result.writeUInt32LE(sampleRate * 2, 28);
  result.writeUInt16LE(2, 32);
  result.writeUInt16LE(16, 34);
  result.write('data', 36);
  result.writeUInt32LE(size, 40);
  return result;
}

async function recordedWebm(page: Page): Promise<MediaFile> {
  const generated = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const context = canvas.getContext('2d')!;
    const mimeType = ['video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type))!;
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
    const stopped = new Promise<void>((resolve) => recorder.onstop = () => resolve());
    recorder.start();
    for (let frame = 0; frame < 12; frame += 1) {
      context.fillStyle = `hsl(${frame * 30} 80% 45%)`;
      context.fillRect(0, 0, 64, 48);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    return { mimeType, bytes: [...new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer())] };
  });
  return { name: 'qa-e2e-comment-video.webm', mimeType: generated.mimeType, buffer: Buffer.from(generated.bytes) };
}

async function publishCommentWithFile(page: Page, text: string, file: MediaFile | MediaFile[]): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: 'Комментарии' });
  const input = dialog.locator('input[type="file"]').last();
  await input.setInputFiles(file);
  await dialog.locator('.ql-editor[contenteditable="true"]').fill(text);
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && /\/comment(?:\/|\?|$)/i.test(response.url()),
    { timeout: 30_000 },
  );
  await page.locator('#ekp-browser-banner, #ekp-browser-top-banner').evaluateAll(
    (banners) => banners.forEach((banner) => banner.remove()),
  );
  await dialog.getByRole('button', { name: 'Отправить' }).click();
  expect((await responsePromise).ok()).toBe(true);
  const card = dialog.locator('network-comment-card').filter({ hasText: text }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  return card;
}

test.describe('@mutation Медиафайлы в комментариях', () => {
  test.skip(!env.runMutationTests, 'Для запуска установите RUN_MUTATION_TESTS=true');

  test('ESN-71: публикует изображение, видео, аудио и документ', async ({ page }) => {
    test.setTimeout(180_000);
    const title = uniqueMarker('POST');
    const png: MediaFile = {
      name: 'qa-e2e-comment-image.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xw4AAAAASUVORK5CYII=', 'base64'),
    };
    const audio: MediaFile = { name: 'qa-e2e-comment-audio.wav', mimeType: 'audio/wav', buffer: wav() };
    const document: MediaFile = {
      name: 'qa-e2e-comment-document.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'),
    };
    let postUrl: string | undefined;
    try {
      postUrl = await createPost(page, title, 'Проверка всех типов вложений комментария.');
      await page.goto(postUrl);

      const imageCard = await publishCommentWithFile(page, `${uniqueMarker('COMMENT')}-IMAGE`, png);
      await expect(imageCard.locator(`img[alt="${png.name}"]`)).toBeVisible();

      const video = await recordedWebm(page);
      const videoCard = await publishCommentWithFile(page, `${uniqueMarker('COMMENT')}-VIDEO`, video);
      const videoPlayer = videoCard.locator('video');
      await expect(videoPlayer).toBeAttached({ timeout: 30_000 });
      expect(await videoPlayer.evaluate(async (element: HTMLVideoElement) => {
        element.muted = true;
        await element.play();
        await new Promise((resolve) => setTimeout(resolve, 250));
        return element.currentTime;
      })).toBeGreaterThan(0);

      const audioCard = await publishCommentWithFile(page, `${uniqueMarker('COMMENT')}-AUDIO`, audio);
      const audioPlayer = audioCard.locator('audio');
      await expect(audioPlayer).toBeAttached({ timeout: 30_000 });
      expect(await audioPlayer.evaluate(async (element: HTMLAudioElement) => {
        await element.play();
        await new Promise((resolve) => setTimeout(resolve, 250));
        return element.currentTime;
      })).toBeGreaterThan(0);

      const documentCard = await publishCommentWithFile(page, `${uniqueMarker('COMMENT')}-DOCUMENT`, document);
      await expect(documentCard.getByText(document.name, { exact: true })).toBeVisible();
      const downloadPromise = page.waitForEvent('download');
      await documentCard.getByText(document.name, { exact: true }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(document.name);
    } finally {
      await deletePostIfPresent(page, postUrl);
    }
  });

  test('ESN-75: листает фото и видео в галерее комментария', async ({ page }) => {
    test.setTimeout(120_000);
    const title = uniqueMarker('POST');
    const comment = `${uniqueMarker('COMMENT')}-GALLERY`;
    const images: MediaFile[] = [1, 2].map((number) => ({
      name: `qa-e2e-comment-gallery-${number}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from(number === 1
        ? 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xw4AAAAASUVORK5CYII='
        : 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8Dwn4GBgYGJAQoAHgQCAZb2L9sAAAAASUVORK5CYII=', 'base64'),
    }));
    let postUrl: string | undefined;
    try {
      postUrl = await createPost(page, title, 'Проверка галереи фото и видео комментария.');
      await page.goto(postUrl);
      const video = await recordedWebm(page);
      const card = await publishCommentWithFile(page, comment, [...images, video]);
      await expect(card.locator('img').filter({ visible: true })).toHaveCount(2, { timeout: 30_000 });
      await expect(card.locator('video')).toHaveCount(1);

      await card.locator('.social-media-item__hit').first().click();
      const gallery = page.locator('.pswp').filter({ visible: true });
      await expect(gallery).toBeVisible();
      const counter = gallery.locator('.pswp__counter');
      await expect(counter).toHaveText(/1\s*\/\s*3/);
      const next = gallery.getByRole('button', { name: 'Следующее', exact: true });
      await next.click();
      await expect(counter).toHaveText(/2\s*\/\s*3/);
      await next.click();
      await expect(counter).toHaveText(/3\s*\/\s*3/);
      await expect(gallery.locator('video:visible')).toBeAttached();
      const previous = gallery.getByRole('button', { name: 'Предыдущее', exact: true });
      await previous.click();
      await expect(counter).toHaveText(/2\s*\/\s*3/);
      await page.keyboard.press('Escape');
      await expect(gallery).toBeHidden();
    } finally {
      await deletePostIfPresent(page, postUrl);
    }
  });
});
