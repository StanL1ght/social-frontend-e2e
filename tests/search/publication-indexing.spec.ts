import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { uniqueMarker } from '../helpers/test-data';
import { AppShellPage } from '../pages/AppShellPage';
import { GroupPage } from '../pages/GroupPage';
import { GroupsPage } from '../pages/GroupsPage';
import { PostComposerPage } from '../pages/PostComposerPage';
import { PostPage } from '../pages/PostPage';

test.describe('@mutation @diagnostic Индексация публикаций', () => {
  test.skip(!env.runMutationTests, 'Для запуска установите RUN_MUTATION_TESTS=true');

  test('сравнить поиск поста из личной ленты и из группы', async ({ page }) => {
    test.setTimeout(180_000);
    const groupName = uniqueMarker('GROUP');
    const personalTitle = uniqueMarker('POST') + '-PERSONAL';
    const groupTitle = uniqueMarker('POST') + '-GROUP';
    const body = 'Уникальный текст для проверки индексации E2E.';
    const postUrls: string[] = [];
    let groupUrl: string | undefined;
    let groupDeleted = false;

    const createPost = async (title: string, destination: string): Promise<string> => {
      await page.goto('/feed');
      const composer = new PostComposerPage(page);
      await composer.open();
      await composer.selectDestination(destination);
      await composer.fill(title, body);
      await composer.publishNow();

      await page.goto('/my-publications/published');
      const heading = page.getByRole('heading', { name: title, exact: true });
      await expect(heading).toBeVisible();
      const card = heading.locator(
        'xpath=ancestor::*[.//a[contains(@href,"/post/")]][1]',
      );
      const href = await card.locator('a[href*="/post/"]').first().getAttribute('href');
      expect(href).toBeTruthy();
      return new URL(href!, env.baseURL).toString();
    };

    const appearsInGlobalSearch = async (title: string): Promise<boolean> => {
      await expect
        .poll(
          async () => {
            await page.goto('/feed', { waitUntil: 'domcontentloaded' });
            const searchResponse = page.waitForResponse(
              (response) =>
                /search|multisearch|multi-search/i.test(response.url()) &&
                response.status() < 500,
              { timeout: 20_000 },
            );
            await new AppShellPage(page).searchGlobally(title);
            const response = await searchResponse;
            expect(response.ok(), `Поиск завершился со статусом ${response.status()}`).toBe(true);
            return page
              .getByRole('dialog', { name: 'Поиск' })
              .getByText(title, { exact: true })
              .isVisible();
          },
          {
            message: `Публикация ${title} должна появиться после завершения индексации`,
            timeout: 60_000,
            intervals: [2_000, 5_000, 10_000],
          },
        )
        .toBe(true);
      return true;
    };

    try {
      const groups = new GroupsPage(page);
      await groups.open();
      await groups.createPublicGroup(
        groupName,
        'Контрольная группа для сравнения индексации публикаций.',
      );
      await groups.openOwnedGroup(groupName);
      groupUrl = page.url();

      postUrls.push(await createPost(personalTitle, 'Моя лента'));
      postUrls.push(await createPost(groupTitle, groupName));

      const personalFound = await appearsInGlobalSearch(personalTitle);
      const groupFound = await appearsInGlobalSearch(groupTitle);

      await test.info().attach('indexing-comparison.json', {
        body: Buffer.from(
          JSON.stringify(
            {
              personal: { title: personalTitle, found: personalFound },
              group: { title: groupTitle, found: groupFound },
            },
            null,
            2,
          ),
        ),
        contentType: 'application/json',
      });

      expect.soft(groupFound, 'Пост группы должен находиться глобальным поиском').toBe(true);
      expect
        .soft(personalFound, 'Пост из личной ленты должен находиться глобальным поиском')
        .toBe(true);
    } finally {
      for (const postUrl of postUrls) {
        await page.goto(postUrl);
        if (await page.getByRole('button', { name: 'Действия', exact: true }).isVisible()) {
          await new PostPage(page).deleteThroughUi();
        }
      }

      if (groupUrl && !groupDeleted) {
        await page.goto(groupUrl);
        if (
          await page
            .getByRole('button', { name: 'Вы администратор', exact: true })
            .isVisible()
        ) {
          await new GroupPage(page).deleteThroughUi();
          groupDeleted = true;
        }
      }
    }
  });
});
