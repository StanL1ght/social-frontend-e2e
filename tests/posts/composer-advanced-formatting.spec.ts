import type { Locator } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { PostComposerPage } from '../pages/PostComposerPage';

const bodyText = 'Форматируемый текст';

async function selectContents(locator: Locator): Promise<void> {
  await locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
}

async function appendBlock(composer: PostComposerPage, text: string): Promise<Locator> {
  await composer.editor.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  await composer.editor.press('Enter');
  await composer.editor.page().keyboard.insertText(text);
  return composer.editor.locator('p, h1, h2, h3, li').filter({ hasText: text }).last();
}

async function publishAndOpen(page: Parameters<typeof deleteTemporaryPostViaApi>[0], composer: PostComposerPage): Promise<string> {
  const created = page.waitForResponse(
    (response) => response.request().method() === 'POST' && /\/api\/post\/?$/.test(response.url()),
  );
  await composer.publishNow();
  const postId = ((await (await created).json()) as { id: string }).id;
  await page.goto(`/post/${postId}`);
  return postId;
}

test.describe('Расширенное форматирование публикации', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/feed');
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.replaceTitle('QA-E2E-ADVANCED-FORMATTING');
    const paragraph = composer.editor.locator('p').first();
    await expect(paragraph).toBeVisible();
    await paragraph.fill(bodyText);
    await expect(composer.editor).toContainText(bodyText);
  });

  test.afterEach(async ({ page }) => {
    const back = page.getByRole('dialog', { name: /Предпросмотр публикации/ })
      .getByRole('button', { name: 'К редактированию' });
    if (await back.isVisible()) await back.click();
    await new PostComposerPage(page).discard();
  });

  test('применяет подчёркивание и зачёркивание к выделенному тексту', async ({ page }) => {
    const composer = new PostComposerPage(page);
    const paragraph = composer.editor.locator('p').filter({ hasText: bodyText });

    await selectContents(paragraph);
    await composer.dialog.getByRole('button', { name: 'Подчёркнутый', exact: true }).click();
    await expect(paragraph.locator('u')).toHaveText(bodyText);

    await selectContents(paragraph);
    await composer.dialog.getByRole('button', { name: 'Зачёркнутый', exact: true }).click();
    await expect(paragraph.locator('s')).toHaveText(bodyText);
  });

  test('преобразует текст в заголовки H1, H2 и H3', async ({ page }) => {
    const composer = new PostComposerPage(page);
    const blocks = composer.dialog.getByRole('group', { name: 'Блоки' });

    await composer.editor.locator('p').filter({ hasText: bodyText }).click();
    await blocks.getByRole('button', { name: 'Заголовок 1', exact: true }).click();
    const h1 = composer.editor.locator('h1').filter({ hasText: bodyText });
    await expect(h1).toHaveText(bodyText);

    await h1.click();
    await blocks.getByRole('button', { name: 'Заголовок 2', exact: true }).click();
    const h2 = composer.editor.locator('h2').filter({ hasText: bodyText });
    await expect(h2).toHaveText(bodyText);

    await h2.click();
    await blocks.getByRole('button', { name: 'Заголовок 3', exact: true }).click();
    await expect(composer.editor.locator('h3').filter({ hasText: bodyText })).toHaveText(bodyText);
  });

  test('создаёт маркированный и нумерованный списки', async ({ page }) => {
    const composer = new PostComposerPage(page);
    const lists = composer.dialog.getByRole('group', { name: 'Списки' });

    await composer.editor.locator('p').filter({ hasText: bodyText }).click();
    await lists.getByRole('button', { name: 'Маркированный список', exact: true }).click();
    const bulletItem = composer.editor.locator('ul li').filter({ hasText: bodyText });
    await expect(bulletItem).toHaveText(bodyText);

    await bulletItem.click();
    await lists.getByRole('button', { name: 'Нумерованный список', exact: true }).click();
    await expect(composer.editor.locator('ol li').filter({ hasText: bodyText })).toHaveText(bodyText);
  });

  test('применяет выравнивание и размер шрифта', async ({ page }) => {
    const composer = new PostComposerPage(page);
    const paragraph = composer.editor.locator('p').filter({ hasText: bodyText });

    await paragraph.click();
    await composer.dialog.getByRole('button', { name: 'По центру', exact: true }).click();
    await expect(paragraph).toHaveCSS('text-align', 'center');

    await selectContents(paragraph);
    await composer.dialog.getByRole('combobox', { name: 'Размер шрифта' }).selectOption({ label: '24' });
    await expect(paragraph.locator('[style*="font-size: 24"]').first()).toHaveCSS('font-size', '24px');
  });

  test('ESN-413, ESN-419: комбинированное форматирование сохраняется в preview и публикации', async ({ page }) => {
    test.skip(!env.runMutationTests, 'Для публикации нужен mutation-режим');
    const composer = new PostComposerPage(page);
    const paragraph = composer.editor.locator('p').filter({ hasText: bodyText });
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    let postId: string | undefined;

    try {
      await selectContents(paragraph);
      await page.keyboard.press(`${modifier}+b`);
      await selectContents(paragraph);
      await page.keyboard.press(`${modifier}+i`);
      await selectContents(paragraph);
      await composer.dialog.getByRole('button', { name: 'Подчёркнутый', exact: true }).click();
      await selectContents(paragraph);
      await composer.dialog.getByRole('button', { name: 'Зачёркнутый', exact: true }).click();

      for (const selector of ['strong', 'em', 'u', 's']) {
        await expect(paragraph.locator(selector)).toHaveText(bodyText);
      }

      await composer.dialog.getByRole('button', { name: 'Предпросмотр' }).click();
      const preview = page.getByRole('dialog', { name: /Предпросмотр публикации/ });
      await expect(preview).toBeVisible();
      for (const selector of ['strong', 'em', 'u', 's']) {
        await expect(preview.locator(selector).filter({ hasText: bodyText })).toHaveText(bodyText);
      }
      await preview.getByRole('button', { name: 'К редактированию' }).click();

      const created = page.waitForResponse(
        (response) => response.request().method() === 'POST' && /\/api\/post\/?$/.test(response.url()),
      );
      await composer.publishNow();
      postId = ((await (await created).json()) as { id: string }).id;
      await page.goto(`/post/${postId}`);

      const published = page.locator('p').filter({ hasText: bodyText }).first();
      await expect(published).toHaveText(bodyText);
      for (const selector of ['strong', 'em', 'u', 's']) {
        await expect(published.locator(selector).filter({ hasText: bodyText })).toHaveText(bodyText);
      }
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

  test('ESN-424: форматирование сохраняется после раскрытия длинного поста в ленте @mutation', async ({ page }) => {
    test.skip(!env.runMutationTests, 'Для публикации нужен mutation-режим');
    const composer = new PostComposerPage(page);
    const title = `${uniqueMarker('POST')}-FORMATTED-READ-MORE`;
    const paragraph = composer.editor.locator('p').filter({ hasText: bodyText });
    let postId: string | undefined;
    try {
      await composer.replaceTitle(title);
      await selectContents(paragraph);
      await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+b`);
      await selectContents(paragraph);
      await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+i`);
      await selectContents(paragraph);
      await composer.dialog.getByRole('button', { name: 'Подчёркнутый', exact: true }).click();
      for (const selector of ['strong', 'em', 'u']) {
        await expect(paragraph.locator(selector)).toHaveText(bodyText);
      }
      await appendBlock(composer, 'Длинный блок. '.repeat(400));

      const created = page.waitForResponse(
        (response) => response.request().method() === 'POST' && /\/api\/post\/?$/.test(response.url()),
      );
      await composer.publishNow();
      postId = ((await (await created).json()) as { id: string }).id;
      await page.goto('/feed');
      const card = page.getByRole('heading', { name: title, exact: true }).locator('xpath=ancestor::network-post-card[1]');
      const readMore = card.getByText('Читать далее', { exact: true });
      await expect(readMore).toBeVisible({ timeout: 20_000 });
      await readMore.click();
      await expect(readMore).toBeHidden();
      for (const selector of ['strong', 'em', 'u']) {
        await expect(card.locator(selector).filter({ hasText: bodyText })).toHaveText(bodyText);
      }
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

  test('ESN-440: все размеры шрифта сохраняются в preview и публикации', async ({ page }) => {
    test.skip(!env.runMutationTests, 'Для публикации нужен mutation-режим');
    const composer = new PostComposerPage(page);
    const sizes = ['12', '14', '16', '18', '20', '24', '32'];
    let postId: string | undefined;

    try {
      await composer.editor.locator('p').filter({ hasText: bodyText }).fill(`Размер ${sizes[0]}`);
      const blocks = [composer.editor.locator('p').filter({ hasText: `Размер ${sizes[0]}` })];
      for (const size of sizes.slice(1)) blocks.push(await appendBlock(composer, `Размер ${size}`));

      for (let index = 0; index < sizes.length; index++) {
        await selectContents(blocks[index]);
        await composer.dialog.getByRole('combobox', { name: 'Размер шрифта' }).selectOption({ label: sizes[index] });
      }

      await composer.dialog.getByRole('button', { name: 'Предпросмотр' }).click();
      const preview = page.getByRole('dialog', { name: /Предпросмотр публикации/ });
      for (const size of sizes) {
        await expect(preview.getByText(`Размер ${size}`, { exact: true })).toHaveCSS('font-size', `${size}px`);
      }
      await preview.getByRole('button', { name: 'К редактированию' }).click();

      postId = await publishAndOpen(page, composer);
      for (const size of sizes) {
        await expect(page.getByText(`Размер ${size}`, { exact: true })).toHaveCSS('font-size', `${size}px`);
      }
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

  test('ESN-441: все варианты выравнивания сохраняются в preview и публикации', async ({ page }) => {
    test.skip(!env.runMutationTests, 'Для публикации нужен mutation-режим');
    const composer = new PostComposerPage(page);
    const variants = [
      ['По левому краю', 'left', 'start'],
      ['По центру', 'center', 'center'],
      ['По правому краю', 'right', 'right'],
      ['По ширине', 'justify', 'justify'],
    ] as const;
    let postId: string | undefined;

    try {
      await composer.editor.locator('p').filter({ hasText: bodyText }).fill('Выравнивание left');
      const blocks = [composer.editor.locator('p').filter({ hasText: 'Выравнивание left' })];
      for (const [, text] of variants.slice(1)) blocks.push(await appendBlock(composer, `Выравнивание ${text}`));
      for (let index = 0; index < variants.length; index++) {
        await blocks[index].click();
        await composer.dialog.getByRole('button', { name: variants[index][0], exact: true }).click();
      }

      await composer.dialog.getByRole('button', { name: 'Предпросмотр' }).click();
      const preview = page.getByRole('dialog', { name: /Предпросмотр публикации/ });
      for (const [, text, alignment] of variants) {
        await expect(preview.getByText(`Выравнивание ${text}`, { exact: true })).toHaveCSS('text-align', alignment);
      }
      await preview.getByRole('button', { name: 'К редактированию' }).click();
      postId = await publishAndOpen(page, composer);
      for (const [, text, alignment] of variants) {
        await expect(page.getByText(`Выравнивание ${text}`, { exact: true })).toHaveCSS('text-align', alignment);
      }
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

  test('ESN-442: H1, H2 и H3 одновременно сохраняются в preview и публикации', async ({ page }) => {
    test.skip(!env.runMutationTests, 'Для публикации нужен mutation-режим');
    const composer = new PostComposerPage(page);
    const headings = [['H1', 'Заголовок 1'], ['H2', 'Заголовок 2'], ['H3', 'Заголовок 3']] as const;
    let postId: string | undefined;

    try {
      await composer.editor.locator('p').filter({ hasText: bodyText }).fill('Текст H1');
      const blocks = [composer.editor.locator('p').filter({ hasText: 'Текст H1' }), await appendBlock(composer, 'Текст H2'), await appendBlock(composer, 'Текст H3')];
      for (let index = 0; index < headings.length; index++) {
        await blocks[index].click();
        await composer.dialog.getByRole('group', { name: 'Блоки' })
          .getByRole('button', { name: headings[index][1], exact: true }).click();
      }

      await composer.dialog.getByRole('button', { name: 'Предпросмотр' }).click();
      const preview = page.getByRole('dialog', { name: /Предпросмотр публикации/ });
      for (const [tag] of headings) await expect(preview.locator(tag.toLowerCase()).filter({ hasText: `Текст ${tag}` })).toBeVisible();
      await preview.getByRole('button', { name: 'К редактированию' }).click();
      postId = await publishAndOpen(page, composer);
      for (const [tag] of headings) await expect(page.locator(tag.toLowerCase()).filter({ hasText: `Текст ${tag}` })).toBeVisible();
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

  for (const listCase of [
    { id: 'ESN-446', button: 'Маркированный список', tag: 'ul', label: 'маркированный' },
    { id: 'ESN-447', button: 'Нумерованный список', tag: 'ol', label: 'нумерованный' },
  ] as const) {
    test(`${listCase.id}: ${listCase.label} список из трёх пунктов сохраняется в preview и публикации`, async ({ page }) => {
      test.skip(!env.runMutationTests, 'Для публикации нужен mutation-режим');
      const composer = new PostComposerPage(page);
      let postId: string | undefined;
      try {
        await composer.editor.locator('p').filter({ hasText: bodyText }).fill('Пункт 1');
        const paragraph = composer.editor.locator('p').filter({ hasText: 'Пункт 1' });
        await paragraph.click();
        await composer.dialog.getByRole('group', { name: 'Списки' })
          .getByRole('button', { name: listCase.button, exact: true }).click();
        const firstItem = composer.editor.locator(`${listCase.tag} li`).filter({ hasText: 'Пункт 1' });
      await firstItem.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.insertText('Пункт 2');
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
        await page.keyboard.insertText('Пункт 3');

        await composer.dialog.getByRole('button', { name: 'Предпросмотр' }).click();
        const preview = page.getByRole('dialog', { name: /Предпросмотр публикации/ });
        await expect(preview.locator(`${listCase.tag} li`)).toHaveText(['Пункт 1', 'Пункт 2', 'Пункт 3']);
        await preview.getByRole('button', { name: 'К редактированию' }).click();
        postId = await publishAndOpen(page, composer);
        await expect(page.locator(`${listCase.tag} li`)).toHaveText(['Пункт 1', 'Пункт 2', 'Пункт 3']);
      } finally {
        await deleteTemporaryPostViaApi(page, postId);
      }
    });
  }

  for (const blockCase of [
    { id: 'ESN-443', button: 'Цитата', tag: 'blockquote', text: 'Текст цитаты' },
    { id: 'ESN-444', button: 'Код', tag: 'pre', text: 'const answer = 42;' },
  ] as const) {
    test(`${blockCase.id}: блок сохраняется в preview и публикации`, async ({ page }) => {
      test.skip(!env.runMutationTests, 'Для публикации нужен mutation-режим');
      const composer = new PostComposerPage(page);
      let postId: string | undefined;
      try {
        await composer.editor.locator('p').filter({ hasText: bodyText }).fill(blockCase.text);
        const paragraph = composer.editor.locator('p').filter({ hasText: blockCase.text });
        await paragraph.click();
        await composer.dialog.getByRole('group', { name: 'Блоки' })
          .getByRole('button', { name: blockCase.button, exact: true }).click();
        await expect(composer.editor.locator(blockCase.tag).filter({ hasText: blockCase.text })).toBeVisible();

        await composer.dialog.getByRole('button', { name: 'Предпросмотр' }).click();
        const preview = page.getByRole('dialog', { name: /Предпросмотр публикации/ });
        await expect(preview.locator(blockCase.tag).filter({ hasText: blockCase.text })).toBeVisible();
        await preview.getByRole('button', { name: 'К редактированию' }).click();
        postId = await publishAndOpen(page, composer);
        await expect(page.locator(blockCase.tag).filter({ hasText: blockCase.text })).toBeVisible();
      } finally {
        await deleteTemporaryPostViaApi(page, postId);
      }
    });
  }

  test('ESN-445: разделитель сохраняется в preview и публикации', async ({ page }) => {
    test.skip(!env.runMutationTests, 'Для публикации нужен mutation-режим');
    const composer = new PostComposerPage(page);
    let postId: string | undefined;
    try {
      const paragraph = composer.editor.locator('p').filter({ hasText: bodyText });
      await paragraph.click();
      await composer.dialog.getByRole('group', { name: 'Блоки' })
        .getByRole('button', { name: 'Разделитель', exact: true }).click();
      await expect(composer.editor.locator('hr')).toHaveCount(1);

      await composer.dialog.getByRole('button', { name: 'Предпросмотр' }).click();
      const preview = page.getByRole('dialog', { name: /Предпросмотр публикации/ });
      await expect(preview.locator('hr')).toHaveCount(1);
      await preview.getByRole('button', { name: 'К редактированию' }).click();
      postId = await publishAndOpen(page, composer);
      await expect(page.locator('hr')).toHaveCount(1);
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });
});
