import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { env, hasMultiUserEnvironment } from '../helpers/env';
import { deleteTemporaryPostViaApi } from '../helpers/post-api';
import { uniqueMarker } from '../helpers/test-data';
import { LoginPage } from '../pages/LoginPage';
import { PostComposerPage } from '../pages/PostComposerPage';

test('опрос проходят два пользователя с общим результатом 50/50 @multiuser @mutation', async ({
  browser,
}) => {
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два пользователя и mutation-режим');
  test.setTimeout(120_000);
  const authorContext = await browser.newContext({ baseURL: env.baseURL });
  const voterContext = await browser.newContext({ baseURL: env.baseURL });
  let postId: string | undefined;
  const title = uniqueMarker('POST');
  const question = 'Какой ответ выбрал второй пользователь?';
  const selectedAnswer = 'Ответ второго пользователя';
  const otherAnswer = 'Другой вариант';

  try {
    const authorPage = await authorContext.newPage();
    const voterPage = await voterContext.newPage();
    await new LoginPage(authorPage).login(env.email, env.password);
    await new LoginPage(voterPage).login(env.memberEmail, env.memberPassword);

    await authorPage.goto('/feed');
    const composer = new PostComposerPage(authorPage);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.fill(title, 'Временный опрос для проверки вторым аккаунтом.');
    await composer.editor.locator('p').last().click();
    await composer.dialog.getByRole('button', { name: 'Опрос', exact: true }).click();
    const pollQuestion = composer.dialog.getByRole('treeitem').first();
    await pollQuestion.getByRole('textbox', { name: 'Ваш вопрос' }).fill(question);
    const answers = pollQuestion.getByRole('textbox', { name: 'Вариант ответа' });
    await answers.nth(0).fill(selectedAnswer);
    await answers.nth(1).fill(otherAnswer);
    const created = authorPage.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;

    await voterPage.goto(`/post/${postId}`);
    await expect(voterPage.getByText(question, { exact: true })).toBeVisible();
    const vote = voterPage.waitForResponse((response) =>
      response.request().method() === 'POST' &&
      /\/api\/post\/[^/]+\/polls\/[^/]+\/questions\/[^/]+\/answers\//i.test(response.url()),
    );
    await voterPage.getByText(selectedAnswer, { exact: true }).click();
    expect((await vote).ok()).toBe(true);
    await expect(voterPage.getByRole('option', { name: /Ответ второго пользователя 100%/ })).toBeVisible();

    await authorPage.goto(`/post/${postId}`);
    const authorVote = authorPage.waitForResponse((response) =>
      response.request().method() === 'POST' &&
      /\/api\/post\/[^/]+\/polls\/[^/]+\/questions\/[^/]+\/answers\//i.test(response.url()),
    );
    await authorPage.getByText(otherAnswer, { exact: true }).click();
    expect((await authorVote).ok()).toBe(true);
    await expect(authorPage.getByRole('option', { name: /Ответ второго пользователя 50%/ })).toBeVisible();
    await expect(authorPage.getByRole('option', { name: /Другой вариант 50%/ })).toBeVisible();
    await expect(authorPage.getByText('2 голоса', { exact: true })).toBeVisible();

    await voterPage.reload();
    await expect(voterPage.getByRole('option', { name: /Ответ второго пользователя 50%/ })).toBeVisible();
    await expect(voterPage.getByRole('option', { name: /Другой вариант 50%/ })).toBeVisible();
  } finally {
    const authorPage = authorContext.pages()[0];
    if (authorPage) await deleteTemporaryPostViaApi(authorPage, postId);
    await voterContext.close();
    await authorContext.close();
  }
});

test('ESN-187: второй пользователь проходит трёхуровневую карусель опроса @multiuser @mutation', async ({ browser }) => {
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два пользователя и mutation-режим');
  test.setTimeout(150_000);
  const authorContext = await browser.newContext({ baseURL: env.baseURL });
  const voterContext = await browser.newContext({ baseURL: env.baseURL });
  const authorPage = await authorContext.newPage();
  const voterPage = await voterContext.newPage();
  const questions = ['Корневой вопрос карусели', 'Подвопрос карусели', 'Подвопрос второго уровня'];
  const selected = ['Перейти к подвопросу', 'Перейти глубже', 'Завершить карусель'];
  const alternatives = ['Завершить сразу', 'Другой путь', 'Другой финал'];
  let postId: string | undefined;
  try {
    await new LoginPage(authorPage).login(env.email, env.password);
    await new LoginPage(voterPage).login(env.memberEmail, env.memberPassword);
    await authorPage.goto('/feed');
    const composer = new PostComposerPage(authorPage);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.fill(`${uniqueMarker('POST')}-NESTED-POLL`, 'Трёхуровневая карусель опроса.');
    await composer.editor.locator('p').last().click();
    await composer.dialog.getByRole('button', { name: 'Опрос', exact: true }).click();
    let current = composer.dialog.getByRole('treeitem').first();
    for (let level = 0; level < questions.length; level += 1) {
      await current.getByRole('textbox', { name: 'Ваш вопрос' }).fill(questions[level]);
      await current.getByRole('textbox', { name: 'Вариант ответа' }).nth(0).fill(selected[level]);
      await current.getByRole('textbox', { name: 'Вариант ответа' }).nth(1).fill(alternatives[level]);
      if (level < questions.length - 1) {
        await current.getByRole('button', { name: 'Добавить следующий вопрос' }).first().click();
        current = composer.dialog.getByRole('treeitem').nth(level + 1);
      }
    }
    const created = authorPage.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;

    await voterPage.goto(`/post/${postId}`);
    for (let level = 0; level < questions.length; level += 1) {
      await expect(voterPage.getByText(questions[level], { exact: true })).toBeVisible();
      const vote = voterPage.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/polls\/.*\/answers\//i.test(response.url()),
      );
      await voterPage.getByText(selected[level], { exact: true }).click();
      expect((await vote).ok()).toBe(true);
    }
    for (let level = 1; level < questions.length; level += 1) {
      await voterPage.getByRole('button', { name: 'Следующий вопрос' }).click();
      await expect(voterPage.getByRole('listbox', { name: questions[level] })).toBeVisible();
      await expect(voterPage.getByRole('option', { name: new RegExp(`${selected[level]} 100%`) })).toBeVisible();
    }
    await expect(voterPage.getByRole('button', { name: 'Следующий вопрос' })).toBeDisabled();
    await voterPage.getByRole('button', { name: 'Предыдущий вопрос' }).click();
    await expect(voterPage.getByRole('listbox', { name: questions[1] })).toBeVisible();

    const postResponse = await authorPage.request.get(`https://dev-social-backend.sddt.efko.ru/api/post/${postId}`);
    expect(postResponse.ok()).toBe(true);
    const payload = JSON.stringify(await postResponse.json());
    for (const value of [...questions, ...selected, ...alternatives]) expect(payload).toContain(value);
    await authorPage.goto(`/post/${postId}`);
    await expect(authorPage.getByText(questions[0], { exact: true })).toBeVisible();
    await expect(authorPage.getByText(selected[0], { exact: true })).toBeVisible();
    await expect(authorPage.getByText(alternatives[0], { exact: true })).toBeVisible();
  } finally {
    await deleteTemporaryPostViaApi(authorPage, postId);
    await voterContext.close();
    await authorContext.close();
  }
});

test('ESN-332: участник не видит статистику после прохождения опроса @multiuser @mutation', async ({
  browser,
}) => {
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два пользователя и mutation-режим');
  test.fail(true, 'Dev показывает участнику проценты и кнопку «Показать статистику» при выключенной настройке');
  test.setTimeout(120_000);
  const authorContext = await browser.newContext({ baseURL: env.baseURL });
  const voterContext = await browser.newContext({ baseURL: env.baseURL });
  let postId: string | undefined;
  const title = uniqueMarker('POST');
  const questionText = 'Опрос без статистики для участника';
  const answerText = 'Закрытый результат';
  try {
    const authorPage = await authorContext.newPage();
    const voterPage = await voterContext.newPage();
    await new LoginPage(authorPage).login(env.email, env.password);
    await new LoginPage(voterPage).login(env.memberEmail, env.memberPassword);

    await authorPage.goto('/feed');
    const composer = new PostComposerPage(authorPage);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.fill(title, 'Временный опрос без статистики.');
    await composer.editor.locator('p').last().click();
    await composer.dialog.getByRole('button', { name: 'Опрос', exact: true }).click();
    const question = composer.dialog.getByRole('treeitem').first();
    await question.getByRole('textbox', { name: 'Ваш вопрос' }).fill(questionText);
    await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(0).fill(answerText);
    await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(1).fill('Другой закрытый результат');
    const statistics = composer.dialog.locator('ekp-checkbox[label="Показывать статистику участникам"]');
    await statistics.click();
    await expect(statistics.locator('input[type="checkbox"]')).not.toBeChecked();
    const created = authorPage.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    postId = ((await (await created).json()) as { id: string }).id;

    await voterPage.goto(`/post/${postId}`);
    const vote = voterPage.waitForResponse((response) =>
      response.request().method() === 'POST' &&
      /\/api\/post\/[^/]+\/polls\/[^/]+\/questions\/[^/]+\/answers\//i.test(response.url()),
    );
    await voterPage.getByText(answerText, { exact: true }).click();
    expect((await vote).ok()).toBe(true);
    await expect(voterPage.getByText('1 голос', { exact: true })).toBeVisible();
    await expect(voterPage.getByRole('option', { name: /%/ })).toHaveCount(0);
    await expect(voterPage.getByRole('button', { name: /Статистик/ })).toHaveCount(0);
  } finally {
    const authorPage = authorContext.pages()[0];
    if (authorPage) await deleteTemporaryPostViaApi(authorPage, postId);
    await voterContext.close();
    await authorContext.close();
  }
});

test('ESN-486: завершение опроса после указанного срока @multiuser @mutation', async ({ browser }) => {
  test.skip(!hasMultiUserEnvironment || !env.runMutationTests, 'Нужны два пользователя и mutation-режим');
  test.fixme(true, 'API-создание с близким ends_at пока отображает исходный срок шаблона; нужен подтверждённый способ подготовки завершённого опроса');
  test.setTimeout(300_000);
  const authorContext = await browser.newContext({ baseURL: env.baseURL });
  const voterContext = await browser.newContext({ baseURL: env.baseURL });
  let postId: string | undefined;
  let templatePostId: string | undefined;
  try {
    const authorPage = await authorContext.newPage();
    const voterPage = await voterContext.newPage();
    await new LoginPage(authorPage).login(env.email, env.password);
    await new LoginPage(voterPage).login(env.memberEmail, env.memberPassword);
    await authorPage.goto('/feed');
    const composer = new PostComposerPage(authorPage);
    await composer.open();
    await composer.selectDestination('Моя лента');
    await composer.fill(`${uniqueMarker('POST')}-EXPIRING-POLL`, 'Опрос с ближайшим сроком окончания.');
    await composer.editor.locator('p').last().click();
    await composer.dialog.getByRole('button', { name: 'Опрос', exact: true }).click();
    const question = composer.dialog.getByRole('treeitem').first();
    await question.getByRole('textbox', { name: 'Ваш вопрос' }).fill('Опрос должен завершиться по времени');
    await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(0).fill('Ответ до завершения');
    await question.getByRole('textbox', { name: 'Вариант ответа' }).nth(1).fill('Второй ответ');
    const date = composer.dialog.getByRole('textbox', { name: 'Дата окончания опроса' });
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await date.fill(tomorrow);
    const time = composer.dialog.getByRole('button', { name: 'Время окончания опроса' });
    await time.click();
    await authorPage.getByRole('option').filter({ visible: true }).nth(3).click();
    await authorPage.getByRole('option').filter({ visible: true }).nth(8).click();

    const requestPromise = authorPage.waitForRequest((request) =>
      request.method() === 'POST' && /\/api\/post\/$/.test(request.url()),
    );
    const responsePromise = authorPage.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/post\/$/.test(response.url()),
    );
    await composer.publishNow();
    const request = await requestPromise;
    templatePostId = ((await (await responsePromise).json()) as { id: string }).id;
    const body = request.postDataJSON() as { tiptap_doc: { content: Array<{ type: string; attrs?: { pollId?: string; pollJson?: string } }> } };
    const pollNode = body.tiptap_doc.content.find((node) => node.type === 'poll');
    expect(pollNode?.attrs?.pollJson).toBeTruthy();
    const poll = JSON.parse(pollNode!.attrs!.pollJson!) as {
      ends_at: string;
      questions: Array<{ id: string; answers: Array<{ id: string }> }>;
    };
    const endsAt = new Date(Date.now() + 120_000);
    poll.ends_at = endsAt.toISOString();
    // Клонированный POST не должен ссылаться на опрос исходного шаблона.
    pollNode!.attrs!.pollId = randomUUID();
    for (const question of poll.questions) {
      question.id = randomUUID();
      for (const answer of question.answers) answer.id = randomUUID();
    }
    pollNode!.attrs!.pollJson = JSON.stringify(poll);
    const created = await authorPage.request.post('https://dev-social-backend.sddt.efko.ru/api/post/', { data: body });
    expect(created.ok(), `Создание опроса с близким сроком: ${created.status()}`).toBe(true);
    postId = ((await created.json()) as { id: string }).id;
    await deleteTemporaryPostViaApi(authorPage, templatePostId);
    templatePostId = undefined;

    await voterPage.goto(`/post/${postId}`);
    await expect(voterPage.getByText('Опрос должен завершиться по времени', { exact: true })).toBeVisible();
    await expect(voterPage.getByRole('option', { name: 'Второй ответ', exact: true })).toBeVisible();
    await expect(voterPage.getByText(/Опрос действует до/i)).toBeVisible();

    await expect.poll(() => Date.now(), { timeout: 150_000, intervals: [5_000] })
      .toBeGreaterThan(endsAt.getTime() + 5_000);
    await voterPage.reload();
    await expect(voterPage.getByText('Опрос должен завершиться по времени', { exact: true })).toBeVisible();
    const finishedAnswer = voterPage.getByRole('option', { name: /Второй ответ/ });
    await expect(finishedAnswer).toBeVisible();
    const pollState = async (): Promise<string> => {
      const response = await voterPage.request.get(`https://dev-social-backend.sddt.efko.ru/api/post/${postId}`);
      expect(response.ok()).toBe(true);
      const findQuestion = (value: unknown): unknown => {
        if (!value || typeof value !== 'object') return undefined;
        if (!Array.isArray(value) && (value as { question?: string }).question === 'Опрос должен завершиться по времени') return value;
        for (const nested of Array.isArray(value) ? value : Object.values(value)) {
          const found = findQuestion(nested);
          if (found) return found;
        }
        return undefined;
      };
      const questionState = findQuestion(await response.json());
      expect(questionState, 'API должен вернуть вопрос завершённого опроса').toBeTruthy();
      return JSON.stringify(questionState);
    };
    const stateBeforeLateClick = await pollState();
    let lateVoteRequests = 0;
    voterPage.on('request', (request) => {
      if (request.method() === 'POST' && /\/polls\/.*\/answers\//i.test(request.url())) lateVoteRequests += 1;
    });
    await finishedAnswer.click();
    await voterPage.waitForTimeout(500);
    expect(lateVoteRequests).toBe(0);
    expect(await pollState()).toBe(stateBeforeLateClick);
  } finally {
    const authorPage = authorContext.pages()[0];
    if (authorPage) {
      await deleteTemporaryPostViaApi(authorPage, postId);
      await deleteTemporaryPostViaApi(authorPage, templatePostId);
    }
    await voterContext.close();
    await authorContext.close();
  }
});
