import { type FileChooser, type Page } from '@playwright/test';
import { createDeflate } from 'node:zlib';
import { once } from 'node:events';
import { PostComposerPage } from '../pages/PostComposerPage';

export type UploadFile = { name: string; mimeType: string; buffer: Buffer };

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
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
  for (let y = 0; y < height; y += 1) if (!deflater.write(row)) await once(deflater, 'drain');
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
  for (const offset of offsets.slice(1)) document += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document);
}

export function wav(seconds = 2): Buffer {
  const sampleRate = 8_000;
  const dataSize = sampleRate * seconds * 2;
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
    const context = canvas.getContext('2d')!;
    const mimeType = ['video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type))!;
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    recorder.addEventListener('dataavailable', (event) => event.data.size && chunks.push(event.data));
    const stopped = new Promise<void>((resolve) => recorder.addEventListener('stop', () => resolve(), { once: true }));
    recorder.start();
    for (let frame = 0; frame < 12; frame += 1) {
      context.fillStyle = `hsl(${frame * 30} 80% 45%)`;
      context.fillRect(0, 0, canvas.width, canvas.height);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    return { mimeType, bytes: [...new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer())] };
  });
  return { name: 'repost-video.webm', mimeType: generated.mimeType, buffer: Buffer.from(generated.bytes) };
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
