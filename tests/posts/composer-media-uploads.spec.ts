import { expect, type FileChooser, type Page } from '@playwright/test';
import { createDeflate } from 'node:zlib';
import { once } from 'node:events';
import { stat, truncate, unlink, writeFile } from 'node:fs/promises';
import { test } from '../fixtures/test';
import { env } from '../helpers/env';
import { deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { PostComposerPage } from '../pages/PostComposerPage';

export type UploadFile = {
  name: string;
  mimeType: string;
  buffer: Buffer;
};

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

export async function png(width: number, height: number): Promise<Buffer> {
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

  const deflater = createDeflate({ level: 9 });
  const compressed: Buffer[] = [];
  deflater.on('data', (chunk: Buffer) => compressed.push(chunk));
  for (let y = 0; y < height; y += 1) {
    if (!deflater.write(row)) await once(deflater, 'drain');
  }
  deflater.end();
  await once(deflater, 'end');

  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', Buffer.concat(compressed)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function pdf(contents: string): Buffer {
  const stream = `BT /F1 12 Tf 30 100 Td (${contents.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 150] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let document = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    document += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document);
}

export function wav(seconds = 2): Buffer {
  const sampleRate = 8_000;
  const samples = sampleRate * seconds;
  const dataSize = samples * 2;
  const result = Buffer.alloc(44 + dataSize);
  result.write('RIFF', 0);
  result.writeUInt32LE(36 + dataSize, 4);
  result.write('WAVEfmt ', 8);
  result.writeUInt32LE(16, 16);
  result.writeUInt16LE(1, 20);
  result.writeUInt16LE(1, 22);
  result.writeUInt32LE(sampleRate, 24);
  result.writeUInt32LE(sampleRate * 2, 28);
  result.writeUInt16LE(2, 32);
  result.writeUInt16LE(16, 34);
  result.write('data', 36);
  result.writeUInt32LE(dataSize, 40);
  return result;
}

export async function recordedWebm(page: Page): Promise<UploadFile> {
  const generated = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 54;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    const mimeType = ['video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('WebM MediaRecorder is unavailable');

    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    const stopped = new Promise<void>((resolve) => recorder.addEventListener('stop', () => resolve(), { once: true }));
    recorder.start();
    for (let frame = 0; frame < 18; frame += 1) {
      context.fillStyle = `hsl(${frame * 20} 80% 45%)`;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#fff';
      context.font = '24px sans-serif';
      context.fillText(String(frame), 38, 35);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    const bytes = new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer());
    return { mimeType, bytes: [...bytes] };
  });
  return {
    name: 'qa-e2e-video.webm',
    mimeType: generated.mimeType,
    buffer: Buffer.from(generated.bytes),
  };
}

export async function chooseFiles(
  page: Page,
  composer: PostComposerPage,
  buttonName: string,
  files: UploadFile | UploadFile[],
): Promise<FileChooser> {
  const chooserPromise = page.waitForEvent('filechooser');
  await composer.dialog.getByRole('button', { name: buttonName, exact: true }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(files);
  return chooser;
}

async function openComposer(page: Page, title: string): Promise<PostComposerPage> {
  await page.goto('/feed');
  const composer = new PostComposerPage(page);
  await composer.open();
  await composer.selectDestination('Моя лента');
  await composer.fill(title, 'Автоматическая проверка вложения.');
  return composer;
}

async function publishAndGetId(page: Page, composer: PostComposerPage): Promise<string> {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && /\/api\/post\/?(?:\?|$)/i.test(response.url()),
    { timeout: 30_000 },
  );
  await composer.publishNow();
  const response = await responsePromise;
  expect(response.ok(), `Создание публикации: ${response.status()}`).toBe(true);
  const body = (await response.json()) as { id?: string };
  expect(body.id, 'Ответ создания публикации должен содержать id').toBeTruthy();
  return body.id!;
}

test.describe('@mutation Медиа и документы в редакторе публикации', () => {
  test.skip(!env.runMutationTests, 'Для запуска установите RUN_MUTATION_TESTS=true');

  test('ESN-388, ESN-390: публикует валидное изображение 8K без горизонтального переполнения', async ({ page }) => {
    test.setTimeout(120_000);
    const title = `${uniqueMarker('POST')}-MEDIA-8K`;
    const image: UploadFile = {
      name: 'qa-e2e-8k.png',
      mimeType: 'image/png',
      buffer: await png(7680, 4320),
    };
    let postId: string | undefined;

    try {
      const composer = await openComposer(page, title);
      await chooseFiles(page, composer, 'Изображение', image);
      const editorImage = composer.editor.locator('img').last();
      await expect(editorImage).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(async () => editorImage.evaluate((node) => (node as HTMLImageElement).naturalWidth))
        .toBe(7680);
      await expect
        .poll(async () => editorImage.evaluate((node) => node.scrollWidth <= node.clientWidth))
        .toBe(true);

      postId = await publishAndGetId(page, composer);
      const heading = page.getByRole('heading', { name: title, exact: true });
      await expect(heading).toBeVisible({ timeout: 30_000 });
      const card = heading.locator('xpath=ancestor::network-post-card[1]');
      const publishedImage = card.locator(`img[alt="${image.name}"]`);
      await expect(publishedImage).toBeVisible();
      await page.setViewportSize({ width: 720, height: 900 });
      await expect(card).toBeVisible();
      await expect.poll(() => publishedImage.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

  test('ESN-402: публикует PDF и скачивает исходное содержимое', async ({ page }) => {
    const title = `${uniqueMarker('POST')}-DOCUMENT`;
    const contents = `${uniqueMarker('POST')}-PDF-CONTENT`;
    const document: UploadFile = {
      name: 'qa-e2e-document.pdf',
      mimeType: 'application/pdf',
      buffer: pdf(contents),
    };
    let postId: string | undefined;

    try {
      const composer = await openComposer(page, title);
      await chooseFiles(page, composer, 'Документ (Word, PDF)', document);
      await expect(composer.dialog.getByText(document.name, { exact: true })).toBeVisible({ timeout: 30_000 });
      postId = await publishAndGetId(page, composer);

      await page.goto(`/post/${postId}`);
      const heading = page.getByRole('heading', { name: title, exact: true });
      await expect(heading).toBeVisible({ timeout: 30_000 });
      const card = heading.locator('xpath=ancestor::network-post-card[1]');
      const downloadPromise = page.waitForEvent('download');
      await card.getByText(document.name, { exact: true }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(document.name);
      const stream = await download.createReadStream();
      expect(stream).toBeTruthy();
      const chunks: Buffer[] = [];
      for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks)).toEqual(document.buffer);
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

  test('ESN-397: публикует валидный WAV и запускает его в аудиоплеере', async ({ page }) => {
    const title = `${uniqueMarker('POST')}-AUDIO`;
    const audio: UploadFile = {
      name: 'qa-e2e-audio.wav',
      mimeType: 'audio/wav',
      buffer: wav(),
    };
    let postId: string | undefined;

    try {
      const composer = await openComposer(page, title);
      await chooseFiles(page, composer, 'Аудио', audio);
      await expect(composer.dialog.getByText(audio.name, { exact: true })).toBeVisible({ timeout: 30_000 });
      postId = await publishAndGetId(page, composer);

      await page.goto(`/post/${postId}`);
      const heading = page.getByRole('heading', { name: title, exact: true });
      const card = heading.locator('xpath=ancestor::network-post-card[1]');
      await expect(card.getByText(audio.name, { exact: true })).toBeVisible({ timeout: 30_000 });
      const player = card.locator('audio').first();
      await expect(player).toBeAttached();
      const playback = await player.evaluate(async (element: HTMLAudioElement) => {
        element.muted = true;
        await element.play();
        await new Promise((resolve) => setTimeout(resolve, 250));
        return { paused: element.paused, currentTime: element.currentTime };
      });
      expect(playback.paused).toBe(false);
      expect(playback.currentTime).toBeGreaterThan(0);
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

  test('ESN-400, ESN-401: два аудиоплеера работают одновременно и меняют громкость и скорость', async ({ page }) => {
    const title = `${uniqueMarker('POST')}-TWO-AUDIO`;
    const audios: UploadFile[] = [1, 2].map((number) => ({
      name: `qa-e2e-audio-${number}.wav`,
      mimeType: 'audio/wav',
      buffer: wav(3),
    }));
    let postId: string | undefined;

    try {
      const composer = await openComposer(page, title);
      await chooseFiles(page, composer, 'Аудио', audios);
      for (const audio of audios) {
        await expect(composer.dialog.getByText(audio.name, { exact: true })).toBeVisible({ timeout: 30_000 });
      }
      postId = await publishAndGetId(page, composer);

      await page.goto(`/post/${postId}`);
      const card = page.getByRole('heading', { name: title, exact: true }).locator('xpath=ancestor::network-post-card[1]');
      const players = card.locator('audio');
      await expect(players).toHaveCount(2, { timeout: 30_000 });
      for (const audio of audios) await expect(card.getByText(audio.name, { exact: true })).toBeVisible();

      const state = await players.evaluateAll(async (elements: HTMLAudioElement[]) => {
        for (const element of elements) {
          element.muted = true;
          await element.play();
        }
        elements[0].volume = 0.25;
        elements[1].volume = 0.75;
        elements[0].playbackRate = 0.25;
        elements[1].playbackRate = 2;
        await new Promise((resolve) => setTimeout(resolve, 300));
        return elements.map((element) => ({
          paused: element.paused,
          currentTime: element.currentTime,
          volume: element.volume,
          playbackRate: element.playbackRate,
        }));
      });
      expect(state).toEqual([
        expect.objectContaining({ paused: false, volume: 0.25, playbackRate: 0.25 }),
        expect.objectContaining({ paused: false, volume: 0.75, playbackRate: 2 }),
      ]);
      await expect.poll(async () =>
        players.evaluateAll((elements: HTMLAudioElement[]) => elements.every((element) => element.currentTime > 0)),
      ).toBe(true);

      const source = await players.first().evaluate((element: HTMLAudioElement) =>
        element.currentSrc || element.querySelector('source')?.src || '',
      );
      expect(source, 'У аудиоплеера должен быть адрес загруженного файла').toBeTruthy();
      const downloaded = await page.request.get(source);
      expect(downloaded.ok(), `Скачивание аудио: ${downloaded.status()}`).toBe(true);
      expect(await downloaded.body()).toEqual(audios[0].buffer);
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

  test('ESN-392: публикует сгенерированное видео и запускает его', async ({ page }) => {
    test.setTimeout(120_000);
    const title = `${uniqueMarker('POST')}-VIDEO`;
    let postId: string | undefined;

    try {
      const composer = await openComposer(page, title);
      const video = await recordedWebm(page);
      await chooseFiles(page, composer, 'Видео', video);
      const editorVideo = composer.dialog.locator('video').first();
      await expect(editorVideo).toBeAttached({ timeout: 30_000 });
      await expect.poll(() => editorVideo.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThan(0);
      await expect(composer.dialog.getByText('Выбрать обложку', { exact: true })).toBeVisible();
      postId = await publishAndGetId(page, composer);

      await page.goto(`/post/${postId}`);
      const heading = page.getByRole('heading', { name: title, exact: true });
      const card = heading.locator('xpath=ancestor::network-post-card[1]');
      const player = card.locator('video').first();
      await expect(player).toBeAttached({ timeout: 30_000 });
      const playback = await player.evaluate(async (element: HTMLVideoElement) => {
        element.muted = true;
        await element.play();
        await new Promise((resolve) => setTimeout(resolve, 250));
        return { paused: element.paused, currentTime: element.currentTime };
      });
      expect(playback.paused).toBe(false);
      expect(playback.currentTime).toBeGreaterThan(0);
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

  test('ESN-393: выбирает другой кадр обложки видео и публикует его', async ({ page }) => {
    test.setTimeout(120_000);
    const title = `${uniqueMarker('POST')}-VIDEO-COVER`;
    let postId: string | undefined;
    try {
      const composer = await openComposer(page, title);
      await chooseFiles(page, composer, 'Видео', await recordedWebm(page));
      const editorVideo = composer.dialog.locator('video').first();
      await expect(editorVideo).toBeAttached({ timeout: 30_000 });
      await composer.dialog.getByText('Выбрать обложку', { exact: true }).click();
      const coverDialog = page.getByRole('dialog', { name: 'Выбор обложки' });
      await expect(coverDialog).toBeVisible();
      const slider = coverDialog.getByRole('slider');
      await expect(slider).toBeVisible();
      const maximum = Number(await slider.getAttribute('max'));
      const step = Number(await slider.getAttribute('step'));
      expect(maximum).toBeGreaterThan(0);
      const selectedTime = (Math.floor((maximum * 0.75) / step) * step).toFixed(2);
      await slider.fill(selectedTime);
      await expect(slider).toHaveValue(selectedTime);
      await coverDialog.getByRole('button', { name: 'Готово', exact: true }).click();
      await expect(coverDialog).toBeHidden();
      await expect.poll(() => editorVideo.getAttribute('poster')).toBeTruthy();

      postId = await publishAndGetId(page, composer);
      await page.goto(`/post/${postId}`);
      const published = page.getByRole('heading', { name: title, exact: true })
        .locator('xpath=ancestor::network-post-card[1]').locator('video').first();
      await expect(published).toBeAttached({ timeout: 30_000 });
      await expect.poll(() => published.getAttribute('poster')).toBeTruthy();
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

  test('ESN-394: отменяет выбор другого кадра обложки видео', async ({ page }) => {
    test.setTimeout(120_000);
    const composer = await openComposer(page, `${uniqueMarker('POST')}-VIDEO-COVER-CANCEL`);
    try {
      await chooseFiles(page, composer, 'Видео', await recordedWebm(page));
      const editorVideo = composer.dialog.locator('video').first();
      await expect(editorVideo).toBeAttached({ timeout: 30_000 });
      const initialPoster = await editorVideo.getAttribute('poster');
      await composer.dialog.getByText('Выбрать обложку', { exact: true }).click();
      const coverDialog = page.getByRole('dialog', { name: 'Выбор обложки' });
      const slider = coverDialog.getByRole('slider');
      const maximum = Number(await slider.getAttribute('max'));
      const step = Number(await slider.getAttribute('step'));
      await slider.fill((Math.floor((maximum * 0.75) / step) * step).toFixed(2));
      await coverDialog.getByRole('button', { name: 'Отмена', exact: true }).click();
      await expect(coverDialog).toBeHidden();
      expect(await editorVideo.getAttribute('poster')).toBe(initialPoster);
    } finally {
      const coverDialog = page.getByRole('dialog', { name: 'Выбор обложки' });
      if (await coverDialog.isVisible()) {
        await coverDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
        await expect(coverDialog).toBeHidden();
      }
      await composer.discard();
    }
  });

  test('ESN-434: воспроизводит и останавливает видео прямо в редакторе', async ({ page }) => {
    test.setTimeout(120_000);
    const composer = await openComposer(page, `${uniqueMarker('POST')}-EDITOR-VIDEO-PLAYBACK`);
    try {
      await chooseFiles(page, composer, 'Видео', await recordedWebm(page));
      const video = composer.dialog.locator('video').first();
      await expect(video).toBeAttached({ timeout: 30_000 });
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThan(0);
      const playing = await video.evaluate(async (element: HTMLVideoElement) => {
        element.muted = true;
        await element.play();
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { paused: element.paused, currentTime: element.currentTime };
      });
      expect(playing.paused).toBe(false);
      expect(playing.currentTime).toBeGreaterThan(0);
      const pausedAt = await video.evaluate((element: HTMLVideoElement) => {
        element.pause();
        return element.currentTime;
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(pausedAt, 1);
      await expect(composer.dialog).toBeVisible();
    } finally {
      await composer.discard();
    }
  });

  test('ESN-431: видео воспроизводится по hover в ленте, после раскрытия и детально', async ({ page }) => {
    test.setTimeout(150_000);
    const title = `${uniqueMarker('POST')}-VIDEO-HOVER`;
    let postId: string | undefined;
    const assertHoverCycle = async (video: import('@playwright/test').Locator, leaveTarget: import('@playwright/test').Locator) => {
      await video.hover({ force: true });
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => ({
        paused: element.paused,
        muted: element.muted,
        currentTime: element.currentTime,
      }))).toEqual(expect.objectContaining({ paused: false, muted: true }));
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
      await leaveTarget.hover();
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
      await video.hover({ force: true });
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeLessThan(0.5);
    };

    try {
      const composer = await openComposer(page, title);
      await composer.editor.locator('p').first().fill(`${'Длинный текст для раскрытия видео в ленте. '.repeat(120)} Конец.`);
      await chooseFiles(page, composer, 'Видео', await recordedWebm(page));
      postId = await publishAndGetId(page, composer);

      await page.goto('/feed');
      const heading = page.getByRole('heading', { name: title, exact: true });
      await expect(heading).toBeVisible({ timeout: 30_000 });
      const card = heading.locator('xpath=ancestor::network-post-card[1]');
      const feedVideo = card.locator('video').first();
      await expect(feedVideo).toBeAttached();
      await assertHoverCycle(feedVideo, heading);

      const readMore = card.getByText('Читать далее', { exact: true });
      await expect(readMore).toBeVisible();
      await readMore.click();
      await assertHoverCycle(card.locator('video').first(), heading);

      await page.goto(`/post/${postId}`);
      const detailHeading = page.getByRole('heading', { name: title, exact: true });
      const detailCard = detailHeading.locator('xpath=ancestor::network-post-card[1]');
      await assertHoverCycle(detailCard.locator('video').first(), detailHeading);
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

  test('ESN-432: открывает видео по клику, ставит на паузу и продолжает детально', async ({ page }) => {
    test.setTimeout(150_000);
    const title = `${uniqueMarker('POST')}-VIDEO-CLICK`;
    let postId: string | undefined;
    try {
      const composer = await openComposer(page, title);
      await chooseFiles(page, composer, 'Видео', await recordedWebm(page));
      postId = await publishAndGetId(page, composer);

      await page.goto('/feed');
      const card = page.getByRole('heading', { name: title, exact: true })
        .locator('xpath=ancestor::network-post-card[1]');
      const feedVideo = card.locator('video').first();
      await feedVideo.hover({ force: true });
      await feedVideo.click({ force: true });
      const player = page.locator('.pswp').filter({ visible: true });
      await expect(player).toBeVisible();
      const playerVideo = player.locator('video:visible');
      await expect(playerVideo).toBeAttached();
      await expect.poll(() => playerVideo.evaluate((element: HTMLVideoElement) => ({
        paused: element.paused,
        muted: element.muted,
      }))).toEqual({ paused: false, muted: true });
      await playerVideo.click({ force: true });
      await expect.poll(() => playerVideo.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
      await page.keyboard.press('Escape');
      await expect(player).toBeHidden();

      await page.goto(`/post/${postId}`);
      const detailVideo = page.getByRole('heading', { name: title, exact: true })
        .locator('xpath=ancestor::network-post-card[1]').locator('video').first();
      await detailVideo.hover({ force: true });
      await expect.poll(() => detailVideo.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
      await detailVideo.click({ force: true });
      await expect.poll(() => detailVideo.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
      await detailVideo.click({ force: true });
      await expect.poll(() => detailVideo.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
      await page.mouse.move(0, 0);
      await expect.poll(() => detailVideo.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

  test('ESN-433: управляет воспроизведением, громкостью, временем и полноэкранным режимом', async ({ page }) => {
    test.setTimeout(150_000);
    const title = `${uniqueMarker('POST')}-VIDEO-PLAYER`;
    let postId: string | undefined;
    try {
      const composer = await openComposer(page, title);
      await chooseFiles(page, composer, 'Видео', await recordedWebm(page));
      postId = await publishAndGetId(page, composer);
      await page.goto('/feed');
      const card = page.getByRole('heading', { name: title, exact: true })
        .locator('xpath=ancestor::network-post-card[1]');
      const preview = card.locator('video').first();
      await preview.hover({ force: true });
      await preview.click({ force: true });

      const player = page.locator('.pswp').filter({ visible: true });
      const video = player.locator('video:visible');
      await expect(video).toBeAttached();
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => ({
        paused: element.paused,
        muted: element.muted,
      }))).toEqual({ paused: false, muted: true });

      await video.click({ force: true });
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
      const play = player.getByRole('button', { name: /Воспроизвести|Плей/i });
      await play.click();
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
      await player.getByRole('button', { name: 'Пауза', exact: true }).click();
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);

      await player.getByRole('button', { name: 'Включить звук', exact: true }).click();
      const volumeTrack = player.locator('.pswp-video__vol-track');
      const timeline = player.locator('.pswp-video__track');
      await expect(volumeTrack).toBeVisible();
      await expect(timeline).toBeVisible();
      const clickAt = async (track: import('@playwright/test').Locator, ratio: number) => {
        const box = await track.boundingBox();
        expect(box).toBeTruthy();
        await page.mouse.click(box!.x + box!.width * ratio, box!.y + box!.height / 2);
      };
      await clickAt(volumeTrack, 0.8);
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.volume)).toBeCloseTo(0.8, 1);
      await clickAt(volumeTrack, 0.2);
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.volume)).toBeCloseTo(0.2, 1);

      const duration = await video.evaluate((element: HTMLVideoElement) => element.duration);
      await clickAt(timeline, 0.65);
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(duration * 0.65, 1);

      const fullscreen = player.getByRole('button', { name: /Полноэкранный режим/i });
      await fullscreen.hover();
      await expect(fullscreen).toHaveAttribute('title', 'Полноэкранный режим');
      await fullscreen.click();
      await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
      await page.keyboard.press('Escape');
      await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
      await page.keyboard.press('Escape');
      await expect(player).toBeHidden();
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

  test('ESN-310: детальное воспроизведение видео увеличивает счётчик просмотров один раз', async ({ page }) => {
    test.skip(true, 'Кейс устарел: счётчик просмотров видео удалён из продукта');
    test.setTimeout(120_000);
    const title = `${uniqueMarker('POST')}-VIDEO-VIEW`;
    let postId: string | undefined;
    try {
      const composer = await openComposer(page, title);
      await chooseFiles(page, composer, 'Видео', await recordedWebm(page));
      postId = await publishAndGetId(page, composer);
      await page.goto(`/post/${postId}`);
      const card = page.getByRole('heading', { name: title, exact: true })
        .locator('xpath=ancestor::network-post-card[1]');
      const views = card.locator('[title="Просмотры"]');
      await expect(views).toBeVisible();
      const initial = Number((await views.innerText()).trim());
      const video = card.locator('video').first();
      await video.click({ force: true });
      await expect.poll(async () => Number((await views.innerText()).trim()), { timeout: 20_000 }).toBe(initial + 1);
      await video.click({ force: true });
      await expect.poll(async () => Number((await views.innerText()).trim())).toBe(initial + 1);
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

  test('ESN-418: листает фото и видео в галерее публикации', async ({ page }) => {
    test.setTimeout(120_000);
    const title = `${uniqueMarker('POST')}-MEDIA-GALLERY`;
    const images: UploadFile[] = [1, 2].map((number) => ({
      name: `qa-e2e-gallery-${number}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from(number === 1
        ? 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xw4AAAAASUVORK5CYII='
        : 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8Dwn4GBgYGJAQoAHgQCAZb2L9sAAAAASUVORK5CYII=', 'base64'),
    }));
    let postId: string | undefined;
    try {
      const composer = await openComposer(page, title);
      await chooseFiles(page, composer, 'Изображение', images);
      await expect(composer.editor.locator('img')).toHaveCount(2, { timeout: 30_000 });
      await chooseFiles(page, composer, 'Видео', await recordedWebm(page));
      await expect(composer.dialog.locator('video')).toBeAttached({ timeout: 30_000 });
      postId = await publishAndGetId(page, composer);

      await page.goto(`/post/${postId}`);
      const card = page.getByRole('heading', { name: title, exact: true }).locator('xpath=ancestor::network-post-card[1]');
      for (const image of images) await expect(card.locator(`img[alt="${image.name}"]`)).toBeVisible();
      await expect(card.locator('video')).toHaveCount(1);
      await card.locator(`img[alt="${images[0].name}"]`).click({ force: true });
      const gallery = page.locator('.pswp').filter({ visible: true });
      const counter = gallery.locator('.pswp__counter');
      await expect(counter).toHaveText(/1\s*\/\s*3/);
      const next = gallery.getByRole('button', { name: 'Следующее', exact: true });
      await next.click();
      await expect(counter).toHaveText(/2\s*\/\s*3/);
      await next.click();
      await expect(counter).toHaveText(/3\s*\/\s*3/);
      await expect(gallery.locator('video:visible')).toBeAttached();
      await gallery.getByRole('button', { name: 'Предыдущее', exact: true }).click();
      await expect(counter).toHaveText(/2\s*\/\s*3/);
      await page.keyboard.press('Escape');
      await expect(gallery).toBeHidden();
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

  test('ESN-367: сворачивает длинную публикацию с изображениями и видео по «Читать далее»', async ({ page }) => {
    test.setTimeout(150_000);
    const title = `${uniqueMarker('POST')}-LONG-MEDIA`;
    const firstText = `Начало публикации. ${'Длинный текст перед медиа. '.repeat(90)}`;
    const tail = `${uniqueMarker('POST')}-LONG-MEDIA-TAIL`;
    const images: UploadFile[] = [1, 2].map((number) => ({
      name: `qa-e2e-long-media-${number}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from(number === 1
        ? 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xw4AAAAASUVORK5CYII='
        : 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8Dwn4GBgYGJAQoAHgQCAZb2L9sAAAAASUVORK5CYII=', 'base64'),
    }));
    let postId: string | undefined;
    try {
      const composer = await openComposer(page, title);
      await composer.editor.locator('p').first().fill(firstText);
      await chooseFiles(page, composer, 'Изображение', images);
      await composer.editor.locator('p').last().click();
      await page.keyboard.insertText(` Текст между изображениями и видео. ${tail}`);
      await chooseFiles(page, composer, 'Видео', await recordedWebm(page));
      await expect(composer.editor).toContainText(tail);
      for (const image of images) await expect(composer.editor.locator(`img[alt="${image.name}"]`)).toBeVisible();
      await expect(composer.editor.locator('video')).toBeAttached();
      postId = await publishAndGetId(page, composer);

      await page.goto('/feed');
      const card = page.getByRole('heading', { name: title, exact: true })
        .locator('xpath=ancestor::network-post-card[1]');
      await expect(card.getByText('Читать далее', { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(card).toContainText('Начало публикации.');
      for (const image of images) await expect(card.locator(`img[alt="${image.name}"]`)).toBeVisible();
      await expect(card.locator('video')).toHaveCount(1);
      await card.getByText('Читать далее', { exact: true }).click();
      await expect(card).toContainText(tail);
      await expect(card.getByText('Читать далее', { exact: true })).toBeHidden();
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

  test('ESN-405: повторное добавление создаёт три отдельных вложения', async ({ page }) => {
    const title = `${uniqueMarker('POST')}-DUPLICATE-DOCUMENT`;
    const document: UploadFile = {
      name: 'qa-e2e-duplicate.pdf',
      mimeType: 'application/pdf',
      buffer: pdf('duplicate attachment'),
    };
    let postId: string | undefined;

    try {
      const composer = await openComposer(page, title);
      for (let index = 0; index < 3; index += 1) {
        await chooseFiles(page, composer, 'Документ (Word, PDF)', document);
        await expect(composer.dialog.getByText(document.name, { exact: true })).toHaveCount(index + 1, {
          timeout: 30_000,
        });
      }
      postId = await publishAndGetId(page, composer);
      const heading = page.getByRole('heading', { name: title, exact: true });
      const card = heading.locator('xpath=ancestor::network-post-card[1]');
      await expect(card.getByText(document.name, { exact: true })).toHaveCount(3, { timeout: 30_000 });
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

  test('ESN-406: принимает фото, видео, аудио и документ через drag-and-drop', async ({ page }) => {
    test.fixme(true, 'Программный DragEvent в строке редактора не равен реальному перетаскиванию файла ОС; ручной сценарий работает');
    test.setTimeout(120_000);
    const composer = await openComposer(page, `${uniqueMarker('POST')}-DRAG-DROP`);
    try {
      const files: UploadFile[] = [
        { name: 'qa-e2e-drop-image.png', mimeType: 'image/png', buffer: await png(64, 64) },
        await recordedWebm(page),
        { name: 'qa-e2e-drop-audio.wav', mimeType: 'audio/wav', buffer: wav() },
        { name: 'qa-e2e-drop-document.pdf', mimeType: 'application/pdf', buffer: pdf('drag and drop') },
      ];
      const insertionRow = composer.editor.locator('p').last();
      await insertionRow.click();
      await insertionRow.evaluate((element, serialized) => {
        const transfer = new DataTransfer();
        for (const file of serialized) {
          transfer.items.add(new File([Uint8Array.from(file.bytes)], file.name, { type: file.mimeType }));
        }
        for (const type of ['dragenter', 'dragover', 'drop']) {
          element.dispatchEvent(new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          }));
        }
      }, files.map((file) => ({ name: file.name, mimeType: file.mimeType, bytes: [...file.buffer] })));

      await expect(composer.editor.locator('img[alt="qa-e2e-drop-image.png"]')).toBeVisible({ timeout: 30_000 });
      await expect(composer.dialog.locator('video')).toBeAttached({ timeout: 30_000 });
      await expect(composer.dialog.getByText('qa-e2e-drop-audio.wav', { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(composer.dialog.getByText('qa-e2e-drop-document.pdf', { exact: true })).toBeVisible({ timeout: 30_000 });
    } finally {
      await composer.discard();
    }
  });

  test('ESN-407: один выбор добавляет 11 файлов каждого типа', async ({ page }) => {
    test.setTimeout(300_000);
    const video = await recordedWebm(page);
    const imageBuffer = await png(32, 32);
    const cases: Array<{ button: string; files: UploadFile[]; kind: 'image' | 'video' | 'named' }> = [
      {
        button: 'Изображение',
        kind: 'image',
        files: Array.from({ length: 11 }, (_, index) => ({
          name: `qa-e2e-image-${String(index + 1).padStart(2, '0')}.png`,
          mimeType: 'image/png',
          buffer: imageBuffer,
        })),
      },
      {
        button: 'Видео',
        kind: 'video',
        files: Array.from({ length: 11 }, (_, index) => ({
          ...video,
          name: `qa-e2e-video-${String(index + 1).padStart(2, '0')}.webm`,
        })),
      },
      {
        button: 'Аудио',
        kind: 'named',
        files: Array.from({ length: 11 }, (_, index) => ({
          name: `qa-e2e-audio-${String(index + 1).padStart(2, '0')}.wav`,
          mimeType: 'audio/wav',
          buffer: wav(1),
        })),
      },
      {
        button: 'Документ (Word, PDF)',
        kind: 'named',
        files: Array.from({ length: 11 }, (_, index) => ({
          name: `qa-e2e-document-${String(index + 1).padStart(2, '0')}.pdf`,
          mimeType: 'application/pdf',
          buffer: pdf(`attachment ${index + 1}`),
        })),
      },
    ];

    for (const item of cases) {
      const composer = await openComposer(page, `${uniqueMarker('POST')}-ELEVEN-${item.button}`);
      try {
        const chooser = await chooseFiles(page, composer, item.button, item.files);
        expect(chooser.isMultiple(), `Выбор «${item.button}» должен поддерживать несколько файлов`).toBe(true);
        if (item.kind === 'image') {
          for (const file of item.files) await expect(composer.editor.locator(`img[alt="${file.name}"]`)).toBeVisible({ timeout: 60_000 });
        } else if (item.kind === 'video') {
          await expect(composer.dialog.locator('video')).toHaveCount(11, { timeout: 60_000 });
        } else {
          for (const file of item.files) await expect(composer.dialog.getByText(file.name, { exact: true })).toBeVisible({ timeout: 60_000 });
        }
        await expect(composer.dialog.getByText(/лимит.*10|не более 10/i)).toBeHidden();
      } finally {
        await composer.discard();
      }
    }
  });

  const oversizedCases = [
    { key: 'ESN-389', button: 'Изображение', name: 'qa-e2e-oversized.png', mimeType: 'image/png', prefix: Buffer.from('89504e470d0a1a0a', 'hex') },
    { key: 'ESN-395', button: 'Видео', name: 'qa-e2e-oversized.mp4', mimeType: 'video/mp4', prefix: Buffer.from('00000018667479706d703432', 'hex') },
    { key: 'ESN-398', button: 'Аудио', name: 'qa-e2e-oversized.wav', mimeType: 'audio/wav', prefix: wav().subarray(0, 44) },
    { key: 'ESN-403', button: 'Документ (Word, PDF)', name: 'qa-e2e-oversized.pdf', mimeType: 'application/pdf', prefix: Buffer.from('%PDF-1.4\n') },
  ] as const;

  for (const item of oversizedCases) {
    test(`${item.key}: файл больше 100 МБ отклоняется до загрузки`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      const title = `${uniqueMarker('POST')}-OVERSIZED`;
      const composer = await openComposer(page, title);
      const temporaryFile = testInfo.outputPath(item.name);
      let uploadAttempted = false;
      await page.route(/\/api\/.*(?:upload|attachment|file)/i, async (route) => {
        if (route.request().method() === 'POST') {
          uploadAttempted = true;
          await route.abort('blockedbyclient');
        } else {
          await route.continue();
        }
      });

      try {
        await writeFile(temporaryFile, item.prefix);
        await truncate(temporaryFile, 101 * 1024 * 1024);
        expect((await stat(temporaryFile)).size).toBe(101 * 1024 * 1024);
        const chooserPromise = page.waitForEvent('filechooser');
        await composer.dialog.getByRole('button', { name: item.button, exact: true }).click();
        const chooser = await chooserPromise;
        const alertSeen = page.waitForEvent('dialog').then(async (dialog) => {
          expect(dialog.type()).toBe('alert');
          expect(dialog.message()).toMatch(/размер 101 МБ, максимум 100 МБ.*не будет добавлен/i);
          await dialog.accept();
        });
        await Promise.all([chooser.setFiles(temporaryFile), alertSeen]);
        await expect(composer.dialog.getByText(item.name, { exact: true })).toHaveCount(0);
        await expect(composer.titleBlock).toHaveText(title);
        expect(uploadAttempted, 'Клиент не должен отправлять заведомо слишком большой файл').toBe(false);
      } finally {
        await unlink(temporaryFile).catch(() => undefined);
        await composer.discard();
      }
    });
  }
});
