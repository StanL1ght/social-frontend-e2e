import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { uniqueMarker } from '../helpers/test-data';
import { deleteTemporaryPostViaApi } from '../helpers/post-api';
import { PostComposerPage } from '../pages/PostComposerPage';
import { PostPage } from '../pages/PostPage';

test('ESN-183 — опрос: создание, preview, публикация и голосование @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Публикация тестового опроса разрешена только в mutation-режиме');
  test.setTimeout(120_000);
  const title = uniqueMarker('POST');
  const questionText = 'Какой вариант выбрать для проверки?';
  const firstAnswer = 'Первый вариант E2E';
  const secondAnswer = 'Второй вариант E2E';
  let postId: string | undefined;

  try {
    await page.goto('/feed');
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.fill(title, 'Тестовый опрос будет удалён после проверки.');
    await composer.editor.locator('p').last().click();
    await composer.dialog.getByRole('button', { name: 'Опрос', exact: true }).click();
    const question = composer.dialog.getByRole('treeitem').first();
    await question.getByRole('textbox', { name: 'Ваш вопрос' }).fill(questionText);
    const answers = question.getByRole('textbox', { name: 'Вариант ответа' });
    await answers.nth(0).fill(firstAnswer);
    await answers.nth(1).fill(secondAnswer);

    await composer.dialog.locator('social-polls').getByRole('button', { name: 'Предпросмотр' }).click();
    const pollPreview = page.getByRole('dialog', { name: /Предпросмотр опроса/ });
    await expect(pollPreview).toBeVisible();
    await expect(pollPreview.getByText(questionText, { exact: true })).toBeVisible();
    await expect(pollPreview.getByText(firstAnswer, { exact: true })).toBeVisible();
    await expect(pollPreview.getByText(secondAnswer, { exact: true })).toBeVisible();
    await pollPreview.getByRole('button', { name: /Закрыть|К редактированию/ }).click();

    await composer.dialog.locator('button.tiptap-compose-modal__preview').click();
    const preview = page.getByRole('dialog', { name: /Предпросмотр публикации/ });
    await expect(preview).toBeVisible();
    await expect(preview.getByText(questionText, { exact: true })).toBeVisible();
    await expect(preview.getByText(firstAnswer, { exact: true })).toBeVisible();
    await expect(preview.getByText(secondAnswer, { exact: true })).toBeVisible();
    await preview.getByRole('button', { name: 'К редактированию' }).click();

    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    const createdPost = (await (await created).json()) as { id: string };
    postId = createdPost.id;
    expect(postId).toBeTruthy();
    const heading = page.getByRole('heading', { name: title, exact: true });
    await expect(heading).toBeVisible({ timeout: 20_000 });
    await page.goto(`/post/${postId}`);
    await expect(page.getByText(questionText, { exact: true })).toBeVisible();
    await expect(page.getByText(firstAnswer, { exact: true })).toBeVisible();
    await expect(page.getByText(secondAnswer, { exact: true })).toBeVisible();

    const answerResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST' &&
      /\/api\/post\/[^/]+\/polls\/[^/]+\/questions\/[^/]+\/answers\//i.test(response.url()),
    );
    await page.getByText(firstAnswer, { exact: true }).click();
    expect((await answerResponse).ok(), 'Ответ на опрос должен сохраниться').toBe(true);
    await expect(page.getByRole('option', { name: /Первый вариант E2E 100%/ })).toBeVisible();
    await expect(page.getByText('1 голос', { exact: true })).toBeVisible();
  } finally {
    await deleteTemporaryPostViaApi(page, postId);
  }
});

test('ветвящийся опрос: переход к подвопросу и сохранение ответов @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Публикация тестового опроса разрешена только в mutation-режиме');
  test.setTimeout(120_000);
  const title = `${uniqueMarker('POST')}-BRANCH-POLL`;
  const rootQuestion = 'Выберите путь проверки';
  const branchAnswer = 'Путь с продолжением';
  const finalAnswer = 'Путь без продолжения';
  const childQuestion = 'Завершающий вопрос ветки';
  const childAnswer = 'Завершить ветку';
  let postId: string | undefined;

  try {
    await page.goto('/feed');
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.fill(title, 'Временный ветвящийся опрос для E2E.');
    await composer.editor.locator('p').last().click();
    await composer.dialog.getByRole('button', { name: 'Опрос', exact: true }).click();
    const root = composer.dialog.getByRole('treeitem').first();
    await root.getByRole('textbox', { name: 'Ваш вопрос' }).fill(rootQuestion);
    await root.getByRole('textbox', { name: 'Вариант ответа' }).nth(0).fill(branchAnswer);
    await root.getByRole('textbox', { name: 'Вариант ответа' }).nth(1).fill(finalAnswer);
    await root.getByRole('button', { name: 'Добавить следующий вопрос' }).first().click();
    await composer.dialog.getByRole('textbox', { name: 'Ваш вопрос' }).nth(1).fill(childQuestion);
    const childAnswers = composer.dialog.getByRole('treeitem').nth(1).getByRole('textbox', { name: 'Вариант ответа' });
    await childAnswers.nth(0).fill(childAnswer);
    await childAnswers.nth(1).fill('Другой ответ ветки');

    await composer.dialog.locator('social-polls').getByRole('button', { name: 'Предпросмотр' }).click();
    const pollPreview = page.getByRole('dialog', { name: /Предпросмотр опроса/ });
    await expect(pollPreview.getByText(rootQuestion, { exact: true })).toBeVisible();
    await expect(pollPreview.getByText(branchAnswer, { exact: true })).toBeVisible();
    await pollPreview.getByRole('button', { name: /Закрыть|К редактированию/ }).click();

    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;
    await page.goto(`/post/${postId}`);
    await expect(page.getByText(rootQuestion, { exact: true })).toBeVisible();

    const rootVote = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/[^/]+\/polls\/[^/]+\/questions\/[^/]+\/answers\//i.test(response.url()),
    );
    await page.getByText(branchAnswer, { exact: true }).click();
    expect((await rootVote).ok()).toBe(true);
    await expect(page.getByText(childQuestion, { exact: true })).toBeVisible();
    const childVote = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/[^/]+\/polls\/[^/]+\/questions\/[^/]+\/answers\//i.test(response.url()),
    );
    await page.getByText(childAnswer, { exact: true }).click();
    expect((await childVote).ok()).toBe(true);
    await page.getByRole('button', { name: 'Следующий вопрос' }).click();
    await expect(page.getByRole('listbox', { name: childQuestion })).toBeVisible();
    await expect(page.getByRole('option', { name: /Завершить ветку 100%/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Следующий вопрос' })).toBeDisabled();
  } finally {
    await deleteTemporaryPostViaApi(page, postId);
  }
});

test('ESN-190 — публикует и проходит две последовательные ветки опроса @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Публикация тестового опроса разрешена только в mutation-режиме');
  test.setTimeout(120_000);
  const title = `${uniqueMarker('POST')}-TWO-POLL-BRANCHES`;
  const firstQuestion = 'Первый вопрос последовательной ветки';
  const secondQuestion = 'Следующая ветка после любого ответа';
  const firstAnswer = 'Перейти к следующей ветке';
  const secondAnswer = 'Завершить вторую ветку';
  let postId: string | undefined;
  try {
    await page.goto('/feed');
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.fill(title, 'Проверка последовательных веток опроса.');
    await composer.editor.locator('p').last().click();
    await composer.dialog.getByRole('button', { name: 'Опрос', exact: true }).click();
    const first = composer.dialog.getByRole('treeitem', { level: 1 }).first();
    await first.getByRole('textbox', { name: 'Ваш вопрос' }).fill(firstQuestion);
    await first.getByRole('textbox', { name: 'Вариант ответа' }).nth(0).fill(firstAnswer);
    await first.getByRole('textbox', { name: 'Вариант ответа' }).nth(1).fill('Альтернативный переход');
    await composer.dialog.locator('ekp-button').filter({ hasText: 'Добавить вопрос' }).click();
    const roots = composer.dialog.getByRole('treeitem', { level: 1 });
    await expect(roots).toHaveCount(2);
    await expect(composer.dialog.getByText('Первая ветка вопросов', { exact: true })).toBeVisible();
    await expect(composer.dialog.getByText('Следующая ветка вопросов', { exact: true })).toBeVisible();
    const second = roots.nth(1);
    await second.getByRole('textbox', { name: 'Ваш вопрос' }).fill(secondQuestion);
    await second.getByRole('textbox', { name: 'Вариант ответа' }).nth(0).fill(secondAnswer);
    await second.getByRole('textbox', { name: 'Вариант ответа' }).nth(1).fill('Другой финальный ответ');

    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;
    await page.goto(`/post/${postId}`);
    await expect(page.getByText(firstQuestion, { exact: true })).toBeVisible();
    const firstVote = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/polls\/.*\/answers\//i.test(response.url()),
    );
    await page.getByText(firstAnswer, { exact: true }).click();
    expect((await firstVote).ok()).toBe(true);
    await expect(page.getByText(secondQuestion, { exact: true })).toBeVisible();
    const secondVote = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/polls\/.*\/answers\//i.test(response.url()),
    );
    await page.getByText(secondAnswer, { exact: true }).click();
    expect((await secondVote).ok()).toBe(true);
    await page.getByRole('button', { name: 'Следующий вопрос' }).click();
    await expect(page.getByRole('listbox', { name: secondQuestion })).toBeVisible();
    await expect(page.getByRole('option', { name: /Завершить вторую ветку 100%/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Следующий вопрос' })).toBeDisabled();
  } finally {
    await deleteTemporaryPostViaApi(page, postId);
  }
});

test('ESN-334 — бессрочный опрос публикуется без даты окончания @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Публикация тестового опроса разрешена только в mutation-режиме');
  const title = uniqueMarker('POST');
  const questionText = 'Бессрочный вопрос E2E';
  let postId: string | undefined;
  try {
    await page.goto('/feed');
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.fill(title, 'Проверка бессрочного опроса.');
    await composer.editor.locator('p').last().click();
    await composer.dialog.getByRole('button', { name: 'Опрос', exact: true }).click();
    const question = composer.dialog.getByRole('treeitem').first();
    await question.getByRole('textbox', { name: 'Ваш вопрос' }).fill(questionText);
    await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(0).fill('Да');
    await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(1).fill('Нет');
    const unlimited = composer.dialog.locator('ekp-checkbox[label="Опрос действует бессрочно"]');
    await unlimited.click();
    await expect(unlimited.locator('input[type="checkbox"]')).toBeChecked();
    await expect(composer.dialog.getByRole('textbox', { name: 'Дата окончания опроса' })).toBeHidden();

    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;
    await page.goto(`/post/${postId}`);
    await expect(page.getByText(questionText, { exact: true })).toBeVisible();
    await expect(page.getByText(/Опрос действует до/i)).toHaveCount(0);
  } finally {
    await deleteTemporaryPostViaApi(page, postId);
  }
});

test('ESN-188 — анонимный опрос не раскрывает проголосовавших @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Публикация тестового опроса разрешена только в mutation-режиме');
  const title = uniqueMarker('POST');
  const questionText = 'Анонимный вопрос E2E';
  const answerText = 'Анонимный ответ';
  let postId: string | undefined;
  try {
    await page.goto('/feed');
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.fill(title, 'Проверка анонимного опроса.');
    await composer.editor.locator('p').last().click();
    await composer.dialog.getByRole('button', { name: 'Опрос', exact: true }).click();
    const question = composer.dialog.getByRole('treeitem').first();
    await question.getByRole('textbox', { name: 'Ваш вопрос' }).fill(questionText);
    await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(0).fill(answerText);
    await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(1).fill('Другой ответ');
    const anonymous = composer.dialog.locator('ekp-checkbox[label="Анонимный опрос"]');
    await anonymous.click();
    await expect(anonymous.locator('input[type="checkbox"]')).toBeChecked();

    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;
    await expect(page.getByText('Анонимный опрос', { exact: true })).toBeVisible();
    await page.goto(`/post/${postId}`);
    await expect(page.getByText('Анонимный опрос', { exact: true })).toBeVisible();
    const vote = page.waitForResponse((response) =>
      response.request().method() === 'POST' &&
      /\/api\/post\/[^/]+\/polls\/[^/]+\/questions\/[^/]+\/answers\//i.test(response.url()),
    );
    await page.getByText(answerText, { exact: true }).click();
    expect((await vote).ok()).toBe(true);
    await expect(page.getByRole('option', { name: /Анонимный ответ 100%/ })).toBeVisible();
    const votes = page.getByText('1 голос', { exact: true });
    await expect(votes).toBeVisible();
    await votes.click();
    await expect(page.getByRole('dialog', { name: /Проголосовавшие|Участники опроса/ })).toHaveCount(0);
  } finally {
    await deleteTemporaryPostViaApi(page, postId);
  }
});

test('ESN-184 — опрос редактируется до первого голоса и блокируется после него @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Публикация тестового опроса разрешена только в mutation-режиме');
  const title = `${uniqueMarker('POST')}-POLL-EDIT`;
  const questionText = 'Неизменяемый вопрос опубликованного опроса';
  let postId: string | undefined;
  try {
    await page.goto('/feed');
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.fill(title, 'Проверка запрета редактирования опубликованного опроса.');
    await composer.editor.locator('p').last().click();
    await composer.dialog.getByRole('button', { name: 'Опрос', exact: true }).click();
    const question = composer.dialog.getByRole('treeitem').first();
    await question.getByRole('textbox', { name: 'Ваш вопрос' }).fill(questionText);
    await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(0).fill('Первый неизменяемый ответ');
    await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(1).fill('Второй неизменяемый ответ');
    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;

    await page.goto(`/post/${postId}`);
    await new PostPage(page).openEditor();
    const editDialog = page.getByRole('dialog', { name: /Редактирование публикации/ });
    await expect(editDialog).toBeVisible();
    const publishedQuestion = editDialog.getByRole('textbox', { name: 'Ваш вопрос' });
    await expect(publishedQuestion).toHaveValue(questionText);
    await expect(publishedQuestion).toBeEnabled();
    const editedQuestionText = `${questionText} — обновлено`;
    await publishedQuestion.fill(editedQuestionText);
    await new PostComposerPage(page).saveChanges();
    await page.reload();
    await expect(page.getByText(editedQuestionText, { exact: true })).toBeVisible();

    const vote = page.waitForResponse((response) =>
      response.request().method() === 'POST' &&
      /\/api\/post\/[^/]+\/polls\/[^/]+\/questions\/[^/]+\/answers\//i.test(response.url()),
    );
    await page.getByText('Первый неизменяемый ответ', { exact: true }).click();
    expect((await vote).ok()).toBe(true);
    await new PostPage(page).openEditor();
    const votedEditDialog = page.getByRole('dialog', { name: /Редактирование публикации/ });
    await expect(votedEditDialog).toBeVisible();
    await expect(page.getByText('Опрос нельзя изменить — уже есть ответы', { exact: true })).toBeVisible();
    await expect(votedEditDialog.getByRole('textbox', { name: 'Ваш вопрос' })).toBeDisabled();
  } finally {
    await deleteTemporaryPostViaApi(page, postId);
  }
});

test('ESN-189 — анонимный ветвящийся опрос не раскрывает участников подвопросов @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Публикация тестового опроса разрешена только в mutation-режиме');
  test.setTimeout(120_000);
  const title = `${uniqueMarker('POST')}-ANONYMOUS-BRANCH`;
  const rootQuestion = 'Анонимный корневой вопрос';
  const branchAnswer = 'Перейти к анонимному подвопросу';
  const childQuestion = 'Анонимный дочерний вопрос';
  const childAnswer = 'Завершить анонимную ветку';
  let postId: string | undefined;
  try {
    await page.goto('/feed');
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.fill(title, 'Проверка анонимности основной и дочерней веток опроса.');
    await composer.editor.locator('p').last().click();
    await composer.dialog.getByRole('button', { name: 'Опрос', exact: true }).click();
    const root = composer.dialog.getByRole('treeitem').first();
    await root.getByRole('textbox', { name: 'Ваш вопрос' }).fill(rootQuestion);
    await root.getByRole('textbox', { name: 'Вариант ответа' }).nth(0).fill(branchAnswer);
    await root.getByRole('textbox', { name: 'Вариант ответа' }).nth(1).fill('Завершить без подвопроса');
    await root.getByRole('button', { name: 'Добавить следующий вопрос' }).first().click();
    const child = composer.dialog.getByRole('treeitem').nth(1);
    await child.getByRole('textbox', { name: 'Ваш вопрос' }).fill(childQuestion);
    await child.getByRole('textbox', { name: 'Вариант ответа' }).nth(0).fill(childAnswer);
    await child.getByRole('textbox', { name: 'Вариант ответа' }).nth(1).fill('Другой анонимный ответ');
    const anonymous = composer.dialog.locator('ekp-checkbox[label="Анонимный опрос"]');
    await anonymous.click();
    await expect(anonymous.locator('input[type="checkbox"]')).toBeChecked();

    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;
    await page.goto(`/post/${postId}`);
    await expect(page.getByText('Анонимный опрос', { exact: true })).toBeVisible();
    await expect(page.getByText(rootQuestion, { exact: true })).toBeVisible();

    const rootVote = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/polls\/.*\/answers\//i.test(response.url()),
    );
    await page.getByText(branchAnswer, { exact: true }).click();
    expect((await rootVote).ok()).toBe(true);
    await expect(page.getByText(childQuestion, { exact: true })).toBeVisible();
    const childVote = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/polls\/.*\/answers\//i.test(response.url()),
    );
    await page.getByText(childAnswer, { exact: true }).click();
    expect((await childVote).ok()).toBe(true);
    await page.getByRole('button', { name: 'Следующий вопрос' }).click();
    await expect(page.getByRole('option', { name: /Завершить анонимную ветку 100%/ })).toBeVisible();

    const votes = page.getByText('1 голос', { exact: true });
    expect(await votes.count()).toBeGreaterThanOrEqual(1);
    for (const voteCount of await votes.all()) {
      await voteCount.click();
      await expect(page.getByRole('dialog', { name: /Проголосовавшие|Участники опроса/ })).toHaveCount(0);
    }
  } finally {
    await deleteTemporaryPostViaApi(page, postId);
  }
});

test('ESN-182 — репост сохраняет рабочий опрос в ленте и детальной публикации @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Публикация и репост опроса разрешены только в mutation-режиме');
  test.setTimeout(120_000);
  const sourceTitle = `${uniqueMarker('POST')}-POLL-SOURCE`;
  const repostTitle = `${uniqueMarker('REPOST')}-POLL`;
  const questionText = 'Вопрос внутри репоста';
  const answerText = 'Ответить из репоста';
  let sourceId: string | undefined;
  let repostId: string | undefined;
  try {
    await page.goto('/feed');
    let composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.fill(sourceTitle, 'Исходная публикация с опросом для репоста.');
    await composer.editor.locator('p').last().click();
    await composer.dialog.getByRole('button', { name: 'Опрос', exact: true }).click();
    const question = composer.dialog.getByRole('treeitem').first();
    await question.getByRole('textbox', { name: 'Ваш вопрос' }).fill(questionText);
    await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(0).fill(answerText);
    await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(1).fill('Другой ответ репоста');
    const sourceCreated = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    sourceId = ((await (await sourceCreated).json()) as { id: string }).id;

    await page.goto(`/post/${sourceId}`);
    await new PostPage(page).openRepostComposer();
    composer = new PostComposerPage(page);
    await composer.waitForRepost();
    await composer.selectDestination('Моя лента');
    await composer.fill(repostTitle, 'Комментарий к репосту опроса.');
    const repostCreated = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    repostId = ((await (await repostCreated).json()) as { id: string }).id;

    const repostHeading = page.getByRole('heading', { name: repostTitle, exact: true });
    await expect(repostHeading).toBeVisible({ timeout: 20_000 });
    const repostCard = repostHeading.locator('xpath=ancestor::network-post-card[1]');
    await expect(repostCard.getByRole('heading', { name: sourceTitle, exact: true })).toBeVisible();
    await expect(repostCard.getByText(questionText, { exact: true })).toBeVisible();
    await expect(repostCard.getByText(answerText, { exact: true })).toBeVisible();

    await page.goto(`/post/${repostId}`);
    await expect(page.getByRole('heading', { name: repostTitle, exact: true })).toBeVisible();
    await expect(page.getByText(questionText, { exact: true })).toBeVisible();
    const voted = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/polls\/.*\/answers\//i.test(response.url()),
    );
    await page.getByText(answerText, { exact: true }).click();
    expect((await voted).ok()).toBe(true);
    await expect(page.getByRole('option', { name: /Ответить из репоста 100%/ })).toBeVisible();
  } finally {
    await deleteTemporaryPostViaApi(page, repostId);
    await deleteTemporaryPostViaApi(page, sourceId);
  }
});

test('ESN-186 — создаёт и проходит десять вопросов опроса в одной публикации @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Публикация тестового опроса разрешена только в mutation-режиме');
  test.setTimeout(180_000);
  const title = `${uniqueMarker('POST')}-TEN-POLLS`;
  const questions = Array.from({ length: 10 }, (_, index) => `Вопрос опроса ${index + 1} из 10`);
  const answers = Array.from({ length: 10 }, (_, index) => `Основной ответ ${index + 1}`);
  let postId: string | undefined;
  try {
    await page.goto('/feed');
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.fill(title, 'Публикация с десятью последовательными вопросами опроса.');
    await composer.editor.locator('p').last().click();
    await composer.dialog.getByRole('button', { name: 'Опрос', exact: true }).click();

    for (let index = 1; index < questions.length; index += 1) {
      await composer.dialog.locator('ekp-button').filter({ hasText: 'Добавить вопрос' }).click();
    }
    const roots = composer.dialog.getByRole('treeitem', { level: 1 });
    await expect(roots).toHaveCount(10);
    for (let index = 0; index < questions.length; index += 1) {
      const question = roots.nth(index);
      await question.getByRole('textbox', { name: 'Ваш вопрос' }).fill(questions[index]);
      await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(0).fill(answers[index]);
      await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(1).fill(`Альтернативный ответ ${index + 1}`);
    }
    await expect(composer.publishButton()).toBeEnabled();
    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(questions[0], { exact: true })).toBeVisible();

    await page.goto(`/post/${postId}`);
    for (let index = 0; index < questions.length; index += 1) {
      await expect(page.getByText(questions[index], { exact: true })).toBeVisible({ timeout: 20_000 });
      const vote = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/polls\/.*\/answers\//i.test(response.url()),
      );
      await page.getByText(answers[index], { exact: true }).click();
      expect((await vote).ok()).toBe(true);
      if (index + 1 < questions.length) {
        await expect(page.getByText(questions[index + 1], { exact: true })).toBeVisible();
      }
    }
    await page.getByRole('button', { name: 'Следующий вопрос' }).click();
    await expect(page.getByText('Вопрос опроса 2 из 10', { exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: new RegExp(`${answers[1]} 100%`) })).toBeVisible();
  } finally {
    await deleteTemporaryPostViaApi(page, postId);
  }
});

test('ESN-191 — при задержанном запросе учитывает только первый из быстрых ответов @mutation', async ({ page }) => {
  test.skip(!env.runMutationTests, 'Публикация тестового опроса разрешена только в mutation-режиме');
  test.fixme(true, 'Синтетическая задержка трёх запросов даёт нестабильный порядок; нужно воспроизведение реального медленного канала');
  const title = `${uniqueMarker('POST')}-SLOW-POLL`;
  const questionText = 'Вопрос при медленном соединении';
  const answerTexts = ['Первый быстрый ответ', 'Второй быстрый ответ', 'Третий быстрый ответ'];
  let postId: string | undefined;
  try {
    await page.goto('/feed');
    const composer = new PostComposerPage(page);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.fill(title, 'Проверка защиты от повторного голосования при медленной сети.');
    await composer.editor.locator('p').last().click();
    await composer.dialog.getByRole('button', { name: 'Опрос', exact: true }).click();
    const question = composer.dialog.getByRole('treeitem').first();
    await question.getByRole('textbox', { name: 'Ваш вопрос' }).fill(questionText);
    const answers = question.getByRole('textbox', { name: 'Вариант ответа' });
    await answers.nth(0).fill(answerTexts[0]);
    await answers.nth(1).fill(answerTexts[1]);
    await question.getByRole('button', { name: 'Добавить ответ', exact: true }).click();
    await answers.nth(2).fill(answerTexts[2]);
    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;
    await page.goto(`/post/${postId}`);

    await page.route('**/api/post/*/polls/**/answers/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });
    const firstVote = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/polls\/.*\/answers\//i.test(response.url()),
    );
    const options = answerTexts.map((answer) => page.getByText(answer, { exact: true }));
    await expect(options[0]).toBeVisible();
    const centers = await Promise.all(options.map(async (option) => {
      const box = await option.boundingBox();
      expect(box).not.toBeNull();
      return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    }));
    for (const center of centers) await page.mouse.click(center.x, center.y);
    expect((await firstVote).ok()).toBe(true);
    await expect(page.getByText('1 голос', { exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: /Первый быстрый ответ 100%/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /Второй быстрый ответ 0%/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /Третий быстрый ответ 0%/ })).toBeVisible();
  } finally {
    await deleteTemporaryPostViaApi(page, postId);
  }
});
