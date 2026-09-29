import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { deleteTemporaryPostViaApi } from '../helpers/post-api';
import { PostComposerPage } from '../pages/PostComposerPage';

async function openPollBuilder(page: Page): Promise<PostComposerPage> {
  const composer = new PostComposerPage(page);
  await page.goto('/feed');
  await composer.open();
  await composer.selectDestination('Моя лента');
  await composer.fill('QA-E2E-POLL-BUILDER', 'Описание опроса');
  await composer.editor.locator('p').last().click();
  await composer.dialog.getByRole('button', { name: 'Опрос', exact: true }).click();
  return composer;
}

async function createTwoPollBranches(composer: PostComposerPage) {
  const root = composer.dialog.getByRole('treeitem').first();
  await root.getByRole('textbox', { name: 'Ваш вопрос' }).fill('Первая ветка');
  await root.getByRole('textbox', { name: 'Вариант ответа' }).nth(0).fill('Первый ответ');
  await root.getByRole('textbox', { name: 'Вариант ответа' }).nth(1).fill('Второй ответ');
  await root.getByRole('button', { name: 'Добавить следующий вопрос' }).first().click();
  const subquestion = composer.dialog.getByRole('treeitem').nth(1);
  await subquestion.getByRole('textbox', { name: 'Ваш вопрос' }).fill('Подвопрос первой ветки');
  await composer.dialog.locator('ekp-button').filter({ hasText: 'Добавить вопрос' }).click();
  const roots = composer.dialog.getByRole('treeitem', { level: 1 });
  await expect(roots).toHaveCount(2);
  await roots.nth(1).getByRole('textbox', { name: 'Ваш вопрос' }).fill('Вторая ветка');
  return roots;
}

test.describe('Конструктор ветвящегося опроса', () => {
  test.afterEach(async ({ page }) => {
    await new PostComposerPage(page).discard();
  });

  test('ESN-357: удаляет целиком наполненный опрос из редактора', async ({ page }) => {
    const composer = await openPollBuilder(page);
    const root = composer.dialog.getByRole('treeitem').first();
    await root.getByRole('textbox', { name: 'Ваш вопрос' }).fill('Удаляемый вопрос');
    await root.getByRole('textbox', { name: 'Вариант ответа' }).nth(0).fill('Первый ответ');
    await root.getByRole('textbox', { name: 'Вариант ответа' }).nth(1).fill('Второй ответ');
    await root.getByRole('button', { name: 'Добавить следующий вопрос' }).first().click();
    await expect(composer.dialog.getByRole('textbox', { name: 'Ваш вопрос' })).toHaveCount(2);

    await composer.dialog.getByRole('button', { name: 'Удалить опрос', exact: true }).click();
    await expect(composer.dialog.getByRole('textbox', { name: 'Ваш вопрос' })).toHaveCount(0);
    await expect(composer.dialog.getByRole('button', { name: 'Опрос', exact: true })).toBeEnabled();
  });

  test('ESN-374: сворачивает и разворачивает опрос без потери содержимого', async ({ page }) => {
    const composer = await openPollBuilder(page);
    const question = composer.dialog.getByRole('textbox', { name: 'Ваш вопрос' });
    await question.fill('Содержимое свёрнутого опроса');
    await composer.dialog.getByRole('textbox', { name: 'Вариант ответа' }).nth(0).fill('Ответ один');
    await composer.dialog.getByRole('textbox', { name: 'Вариант ответа' }).nth(1).fill('Ответ два');

    await composer.dialog.locator('button[title="Свернуть опрос"]').click();
    await expect(question).toBeHidden();
    const expand = composer.dialog.locator('button[title="Развернуть опрос"]');
    await expect(expand).toBeVisible();
    await expand.click();
    await expect(question).toBeVisible();
    await expect(question).toHaveValue('Содержимое свёрнутого опроса');
    const answers = composer.dialog.getByRole('textbox', { name: 'Вариант ответа' });
    await expect(answers.nth(0)).toHaveValue('Ответ один');
    await expect(answers.nth(1)).toHaveValue('Ответ два');
  });

  for (const action of ['delete', 'hide', 'hide-delete'] as const) {
    const id = action === 'delete' ? 'ESN-358' : action === 'hide' ? 'ESN-359' : 'ESN-360';
    test(`${id}: управляет созданным подвопросом`, async ({ page }) => {
      const composer = await openPollBuilder(page);
      const root = composer.dialog.getByRole('treeitem').first();
      await root.getByRole('button', { name: 'Добавить следующий вопрос' }).first().click();
      const questions = composer.dialog.getByRole('textbox', { name: 'Ваш вопрос' });
      await expect(questions).toHaveCount(2);
      await questions.nth(1).fill('Вопрос после ответа №1');
      const subquestion = composer.dialog.getByRole('treeitem').nth(1);

      if (action !== 'delete') {
        await subquestion.getByRole('button', { name: 'Скрыть ветку вопросов' }).click();
        await expect(questions.nth(1)).toBeHidden();
        await expect(subquestion.getByText(/Вопрос после ответа №1/)).toBeVisible();
        if (action === 'hide') {
          const show = subquestion.getByRole('button', { name: 'Показать ветку вопросов' });
          await expect(show).toBeVisible();
          await show.click();
          await expect(questions.nth(1)).toHaveValue('Вопрос после ответа №1');
          return;
        }
      }

      await subquestion.getByRole('button', { name: 'Удалить вопрос' }).click();
      await expect(composer.dialog.getByRole('textbox', { name: 'Ваш вопрос' })).toHaveCount(1);
      await expect(composer.dialog.getByText(/Вопрос после ответа №1/)).toHaveCount(0);
    });
  }

  test('создаёт вопрос, добавляет и удаляет вариант ответа', async ({ page }) => {
    const composer = await openPollBuilder(page);
    const question = composer.dialog.getByRole('treeitem').first();

    await question.getByRole('textbox', { name: 'Ваш вопрос' }).fill('Первый вопрос');
    const answers = question.getByRole('textbox', { name: 'Вариант ответа' });
    await answers.nth(0).fill('Первый ответ');
    await answers.nth(1).fill('Второй ответ');

    await question.getByRole('button', { name: 'Добавить ответ', exact: true }).click();
    await expect(answers).toHaveCount(3);
    await answers.nth(2).fill('Третий ответ');

    await question.getByRole('button', { name: 'Удалить вариант ответа' }).last().click();
    await expect(answers).toHaveCount(2);
  });

  test('создаёт подвопрос и отдельную ветку', async ({ page }) => {
    const composer = await openPollBuilder(page);
    const root = composer.dialog.getByRole('treeitem').first();
    await root.getByRole('textbox', { name: 'Ваш вопрос' }).fill('Корневой вопрос');
    await root.getByRole('textbox', { name: 'Вариант ответа' }).nth(0).fill('Ветка с продолжением');
    await root.getByRole('textbox', { name: 'Вариант ответа' }).nth(1).fill('Финальный ответ');

    await root.getByRole('button', { name: 'Добавить следующий вопрос' }).first().click();
    await expect(composer.dialog.getByRole('textbox', { name: 'Ваш вопрос' })).toHaveCount(2);
    await composer.dialog
      .getByRole('textbox', { name: 'Ваш вопрос' })
      .nth(1)
      .fill('Подвопрос первой ветки');

    await composer.dialog.locator('ekp-button').filter({ hasText: 'Добавить вопрос' }).click();
    await expect(composer.dialog.getByRole('treeitem', { level: 1 })).toHaveCount(2);
  });

  test('ESN-353: удаляет последующую ветку опроса', async ({ page }) => {
    const composer = await openPollBuilder(page);
    const roots = await createTwoPollBranches(composer);
    await roots.nth(1).getByRole('button', { name: 'Удалить вопрос' }).click();
    await expect(roots).toHaveCount(1);
    await expect(composer.dialog.getByText('Вторая ветка', { exact: true })).toHaveCount(0);
  });

  test('ESN-354: после удаления первой ветки вторая становится первой', async ({ page }) => {
    const composer = await openPollBuilder(page);
    const roots = await createTwoPollBranches(composer);
    await roots.nth(0).getByRole('banner').first().getByRole('button', { name: 'Удалить вопрос' }).click();
    await expect(roots).toHaveCount(1);
    await expect(roots.first().getByRole('textbox', { name: 'Ваш вопрос' })).toHaveValue('Вторая ветка');
    await composer.dialog.locator('ekp-button').filter({ hasText: 'Добавить вопрос' }).click();
    await expect(roots).toHaveCount(2);
    await expect(roots.first().getByRole('textbox', { name: 'Ваш вопрос' })).toHaveValue('Вторая ветка');
  });

  test('ESN-355: скрывает и повторно раскрывает первую ветку', async ({ page }) => {
    const composer = await openPollBuilder(page);
    const roots = await createTwoPollBranches(composer);
    const firstQuestion = roots.first().getByRole('textbox', { name: 'Ваш вопрос' }).first();
    const header = roots.first().getByRole('banner').first();
    await header.getByRole('button', { name: 'Скрыть ветку вопросов' }).click();
    await expect(firstQuestion).toBeHidden();
    await header.getByRole('button', { name: 'Показать ветку вопросов' }).click();
    await expect(firstQuestion).toHaveValue('Первая ветка');
  });

  test('ESN-356: удаляет скрытую первую ветку', async ({ page }) => {
    const composer = await openPollBuilder(page);
    const roots = await createTwoPollBranches(composer);
    const header = roots.first().getByRole('banner').first();
    await header.getByRole('button', { name: 'Скрыть ветку вопросов' }).click();
    await header.getByRole('button', { name: 'Удалить вопрос' }).click();
    await expect(roots).toHaveCount(1);
    await expect(roots.first().getByRole('textbox', { name: 'Ваш вопрос' })).toHaveValue('Вторая ветка');
  });

  test('поддерживает анонимность, статистику и бессрочный режим', async ({ page }) => {
    const composer = await openPollBuilder(page);
    const checkbox = (label: string) => composer.dialog.locator(`ekp-checkbox[label="${label}"]`);
    const checkboxInput = (label: string) => checkbox(label).locator('input[type="checkbox"]');

    await checkbox('Анонимный опрос').click();
    await expect(checkboxInput('Анонимный опрос')).toBeChecked();

    const statisticsLabel = 'Показывать статистику участникам';
    await expect(checkboxInput(statisticsLabel)).toBeChecked();
    await checkbox(statisticsLabel).click();
    await expect(checkboxInput(statisticsLabel)).not.toBeChecked();

    const unlimitedLabel = 'Опрос действует бессрочно';
    await checkbox(unlimitedLabel).click();
    await expect(checkboxInput(unlimitedLabel)).toBeChecked();
    await expect(composer.dialog.getByRole('textbox', { name: 'Дата окончания опроса' })).toBeHidden();
  });

  test('ESN-193: вопрос ограничен 1500 символами', async ({ page }) => {
    const composer = await openPollBuilder(page);
    const question = composer.dialog.getByRole('textbox', { name: 'Ваш вопрос' }).first();
    await expect(question).toHaveAttribute('maxlength', '1500');
    await question.fill('В'.repeat(1501));
    await expect(question).toHaveValue('В'.repeat(1500));
    await expect(question).toHaveJSProperty('value', 'В'.repeat(1500));
  });

  test('ESN-194: вариант ответа ограничен 500 символами', async ({ page }) => {
    const composer = await openPollBuilder(page);
    const answer = composer.dialog.getByRole('textbox', { name: 'Вариант ответа' }).first();
    await expect(answer).toHaveAttribute('maxlength', '500');
    await answer.fill('О'.repeat(501));
    await expect(answer).toHaveValue('О'.repeat(500));
    await expect(answer).toHaveJSProperty('value', 'О'.repeat(500));
  });

  test('ESN-185: создаёт сто заполненных вариантов ответа', async ({ page }) => {
    test.setTimeout(180_000);
    const composer = await openPollBuilder(page);
    const question = composer.dialog.getByRole('treeitem').first();
    await question.getByRole('textbox', { name: 'Ваш вопрос' }).fill('Вопрос со ста ответами');
    const answers = question.getByRole('textbox', { name: 'Вариант ответа' });
    await answers.nth(0).fill('Ответ 1');
    await answers.nth(1).fill('Ответ 2');
    const addAnswer = question.getByRole('button', { name: 'Добавить ответ', exact: true });
    for (let index = 2; index < 100; index += 1) {
      await addAnswer.click();
      await answers.nth(index).fill(`Ответ ${index + 1}`);
    }
    await expect(answers).toHaveCount(100);
    await expect(answers.nth(99)).toHaveValue('Ответ 100');
    await expect(addAnswer).toHaveCount(0);
  });

  test('ESN-362: оценки ответов передаются при публикации и голосовании', async ({ page }) => {
    test.skip(!env.runMutationTests, 'Для публикации нужен mutation-режим');
    const composer = await openPollBuilder(page);
    let postId: string | undefined;
    try {
      const questionText = 'Вопрос с оценками';
      const firstAnswer = 'Ответ с минусом';
      const secondAnswer = 'Ответ с плюсом';
      const question = composer.dialog.getByRole('treeitem').first();
      await question.getByRole('textbox', { name: 'Ваш вопрос' }).fill(questionText);
      await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(0).fill(firstAnswer);
      await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(1).fill(secondAnswer);
      const scores = question.locator('ekp-select[placeholder="Баллы"]');
      await expect(scores).toHaveCount(2);
      await expect(scores.nth(0)).toContainText('0');
      await expect(scores.nth(1)).toContainText('0');
      await scores.nth(0).click();
      await page.getByRole('option', { name: '-10', exact: true }).filter({ visible: true }).click();
      await expect(scores.nth(0)).toHaveAttribute('aria-expanded', 'false');
      await scores.nth(1).click();
      await expect(scores.nth(1)).toHaveAttribute('aria-expanded', 'true');
      await page.locator('ekp-select-item[role="option"]')
        .filter({ hasText: /^\s*6\s*$/, visible: true }).last().click();
      await expect(scores.nth(0)).toContainText('-10');
      await expect(scores.nth(1)).toContainText('6');

      const created = page.waitForRequest((request) =>
        request.method() === 'POST' && /\/api\/post\/$/.test(request.url()),
      );
      const createdResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
      );
      await composer.publishNow();
      postId = ((await (await createdResponse).json()) as { id: string }).id;
      const requestBody = (await created).postDataJSON() as {
        tiptap_doc: { content: { type: string; attrs?: { pollJson?: string } }[] };
      };
      const pollNode = requestBody.tiptap_doc.content.find((node) => node.type === 'poll');
      expect(pollNode?.attrs?.pollJson).toBeTruthy();
      const pollPayload = JSON.parse(pollNode!.attrs!.pollJson!) as {
        questions: { answers: { score: number }[] }[];
      };
      expect(pollPayload.questions[0].answers.map((answer) => answer.score)).toEqual([-10, 6]);

      await page.goto(`/post/${postId}`);
      await expect(page.getByText(questionText, { exact: true })).toBeVisible();
      await expect(page.getByText('-10', { exact: true }).filter({ visible: true })).toHaveCount(0);
      await expect(page.getByText('6', { exact: true }).filter({ visible: true })).toHaveCount(0);
      const vote = page.waitForResponse((response) =>
        response.request().method() === 'POST' &&
        /\/api\/post\/[^/]+\/polls\/[^/]+\/questions\/[^/]+\/answers\//i.test(response.url()),
      );
      await page.getByText(firstAnswer, { exact: true }).click();
      expect((await vote).ok()).toBe(true);
      const postResponse = await page.request.get(`https://dev-social-backend.sddt.efko.ru/api/post/${postId}`);
      expect(postResponse.ok()).toBe(true);
      const postBody = JSON.stringify(await postResponse.json());
      expect(postBody).toContain('-10');
      expect(postBody).toContain('6');
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

  test('ESN-333: задаёт будущие дату и время окончания опубликованного опроса', async ({ page }) => {
    test.skip(!env.runMutationTests, 'Для публикации нужен mutation-режим');
    const composer = await openPollBuilder(page);
    let postId: string | undefined;
    try {
      const question = composer.dialog.getByRole('treeitem').first();
      await question.getByRole('textbox', { name: 'Ваш вопрос' }).fill('Опрос с заданным сроком');
      await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(0).fill('Первый ответ');
      await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(1).fill('Второй ответ');
      const dateInput = composer.dialog.getByRole('textbox', { name: 'Дата окончания опроса' });
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const formatDate = (date: Date) => date.toISOString().slice(0, 10);
      await expect(dateInput).toHaveValue(formatDate(tomorrow));
      const minimum = await dateInput.getAttribute('min');
      expect(minimum).toBeTruthy();
      expect(new Date(minimum!).getTime()).toBeGreaterThanOrEqual(new Date(formatDate(new Date())).getTime());
      const future = new Date();
      future.setDate(future.getDate() + 3);
      await dateInput.fill(formatDate(future));
      expect(await dateInput.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true);

      const timeButton = composer.dialog.getByRole('button', { name: 'Время окончания опроса' });
      await timeButton.click();
      const timeOptions = page.getByRole('option').filter({ visible: true });
      await expect(timeOptions).toHaveCount(10);
      const selectedHour = (await timeOptions.nth(3).innerText()).trim();
      await timeOptions.nth(3).click();
      const visibleAfterHour = page.getByRole('option').filter({ visible: true });
      const selectedMinute = (await visibleAfterHour.nth(8).innerText()).trim();
      await visibleAfterHour.nth(8).click();
      await expect(timeOptions.first()).toBeVisible();
      await timeButton.click();
      await expect(timeOptions.first()).toBeHidden();
      await expect(timeButton).toHaveText(`${selectedHour}:${selectedMinute}`);

      const created = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
      );
      await composer.publishNow();
      postId = ((await (await created).json()) as { id: string }).id;
      await page.goto(`/post/${postId}`);
      await expect(page.getByRole('heading', { name: 'QA-E2E-POLL-BUILDER', exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('Опрос с заданным сроком', { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/Опрос действует до/i)).toBeVisible();
      await expect(page.getByText(new RegExp(`${selectedHour}:${selectedMinute}`))).toBeVisible();
    } finally {
      await deleteTemporaryPostViaApi(page, postId);
    }
  });

});
