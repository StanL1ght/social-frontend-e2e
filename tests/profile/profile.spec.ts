import { test, expect } from '../fixtures/test';
import { AppShellPage } from '../pages/AppShellPage';
import { env } from '../helpers/env';
import { createTemporaryPostViaApi, deleteTemporaryPostViaApi } from '../helpers/post-api';
import { createTemporaryGroupViaApi, deleteTemporaryGroupViaApi } from '../helpers/group-api';
import { uniqueMarker } from '../helpers/test-data';
import { PostPage } from '../pages/PostPage';

test.describe('Моя страница', () => {
  test.beforeEach(async ({ page }) => {
    await new AppShellPage(page).goto('/feed');
    await new AppShellPage(page).openSection('Моя страница');
    await expect(page).toHaveURL(/\/profile\//);
  });

  test('отображает основные вкладки профиля', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Публикации', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Участники', exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Реакции и комментарии', exact: true }),
    ).toBeVisible();
  });

  test('ESN-86: вкладка «Группы» отсутствует в профиле по актуальному требованию', async ({ page }) => {
    const profileTabs = page.getByRole('button', { name: 'Публикации', exact: true }).locator('..');
    await expect(profileTabs.getByRole('button', { name: 'Группы', exact: true })).toHaveCount(0);
  });

  test('ESN-100: профиль открывается на вкладке «Публикации»', async ({ page }) => {
    const publications = page.getByRole('button', { name: 'Публикации', exact: true });
    await expect(publications).toHaveClass(/s-active-link/);
    await expect(page.getByText(/Всего публикаций:/i)).toBeVisible();
    await expect(page.locator('a[href*="/post/"]').first()).toBeVisible();
  });

  test('ESN-342, ESN-511: открывает подписчиков и профиль участника', async ({ page }) => {
    const participants = page.getByRole('button', { name: 'Участники', exact: true });
    await participants.click();
    await expect(participants).toHaveClass(/s-active-link/);
    await expect(page.getByText(/Всего участников:/i)).toBeVisible();
    const person = page.locator('a[href*="/profile/"]').filter({ visible: true }).last();
    await expect(person).toBeVisible();
    const target = await person.getAttribute('href');
    expect(target).toMatch(/\/profile\//);
    await person.click();
    await expect(page).toHaveURL(new RegExp(target!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  test('ESN-96: переключает подписчиков и подписки и открывает профиль из списка', async ({ page }) => {
    const followersCounter = page.getByText(/^подписчик(?:а|ов)?$/i).first().locator('..');
    const followingCounter = page.getByText(/^подписк(?:а|и|ок)$/i).first().locator('..');
    await expect(followersCounter).toBeVisible({ timeout: 20_000 });
    await expect(followingCounter).toBeVisible();
    await followersCounter.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Подписчики/i).first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(dialog).toBeHidden();

    await followingCounter.click();
    await expect(dialog).toBeVisible();
    const followers = dialog.getByRole('button', { name: /Подписчики/ }).last();
    const following = dialog.getByRole('button', { name: /Подписки/ }).last();
    await expect(followers).toBeVisible();
    await expect(following).toBeVisible();

    await following.click();
    await expect(following).toHaveClass(/checked|active/);
    await expect(dialog.locator('a[href*="/profile/"]').last()).toBeVisible();

    await followers.click();
    await expect(followers).toHaveClass(/checked|active/);
    const person = dialog.locator('a[href*="/profile/"]').last();
    const profileHref = await person.getAttribute('href');
    expect(profileHref).toMatch(/\/profile\//);
    await person.click();
    await expect(page).toHaveURL(new RegExp(profileHref!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  test('ESN-347: ищет участника профиля по частям ФИО', async ({ page }) => {
    await page.getByRole('button', { name: 'Участники', exact: true }).click();
    const personLink = page.locator('a[href*="/profile/"]').filter({ visible: true }).last();
    await expect(personLink).toBeVisible();
    const fullName = (await personLink.innerText()).trim().replace(/\s+/g, ' ');
    const parts = fullName.split(' ').filter((part) => part.length > 1);
    const search = page.getByPlaceholder(/\u041fоиск/i).filter({ visible: true }).last();
    await expect(search).toBeVisible();
    for (const query of [...parts, parts.slice(0, 2).join(' '), fullName]) {
      await search.fill(query);
      await expect(page.getByText(fullName, { exact: true }).last()).toBeVisible();
    }
  });

  test('ESN-346: показывает отдельную вкладку закреплённых публикаций', async ({ page }) => {
    const pinned = page.getByRole('button', { name: 'Закрепленные публикации', exact: true });
    await pinned.click();
    await expect(pinned).toHaveClass(/checked/);
    await expect(page.getByRole('button', { name: 'Все', exact: true })).not.toHaveClass(/checked/);
  });

  test('ESN-510: вкладка закреплённых показывает только закреплённую публикацию @mutation', async ({ page }) => {
    test.fixme(true, 'Кейс в draft: личный пост нельзя закрепить, а закреплённый в группе пост не попадает во вкладку профиля');
    test.skip(!env.runMutationTests, 'Нужны две временные публикации');
    const pinnedTitle = `${uniqueMarker('POST')}-PINNED-PROFILE`;
    const ordinaryTitle = `${uniqueMarker('POST')}-ORDINARY-PROFILE`;
    let pinnedId: string | undefined;
    let ordinaryId: string | undefined;
    let groupId: string | undefined;
    try {
      groupId = await createTemporaryGroupViaApi(page, uniqueMarker('GROUP'), 'Публичная группа');
      pinnedId = await createTemporaryPostViaApi(page, pinnedTitle, groupId);
      ordinaryId = await createTemporaryPostViaApi(page, ordinaryTitle);
      await page.goto(`/post/${pinnedId}`);
      await new PostPage(page).openActions();
      await page.getByRole('menuitem', { name: 'Прикрепить пост', exact: true }).click();
      const confirmation = page.getByRole('menuitem', { name: 'Прикрепить пост?', exact: true });
      if (await confirmation.isVisible()) await confirmation.click();

      await new AppShellPage(page).openSection('Моя страница');
      const pinned = page.getByRole('button', { name: /Закрепл[её]нные публикации/i });
      await pinned.click();
      const heading = page.getByRole('heading', { name: pinnedTitle, exact: true });
      await expect(heading).toBeVisible();
      await expect(page.getByRole('heading', { name: ordinaryTitle, exact: true })).toHaveCount(0);
      await heading.click();
      await expect(page).toHaveURL(new RegExp(`/post/${pinnedId}`));
      await expect(page.getByRole('heading', { name: pinnedTitle, exact: true })).toBeVisible();
    } finally {
      await deleteTemporaryPostViaApi(page, ordinaryId);
      await deleteTemporaryPostViaApi(page, pinnedId);
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });

  test('ESN-343: вкладка «Реакции и комментарии» открывается на реакциях', async ({ page }) => {
    const activity = page.getByRole('button', { name: 'Реакции и комментарии', exact: true });
    await activity.click();
    await expect(activity).toHaveClass(/s-active-link/);
    await expect(page.getByRole('button', { name: 'Реакции', exact: true })).toHaveClass(/checked/);
    await expect(page.getByRole('button', { name: 'Комментарии', exact: true })).toBeVisible();
  });

  test('ESN-102: открывает оставленные комментарии и переходит к посту', async ({ page }) => {
    await page.getByRole('button', { name: 'Реакции и комментарии', exact: true }).click();
    const comments = page.getByRole('button', { name: 'Комментарии', exact: true });
    await comments.click();
    await expect(comments).toHaveClass(/checked/);
    await expect(page.getByText(/Всего комментариев:/i)).toBeVisible();
    const publicationTitle = page.locator('.profile-commented-feed__title').filter({ visible: true }).first();
    await expect(publicationTitle).toBeVisible();
    await publicationTitle.click();
    await expect(page).toHaveURL(/\/post\//);
  });

  for (const tab of [
    { id: 'ESN-344', name: 'Опросы', content: /Всего опросов:|Публикаций нет/i },
    { id: 'ESN-345', name: 'Файлы', content: /Все файлы|Публикаций нет/i },
  ] as const) {
    test(`${tab.id}: открывает вкладку «${tab.name}» профиля`, async ({ page }) => {
      const button = page.getByRole('button', { name: tab.name, exact: true });
      await button.click();
      await expect(button).toHaveClass(/s-active-link/);
      await expect(page.getByText(tab.content).first()).toBeVisible();
    });
  }

  test('ESN-105: назад возвращает на предыдущую вкладку профиля', async ({ page }) => {
    const polls = page.getByRole('button', { name: 'Опросы', exact: true });
    const files = page.getByRole('button', { name: 'Файлы', exact: true });
    await polls.click();
    await expect(polls).toHaveClass(/s-active-link/);
    await files.click();
    await expect(files).toHaveClass(/s-active-link/);
    await page.goBack();
    await expect(polls).toHaveClass(/s-active-link/);
  });
});
