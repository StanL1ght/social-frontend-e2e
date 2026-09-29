import { test, expect } from '../fixtures/test';
import { env } from '../helpers/env';
import { createTemporaryGroupViaApi, deleteTemporaryGroupViaApi } from '../helpers/group-api';
import { uniqueMarker } from '../helpers/test-data';
import { GroupsPage } from '../pages/GroupsPage';

test.describe('Форма и фильтры групп', () => {
  test('форма создания не отправляется без обязательных полей', async ({ page }) => {
    const groups = new GroupsPage(page);
    await groups.open();
    await groups.openCreateDialog();

    const create = groups.createDialog.getByRole('button', { name: 'Создать', exact: true });
    await expect(groups.createDialog.getByRole('textbox', { name: 'Название' })).toBeVisible();
    await expect(groups.createDialog.getByRole('textbox', { name: 'Описание' })).toBeVisible();
    await expect(create).toBeDisabled();

    await groups.createDialog.getByRole('textbox', { name: 'Название' }).fill('QA-E2E-ONLY-NAME');
    await expect(create).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(groups.createDialog).toBeHidden();
  });

  test('фильтр дивизиона открывает список значений', async ({ page }) => {
    await page.goto('/group');
    await page.getByRole('button', { name: 'Дивизион', exact: true }).click();

    const options = page.getByRole('option');
    await expect(options.first()).toBeVisible();
    expect(await options.count()).toBeGreaterThan(1);
  });

  test('ESN-160: последовательно фильтрует группы по двум дивизионам', async ({ page }) => {
    await page.goto('/group/all');
    const selector = page.getByRole('button', { name: /дивизион/i }).filter({ visible: true }).first();
    await expect(selector).toBeVisible();
    await selector.click();
    const options = page.getByRole('option');
    await expect(options.first()).toBeVisible();
    const optionNames = (await options.allTextContents())
      .map((name) => name.trim())
      .filter((name) => name && !/все дивизионы/i.test(name))
      .slice(0, 2);
    expect(optionNames).toHaveLength(2);
    await page.keyboard.press('Escape');

    const selectedDivisions: string[] = [];
    for (const division of optionNames) {
      await selector.click();
      const filtered = page.waitForResponse((response) => {
        if (response.request().method() !== 'GET') return false;
        const url = new URL(response.url());
        return /\/api\/group\/$/.test(url.pathname) && url.searchParams.has('community_id');
      });
      await page.getByRole('option', { name: division, exact: true }).click();
      const response = await filtered;
      expect(response.ok()).toBe(true);
      selectedDivisions.push(division);
      const communityIds = new URL(response.url()).searchParams.getAll('community_id');
      expect(communityIds).toHaveLength(selectedDivisions.length);
      for (const communityId of communityIds) expect(communityId).toMatch(/^\d+$/);
      const body = (await response.json()) as {
        data: Array<{ community?: { id?: number; name?: string } }>;
      };
      expect(body.data.length).toBeGreaterThan(0);
      for (const group of body.data) {
        expect(communityIds).toContain(group.community?.id?.toString());
        expect(selectedDivisions).toContain(group.community?.name);
      }
      await expect(page.getByText(division, { exact: true }).filter({ visible: true }).first()).toBeVisible();
    }
  });

  test('ESN-30: выбирает, сбрасывает и включает все дивизионы', async ({ page }) => {
    await page.goto('/group/all');
    const selector = page.getByRole('button', { name: /дивизион/i }).filter({ visible: true }).first();
    await selector.click();
    const options = page.getByRole('option');
    await expect(options.first()).toBeVisible();
    const divisionNames = (await options.allTextContents()).map((name) => name.trim()).filter(Boolean);
    const division = options.filter({ hasNotText: /все дивизионы/i }).first();
    const divisionName = (await division.innerText()).trim();
    expect(divisionName).not.toBe('');

    const selectedResponse = page.waitForResponse((response) => {
      if (response.request().method() !== 'GET') return false;
      const url = new URL(response.url());
      return /\/api\/group\/$/.test(url.pathname) && url.searchParams.has('community_id');
    });
    await division.click();
    expect(new URL((await selectedResponse).url()).searchParams.getAll('community_id')).toHaveLength(1);
    await selector.click();
    const selectedOption = page.getByRole('option', { name: divisionName, exact: true });
    await expect(selectedOption).toHaveAttribute('aria-selected', 'true');
    const resetResponse = page.waitForResponse((response) => {
      if (response.request().method() !== 'GET') return false;
      const url = new URL(response.url());
      return /\/api\/group\/$/.test(url.pathname) && !url.searchParams.has('community_id');
    });
    await selectedOption.click();
    expect((await resetResponse).ok()).toBe(true);

    let selectedCount = 0;
    for (const name of divisionNames) {
      await selector.click();
      const responsePromise = page.waitForResponse((response) => {
        if (response.request().method() !== 'GET') return false;
        const url = new URL(response.url());
        return /\/api\/group\/$/.test(url.pathname) && url.searchParams.getAll('community_id').length === selectedCount + 1;
      });
      await page.getByRole('option', { name, exact: true }).click();
      const response = await responsePromise;
      expect(response.ok()).toBe(true);
      selectedCount += 1;
    }
    expect(selectedCount).toBe(divisionNames.length);
  });

  test('ESN-116: сохраняет основные настройки группы @mutation', async ({ page }) => {
    test.skip(!env.runMutationTests, 'Для проверки нужна временная группа');
    const originalName = uniqueMarker('GROUP');
    const updatedName = `${uniqueMarker('GROUP')}-EDITED`;
    const updatedDescription = `Описание после редактирования ${uniqueMarker('COMMENT')}`;
    let groupId: string | undefined;

    try {
      groupId = await createTemporaryGroupViaApi(page, originalName, 'Публичная группа');
      await page.goto(`/group/${groupId}/posts`);
      await page.getByRole('button', { name: 'Вы администратор', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Редактировать', exact: true }).click();

      const dialog = page.getByRole('dialog', { name: 'Редактирование группы' });
      const name = dialog.getByRole('textbox', { name: 'Название' });
      const description = dialog.getByRole('textbox', { name: 'Описание' });
      await expect(name).toHaveValue(originalName);
      await name.fill(updatedName);
      await description.fill(updatedDescription);

      await dialog.getByRole('button', { name: 'Публичная группа', exact: true }).click();
      await page.getByRole('option', { name: 'Закрытая группа', exact: true }).click();

      const division = dialog.getByRole('button', { name: /дивизион/i });
      const originalDivision = (await division.textContent())?.trim() ?? '';
      await division.click();
      const divisionOptions = page.getByRole('option');
      const alternative = divisionOptions.filter({ hasNotText: originalDivision }).first();
      const selectedDivision = (await alternative.textContent())?.trim() ?? '';
      expect(selectedDivision).not.toBe('');
      await alternative.click();

      const updated = page.waitForResponse((response) =>
        response.request().method() === 'PUT' && /\/api\/group(?:\/|\?|$)/i.test(response.url()),
      );
      await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
      expect((await updated).ok()).toBe(true);
      await expect(dialog).toBeHidden();

      await expect(page.getByRole('heading', { name: updatedName, exact: true })).toBeVisible();
      await expect(page.getByText('Закрытая группа', { exact: true })).toBeVisible();
      await expect(page.getByText(selectedDivision, { exact: true })).toBeVisible();
      await expect(page.getByText(updatedDescription, { exact: true })).toBeVisible();

      await page.reload();
      await expect(page.getByRole('heading', { name: updatedName, exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Вы администратор', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Редактировать', exact: true }).click();
      const reopened = page.getByRole('dialog', { name: 'Редактирование группы' });
      await expect(reopened.getByRole('textbox', { name: 'Название' })).toHaveValue(updatedName);
      await expect(reopened.getByRole('textbox', { name: 'Описание' })).toHaveValue(updatedDescription);
      await expect(reopened.getByRole('button', { name: 'Закрытая группа', exact: true })).toBeVisible();
      await expect(reopened.getByRole('button', { name: selectedDivision, exact: true })).toBeVisible();
    } finally {
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });

  test('ESN-139: название и описание группы ограничены и сохраняются @mutation', async ({ page }) => {
    test.skip(!env.runMutationTests, 'Для проверки нужна временная группа');
    let groupId: string | undefined;
    const name = `${uniqueMarker('GROUP')}${'Н'.repeat(50)}`.slice(0, 50);
    const descriptionTail = 'КОНЕЦ-ОПИСАНИЯ';
    const description = `${'Д'.repeat(2972 - descriptionTail.length)}${descriptionTail}`;
    try {
      groupId = await createTemporaryGroupViaApi(page, uniqueMarker('GROUP'), 'Публичная группа');
      await page.goto(`/group/${groupId}/posts`);
      await page.getByRole('button', { name: 'Вы администратор', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Редактировать', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Редактирование группы' });
      const nameInput = dialog.getByRole('textbox', { name: 'Название' });
      const descriptionInput = dialog.getByRole('textbox', { name: 'Описание' });
      await nameInput.fill(`${name}Л`);
      const actualName = await nameInput.inputValue();
      expect.soft(actualName.length).toBe(50);
      await descriptionInput.fill(`${description}Л`);
      const actualDescription = await descriptionInput.inputValue();
      expect.soft(actualDescription.length).toBe(2973);

      const updated = page.waitForResponse((response) =>
        response.request().method() === 'PUT' && /\/api\/group(?:\/|\?|$)/i.test(response.url()),
      );
      await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
      expect((await updated).ok()).toBe(true);
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('heading', { name: actualName, exact: true })).toBeVisible();
      const more = page.getByText(/Ещё|Еще/, { exact: true });
      await expect(more).toBeVisible();
      await more.click();
      if (actualDescription.includes(descriptionTail)) {
        await expect(page.getByText(/КОНЕЦ-ОПИСАНИЯ/)).toBeVisible();
      }
    } finally {
      await deleteTemporaryGroupViaApi(page, groupId);
    }
  });
});
