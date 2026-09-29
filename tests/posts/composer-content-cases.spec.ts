import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { PostComposerPage } from '../pages/PostComposerPage';
import { png } from '../helpers/media-files';

function zipStore(files: Array<{ name: string; data: Buffer }>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const crc32 = (data: Buffer) => {
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  for (const file of files) {
    const name = Buffer.from(file.name);
    const checksum = crc32(file.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(file.data.length, 18);
    header.writeUInt32LE(file.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, file.data);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(file.data.length, 20);
    directory.writeUInt32LE(file.data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + file.data.length;
  }
  const directorySize = central.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

async function formattedDocx(): Promise<Buffer> {
  const image = await png(80, 40);
  return zipStore([
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
    { name: '_rels/.rels', data: Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>') },
    { name: 'word/media/image1.png', data: image },
    { name: 'word/document.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>QA-E2E ЖИРНЫЙ WORD</w:t></w:r><w:r><w:t xml:space="preserve"> и </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>курсивный текст</w:t></w:r></w:p><w:p><w:r><w:drawing><wp:inline><wp:extent cx="762000" cy="381000"/><wp:docPr id="1" name="QA-E2E Word image"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rIdImage1"/></pic:blipFill><pic:spPr><a:xfrm/><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p><w:sectPr/></w:body></w:document>`) },
  ]);
}

async function pasteHtml(
  target: import('@playwright/test').Locator,
  html: string,
  plainText: string,
): Promise<void> {
  await target.evaluate((element, data) => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/html', data.html);
    clipboard.setData('text/plain', data.plainText);
    element.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: clipboard,
    }));
  }, { html, plainText });
}

async function openComposer(page: import('@playwright/test').Page): Promise<PostComposerPage> {
  await page.goto('/feed');
  const composer = new PostComposerPage(page);
  await composer.open();
  await composer.selectDestination('Моя лента');
  return composer;
}

test('ESN-425: клик по приглашению написать публикацию открывает редактор', async ({ page }) => {
  await page.goto('/feed');
  const invitation = page.getByText('О чем вы хотите написать?', { exact: true });
  await expect(invitation).toBeVisible();
  await invitation.locator('..').click();
  await expect(new PostComposerPage(page).dialog).toBeVisible();
  await new PostComposerPage(page).discard();
});

test('ESN-383: тема публикации выбирается и сохраняется в селекторе', async ({ page }) => {
  const composer = await openComposer(page);
  try {
    const topicSelector = composer.dialog.getByRole('combobox').nth(1);
    await expect(topicSelector).toBeVisible();
    const initial = (await topicSelector.innerText()).trim();
    await topicSelector.click();
    const options = page.getByRole('option').filter({ visible: true });
    await expect(options.first()).toBeVisible();
    const option = options.filter({ hasNotText: initial }).first();
    const selectedTopic = (await option.innerText()).trim();
    await option.click();
    await expect(topicSelector).toContainText(selectedTopic);
  } finally {
    await composer.discard();
  }
});

test('ESN-386: инструменты форматирования недоступны для заголовка и доступны для текста', async ({ page }) => {
  const composer = await openComposer(page);
  try {
    await composer.replaceTitle('QA-E2E-TITLE-TOOLS');
    const formatting = [
      composer.dialog.getByRole('button', { name: 'Жирный', exact: true }),
      composer.dialog.getByRole('button', { name: 'Курсив', exact: true }),
      composer.dialog.getByRole('button', { name: 'Подчёркнутый', exact: true }),
      composer.dialog.getByRole('button', { name: 'Зачёркнутый', exact: true }),
    ];
    await composer.titleBlock.click();
    for (const tool of formatting) await expect(tool).toBeDisabled();

    const paragraph = composer.editor.locator('p').first();
    await paragraph.fill('Обычный текст');
    await paragraph.click();
    for (const tool of formatting) await expect(tool).toBeEnabled();
  } finally {
    await composer.discard();
  }
});

test('ESN-421: многострочный текст при вставке разбивается на отдельные абзацы', async ({ page }) => {
  const composer = await openComposer(page);
  try {
    await composer.replaceTitle('QA-E2E-PASTE-PARAGRAPHS');
    const paragraph = composer.editor.locator('p').first();
    await paragraph.click();
    await page.keyboard.insertText('Первый абзац\n\nВторой абзац\n\nТретий абзац');
    await expect.poll(async () =>
      (await composer.editor.locator('p').allTextContents()).filter((text) => text.length > 0),
    ).toEqual(['Первый абзац', 'Второй абзац', 'Третий абзац']);
  } finally {
    await composer.discard();
  }
});

test('ESN-427: импортирует Word с форматированием и изображением, затем текстовый файл', async ({ page }) => {
  let composer = await openComposer(page);
  const imported = 'QA-E2E-ИМПОРТ-ТЕКСТА\nВторая строка импортированного файла.';
  try {
    const importButton = composer.dialog.getByRole('button', { name: 'Импорт', exact: true });
    await importButton.hover();
    await expect(page.getByText('Импортировать текст из Word или текстового файла', { exact: true })).toBeVisible();

    const chooserPromise = page.waitForEvent('filechooser');
    await importButton.click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: 'qa-e2e-formatted.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: await formattedDocx(),
    });
    await expect(composer.editor).toContainText('QA-E2E ЖИРНЫЙ WORD', { timeout: 30_000 });
    await expect(composer.editor.locator('strong')).toContainText('QA-E2E ЖИРНЫЙ WORD');
    await expect(composer.editor.locator('em')).toContainText('курсивный текст');
    await expect(composer.editor.locator('img')).toBeVisible();

    if (await composer.dialog.isVisible()) await composer.discard();
    composer = await openComposer(page);
    const textImportButton = composer.dialog.getByRole('button', { name: 'Импорт', exact: true });
    const textChooserPromise = page.waitForEvent('filechooser');
    await textImportButton.click();
    const textChooser = await textChooserPromise;
    await textChooser.setFiles({
      name: 'qa-e2e-import.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(imported, 'utf8'),
    });
    await expect(composer.editor).toContainText('QA-E2E-ИМПОРТ-ТЕКСТА', { timeout: 20_000 });
    await expect(composer.editor).toContainText('Вторая строка импортированного файла.');
  } finally {
    if (await composer.dialog.isVisible()) await composer.discard();
  }
});

test('ESN-416: форматированная HTML-вставка сохраняется в описании', async ({ page }) => {
  test.fail(true, 'Dev сохраняет bold/italic из HTML, но удаляет ссылку, которую кейс требует перенести без изменений');
  const composer = await openComposer(page);
  try {
    await composer.replaceTitle('QA-E2E-RICH-PASTE-BODY');
    const paragraph = composer.editor.locator('p').first();
    await paragraph.click();
    await pasteHtml(
      paragraph,
      '<p><strong>Жирный фрагмент</strong> и <em>курсив</em></p><p><a href="https://example.com/rich-paste">Ссылка</a></p>',
      'Жирный фрагмент и курсив\nСсылка',
    );
    await expect(composer.editor.locator('strong')).toHaveText('Жирный фрагмент');
    await expect(composer.editor.locator('em')).toHaveText('курсив');
    await expect(composer.editor.getByRole('link', { name: 'Ссылка', exact: true })).toHaveAttribute(
      'href',
      'https://example.com/rich-paste',
    );
    await expect(composer.editor.locator('p')).toHaveCount(3);

    await composer.editor.getByText('Жирный фрагмент', { exact: true }).click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(' изменён');
    await expect(composer.editor).toContainText('Жирный фрагмент изменён');
  } finally {
    await composer.discard();
  }
});

test('ESN-417: форматированная вставка в заголовок становится обычным текстом', async ({ page }) => {
  const composer = await openComposer(page);
  try {
    const plainText = 'Форматированный заголовок';
    await composer.titleBlock.fill('');
    await composer.titleBlock.click();
    await pasteHtml(
      composer.titleBlock,
      '<strong>Форматированный</strong> <em>заголовок</em>',
      plainText,
    );
    await expect(composer.titleBlock).toHaveText(plainText);
    await expect(composer.titleBlock.locator('strong, em, u, a')).toHaveCount(0);

    await composer.titleBlock.press('ControlOrMeta+b');
    await page.keyboard.insertText(' без жирного');
    await expect(composer.titleBlock.locator('strong')).toHaveCount(0);
    await composer.titleBlock.press('ControlOrMeta+i');
    await page.keyboard.insertText(' без курсива');
    await expect(composer.titleBlock.locator('em')).toHaveCount(0);
  } finally {
    await composer.discard();
  }
});

test('ESN-410: эмодзи сохраняются в предпросмотре и опубликованной записи @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Для публикации нужен mutation-режим');
  const title = uniqueMarker('POST');
  const body = 'Проверка эмодзи 😀 🚀 ❤️ 👍🏽';
  let postId: string | undefined;
  const composer = await openComposer(page);
  try {
    await composer.fill(title, body);
    await composer.dialog.getByRole('button', { name: 'Предпросмотр' }).click();
    const preview = page.getByRole('dialog', { name: /Предпросмотр публикации/ });
    await expect(preview.getByText(body, { exact: true })).toBeVisible();
    await preview.getByRole('button', { name: 'К редактированию' }).click();

    const created = page.waitForResponse(
      (response) => response.request().method() === 'POST' && /\/api\/post\/?$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;
    await page.goto(`/post/${postId}`);
    await expect(page.getByText(body, { exact: true })).toBeVisible();
  } finally {
    const back = page.getByRole('dialog', { name: /Предпросмотр публикации/ })
      .getByRole('button', { name: 'К редактированию' });
    if (await back.isVisible()) await back.click();
    await composer.discard();
    await deleteTemporaryPostViaApi(page, postId);
  }
});

test('ESN-420: обычный вставленный текст публикуется без форматирования и вложений @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Для публикации нужен mutation-режим');
  const title = `${uniqueMarker('POST')}-PLAIN-PASTE`;
  const body = 'Первая строка\nВторая строка\nТретья строка';
  let postId: string | undefined;
  const composer = await openComposer(page);
  try {
    await composer.replaceTitle(title);
    const paragraph = composer.editor.locator('p').first();
    await paragraph.click();
    await page.keyboard.insertText(body);
    await expect(composer.editor.locator('img, video, audio')).toHaveCount(0);
    await expect(composer.dialog.getByText(/\.(?:pdf|docx?|xlsx?|zip)$/i)).toHaveCount(0);

    const created = page.waitForResponse(
      (response) => response.request().method() === 'POST' && /\/api\/post\/?$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;
    await page.goto(`/post/${postId}`);
    const card = page.getByRole('heading', { name: title, exact: true }).locator('xpath=ancestor::network-post-card[1]');
    await expect(card).toContainText('Первая строка');
    await expect(card).toContainText('Вторая строка');
    await expect(card).toContainText('Третья строка');
    await expect(card.locator('img[alt^="qa-e2e"], video, audio')).toHaveCount(0);
  } finally {
    await composer.discard();
    await deleteTemporaryPostViaApi(page, postId);
  }
});

test('ESN-422: вставка из документа сохраняет акценты и изображение между текстовыми блоками', async ({ page }) => {
  const title = `${uniqueMarker('POST')}-DOCUMENT-PASTE`;
  const before = 'Текст перед изображением';
  const after = 'Текст после изображения';
  const imageData = `data:image/png;base64,${(await png(32, 24)).toString('base64')}`;
  const composer = await openComposer(page);
  try {
    await composer.replaceTitle(title);
    const paragraph = composer.editor.locator('p').first();
    await paragraph.click();
    await pasteHtml(
      paragraph,
      `<p><strong>${before}</strong></p><p><img src="${imageData}" alt="QA-E2E pasted image"></p><p><em>${after}</em></p>`,
      `${before}\n${after}`,
    );

    await expect(composer.editor.getByText(before, { exact: true })).toBeVisible();
    await expect(composer.editor.getByText(after, { exact: true })).toBeVisible();
    const pastedImage = composer.editor.locator('img[alt="QA-E2E pasted image"]');
    await expect(pastedImage).toBeVisible({ timeout: 20_000 });
    const orderedNodes = await composer.editor.locator('p, img').evaluateAll((nodes) =>
      nodes.map((node) => node instanceof HTMLImageElement ? node.alt : node.textContent?.trim()).filter(Boolean),
    );
    expect(orderedNodes).toEqual(expect.arrayContaining([before, 'QA-E2E pasted image', after]));
    expect(orderedNodes.indexOf(before)).toBeLessThan(orderedNodes.indexOf('QA-E2E pasted image'));
    expect(orderedNodes.indexOf('QA-E2E pasted image')).toBeLessThan(orderedNodes.indexOf(after));
    await expect(composer.editor.locator('strong').filter({ hasText: before })).toBeVisible();
    await expect(composer.editor.locator('em').filter({ hasText: after })).toBeVisible();
  } finally {
    await composer.discard();
  }
});
