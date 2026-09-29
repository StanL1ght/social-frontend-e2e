import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { createTemporaryPostViaApi, deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { PostComposerPage } from '../pages/PostComposerPage';

async function selectAllText(locator: import('@playwright/test').Locator): Promise<void> {
  await locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
}

test('ESN-412 — внешняя ссылка сохраняет выделенный текст в редакторе и preview', async ({ page }) => {
  const composer = new PostComposerPage(page);
  try {
    await page.goto('/feed');
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.fill('QA-E2E-LINK-PREVIEW', 'Текст ссылка');
    await composer.editor.press('End');
    for (let index = 0; index < 'ссылка'.length; index++) {
      await page.keyboard.press('Shift+ArrowLeft');
    }

    await composer.dialog.getByRole('button', { name: 'Ссылка', exact: true }).click();
    const linkDialog = page.getByRole('dialog', { name: /Ссылка/ });
    await expect(linkDialog).toBeVisible();
    await linkDialog.getByRole('textbox', { name: /Введите URL/ }).fill('https://example.com/');
    await linkDialog.getByRole('button', { name: 'Применить' }).click();
    await expect(composer.editor.getByRole('link', { name: 'ссылка' })).toHaveAttribute('href', 'https://example.com/');

    await composer.dialog.getByRole('button', { name: 'Предпросмотр' }).click();
    const preview = page.getByRole('dialog', { name: /Предпросмотр публикации/ });
    await expect(preview.getByRole('link', { name: 'ссылка' })).toHaveAttribute('href', 'https://example.com/');
    await preview.getByRole('button', { name: 'К редактированию' }).click();
  } finally {
    const back = page.getByRole('dialog', { name: /Предпросмотр публикации/ })
      .getByRole('button', { name: 'К редактированию' });
    if (await back.isVisible()) await back.click();
    await composer.discard();
  }
});

test('ESN-436 — без выделения текстом ссылки становится полный адрес', async ({ page }) => {
  const composer = new PostComposerPage(page);
  const url = 'https://example.com/';
  try {
    await page.goto('/feed');
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.replaceTitle('QA-E2E-URL-INSERT');
    const endShortcut = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
    await composer.editor.press(endShortcut);
    await composer.editor.press('Enter');

    await composer.dialog.getByRole('button', { name: 'Ссылка', exact: true }).click();
    const linkDialog = page.getByRole('dialog', { name: /Ссылка/ });
    await linkDialog.getByRole('textbox', { name: /Введите URL/ }).fill(url);
    await linkDialog.getByRole('button', { name: 'Применить' }).click();
    await expect(composer.editor.getByRole('link', { name: url })).toHaveAttribute('href', url);

    await composer.dialog.getByRole('button', { name: 'Предпросмотр' }).click();
    const preview = page.getByRole('dialog', { name: /Предпросмотр публикации/ });
    await expect(preview.getByRole('link', { name: url })).toHaveAttribute('href', url);
  } finally {
    const back = page.getByRole('dialog', { name: /Предпросмотр публикации/ })
      .getByRole('button', { name: 'К редактированию' });
    if (await back.isVisible()) await back.click();
    await composer.discard();
  }
});

test('ESN-412 — ссылка сохраняется после публикации и открывается @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Публикация разрешена только в mutation-режиме');
  const title = uniqueMarker('POST');
  const linkText = 'ссылка на каталог';
  const url = new URL('/catalogs', env.baseURL).toString();
  let postId: string | undefined;

  try {
    await page.goto('/feed');
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.fill(title, `Проверочная ${linkText}`);
    await composer.editor.press('End');
    for (let index = 0; index < linkText.length; index += 1) {
      await page.keyboard.press('Shift+ArrowLeft');
    }
    await composer.dialog.getByRole('button', { name: 'Ссылка', exact: true }).click();
    const linkDialog = page.getByRole('dialog', { name: /Ссылка/ });
    await linkDialog.getByRole('textbox', { name: /Введите URL/ }).fill(url);
    await linkDialog.getByRole('button', { name: 'Применить' }).click();
    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;

    await page.goto(`/post/${postId}`);
    const publishedLink = page.getByRole('link', { name: linkText, exact: true });
    await expect(publishedLink).toHaveAttribute('href', url);
    const openedPage = page.context().waitForEvent('page', { timeout: 3_000 }).catch(() => undefined);
    await publishedLink.click();
    const destination = (await openedPage) ?? page;
    await expect(destination).toHaveURL(/\/catalogs(?:[/?#]|$)/);
  } finally {
    await deleteTemporaryPostViaApi(page, postId);
  }
});

test('ESN-435 — опубликованная ссылка открывается напрямую и в новой вкладке @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Публикация разрешена только в mutation-режиме');
  const title = uniqueMarker('POST');
  const linkText = 'ссылка для двух способов открытия';
  const url = new URL('/catalogs', env.baseURL).toString();
  let postId: string | undefined;
  try {
    await page.goto('/feed');
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.fill(title, `Проверочная ${linkText}`);
    await composer.editor.press('End');
    for (let index = 0; index < linkText.length; index += 1) await page.keyboard.press('Shift+ArrowLeft');
    await composer.dialog.getByRole('button', { name: 'Ссылка', exact: true }).click();
    const linkDialog = page.getByRole('dialog', { name: /Ссылка/ });
    await linkDialog.getByRole('textbox', { name: /Введите URL/ }).fill(url);
    await linkDialog.getByRole('button', { name: 'Применить' }).click();
    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;
    await page.goto(`/post/${postId}`);

    const link = page.getByRole('link', { name: linkText, exact: true });
    await expect(link).toHaveAttribute('href', url);
    const directPagePromise = page.context().waitForEvent('page', { timeout: 3_000 }).catch(() => undefined);
    await link.click();
    const directPage = (await directPagePromise) ?? page;
    await expect(directPage).toHaveURL(/\/catalogs(?:[/?#]|$)/);
    if (directPage !== page) await directPage.close();

    if (!new URL(page.url()).pathname.startsWith('/post/')) await page.goto(`/post/${postId}`);
    const newPagePromise = page.context().waitForEvent('page');
    await page.getByRole('link', { name: linkText, exact: true }).click({ button: 'middle' });
    const newPage = await newPagePromise;
    await newPage.waitForLoadState();
    await expect(newPage).toHaveURL(/\/catalogs(?:[/?#]|$)/);
    await newPage.close();
  } finally {
    await deleteTemporaryPostViaApi(page, postId);
  }
});

test('ESN-436 — полный URL публикуется и открывается без выделенного текста @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Публикация разрешена только в mutation-режиме');
  const title = uniqueMarker('POST');
  const url = new URL('/group', env.baseURL).toString();
  let postId: string | undefined;

  try {
    await page.goto('/feed');
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.replaceTitle(title);
    const endShortcut = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
    await composer.editor.press(endShortcut);
    await composer.editor.press('Enter');
    await composer.dialog.getByRole('button', { name: 'Ссылка', exact: true }).click();
    const linkDialog = page.getByRole('dialog', { name: /Ссылка/ });
    await linkDialog.getByRole('textbox', { name: /Введите URL/ }).fill(url);
    await linkDialog.getByRole('button', { name: 'Применить' }).click();
    await expect(composer.editor.getByRole('link', { name: url })).toHaveAttribute('href', url);

    await composer.dialog.getByRole('button', { name: 'Предпросмотр' }).click();
    const preview = page.getByRole('dialog', { name: /Предпросмотр публикации/ });
    await expect(preview.getByRole('link', { name: url })).toHaveAttribute('href', url);
    await preview.getByRole('button', { name: 'К редактированию' }).click();
    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;

    await page.goto(`/post/${postId}`);
    const publishedLink = page.getByRole('link', { name: url, exact: true });
    await expect(publishedLink).toHaveAttribute('href', url);
    const openedPage = page.context().waitForEvent('page', { timeout: 3_000 }).catch(() => undefined);
    await publishedLink.click();
    const destination = (await openedPage) ?? page;
    await expect(destination).toHaveURL(/\/group(?:[/?#]|$)/);
  } finally {
    await deleteTemporaryPostViaApi(page, postId);
  }
});

test('ESN-437 — ссылка на выделенном заголовке сохраняется после публикации @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Публикация разрешена только в mutation-режиме');
  const title = uniqueMarker('POST');
  const url = new URL('/catalogs', env.baseURL).toString();
  let postId: string | undefined;

  try {
    await page.goto('/feed');
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.replaceTitle(title);
    await selectAllText(composer.titleBlock);
    await composer.dialog.getByRole('button', { name: 'Ссылка', exact: true }).click();
    const linkDialog = page.getByRole('dialog', { name: /Ссылка/ });
    await linkDialog.getByRole('textbox', { name: /Введите URL/ }).fill(url);
    await linkDialog.getByRole('button', { name: 'Применить' }).click();
    await expect(composer.titleBlock.getByRole('link', { name: title, exact: true })).toHaveAttribute('href', url);

    await composer.dialog.getByRole('button', { name: 'Предпросмотр' }).click();
    const preview = page.getByRole('dialog', { name: /Предпросмотр публикации/ });
    await expect(preview.getByRole('link', { name: title, exact: true })).toHaveAttribute('href', url);
    await preview.getByRole('button', { name: 'К редактированию' }).click();

    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;
    await page.goto(`/post/${postId}`);

    const publishedLink = page.getByRole('link', { name: title, exact: true });
    await expect(publishedLink).toHaveAttribute('href', url);
    const openedPage = page.context().waitForEvent('page', { timeout: 3_000 }).catch(() => undefined);
    await publishedLink.click();
    const destination = (await openedPage) ?? page;
    await expect(destination).toHaveURL(/\/catalogs(?:[/?#]|$)/);
  } finally {
    await deleteTemporaryPostViaApi(page, postId);
  }
});

test('ESN-438 — находит публикацию и вставляет внутреннюю ссылку по заголовку @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Публикация разрешена только в mutation-режиме');
  const sourceTitle = `${uniqueMarker('POST')}-LINK-SOURCE`;
  const linkedTitle = `${uniqueMarker('POST')}-LINKED`;
  let sourceId: string | undefined;
  let linkedId: string | undefined;
  try {
    sourceId = await createTemporaryPostViaApi(page, sourceTitle);
    await page.goto('/feed');
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.fill(linkedTitle, 'Перед внутренней ссылкой');
    await composer.editor.press('End');
    await composer.dialog.getByRole('button', { name: 'Ссылка', exact: true }).click();
    const linkDialog = page.getByRole('dialog', { name: /Ссылка/ });
    await expect(linkDialog).toBeVisible();
    await linkDialog.getByRole('tab', { name: 'Публикация', exact: true }).click();
    const search = linkDialog.getByRole('textbox', { name: /Поиск публикаций/ });
    await search.fill(sourceTitle);
    const source = linkDialog.getByText(sourceTitle, { exact: true });
    await expect(source).toBeVisible({ timeout: 20_000 });
    await source.click();

    const editorLink = composer.editor.getByRole('link', { name: sourceTitle, exact: true });
    await expect(editorLink).toHaveAttribute('href', new RegExp(`/post/${sourceId}$`));
    await composer.dialog.getByRole('button', { name: 'Предпросмотр' }).click();
    const preview = page.getByRole('dialog', { name: /Предпросмотр публикации/ });
    await expect(preview.getByRole('link', { name: sourceTitle, exact: true })).toHaveAttribute('href', new RegExp(`/post/${sourceId}$`));
    await preview.getByRole('button', { name: 'К редактированию' }).click();

    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    linkedId = ((await (await created).json()) as { id: string }).id;
    await page.goto(`/post/${linkedId}`);
    const publishedLink = page.getByRole('link', { name: sourceTitle, exact: true });
    await expect(publishedLink).toHaveAttribute('href', new RegExp(`/post/${sourceId}$`));
    await publishedLink.click();
    await expect(page).toHaveURL(new RegExp(`/post/${sourceId}(?:[/?#]|$)`));
    await expect(page.getByRole('heading', { name: sourceTitle, exact: true })).toBeVisible();
  } finally {
    await deleteTemporaryPostViaApi(page, linkedId);
    await deleteTemporaryPostViaApi(page, sourceId);
  }
});

test('ESN-439 — вставляет ссылку на публикацию со следующей страницы результатов @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Публикация разрешена только в mutation-режиме');
  const linkedTitle = `${uniqueMarker('POST')}-PAGED-LINK`;
  let linkedId: string | undefined;
  try {
    await page.goto('/feed');
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.fill(linkedTitle, 'Ссылка на публикацию со второй страницы');
    await composer.editor.press('End');
    await composer.dialog.getByRole('button', { name: 'Ссылка', exact: true }).click();
    const linkDialog = page.getByRole('dialog', { name: /Ссылка/ });
    await linkDialog.getByRole('tab', { name: 'Публикация', exact: true }).click();
    const next = linkDialog.getByRole('button', { name: /Вперёд|Следующая/i });
    await expect(next).toBeVisible();
    const before = await linkDialog.innerText();
    await next.click();
    await expect.poll(() => linkDialog.innerText()).not.toBe(before);

    const result = linkDialog.getByRole('listbox').getByRole('button').first();
    await expect(result).toBeVisible();
    await result.click();
    const editorLink = composer.editor.locator('a[href*="/post/"]').last();
    await expect(editorLink).toBeVisible();
    const sourceHref = await editorLink.getAttribute('href');
    const sourceTitle = (await editorLink.innerText()).trim();
    expect(sourceHref).toMatch(/\/post\//);
    expect(sourceTitle).not.toBe('');

    await composer.dialog.getByRole('button', { name: 'Предпросмотр' }).click();
    const preview = page.getByRole('dialog', { name: /Предпросмотр публикации/ });
    await expect(preview.getByRole('link', { name: sourceTitle, exact: true })).toHaveAttribute('href', new RegExp(sourceHref!.split('?')[0]));
    await preview.getByRole('button', { name: 'К редактированию' }).click();
    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    linkedId = ((await (await created).json()) as { id: string }).id;
    await page.goto(`/post/${linkedId}`);
    const publishedLink = page.getByRole('link', { name: sourceTitle, exact: true });
    await expect(publishedLink).toHaveAttribute('href', new RegExp(sourceHref!.split('?')[0]));
    await publishedLink.click();
    await expect(page).toHaveURL(new RegExp(sourceHref!.split('?')[0]));
  } finally {
    await deleteTemporaryPostViaApi(page, linkedId);
  }
});
