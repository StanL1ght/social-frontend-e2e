import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { uniqueMarker } from '../helpers/test-data';
import { GroupPage } from '../pages/GroupPage';
import { GroupsPage } from '../pages/GroupsPage';

test.describe('@mutation Жизненный цикл группы', () => {
  test.skip(!env.runMutationTests, 'Для запуска установите RUN_MUTATION_TESTS=true');

  test('создать публичную группу и удалить её через UI', async ({ page }) => {
    const name = uniqueMarker('GROUP');
    const description = 'Автоматическая E2E-проверка. Группа будет удалена после теста.';
    let groupUrl: string | undefined;
    let deleted = false;

    try {
      const groups = new GroupsPage(page);
      await groups.open();
      await groups.createPublicGroup(name, description);
      await groups.openOwnedGroup(name);

      groupUrl = page.url();
      await expect(page.getByText('Публичная группа', { exact: true })).toBeVisible();
      await expect(page.getByText('ИТ дивизион', { exact: true })).toBeVisible();
      await expect(page.getByText(description, { exact: true })).toBeVisible();

      await new GroupPage(page).deleteThroughUi();
      deleted = true;

      await page.goto(groupUrl);
      await expect(page.getByText('Группа не найдена', { exact: true })).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      if (groupUrl && !deleted) {
        await page.goto(groupUrl);
        if (
          await page
            .getByRole('button', { name: 'Вы администратор', exact: true })
            .isVisible()
        ) {
          await new GroupPage(page).deleteThroughUi();
        }
      }
    }
  });
});
