import { test, expect } from '../fixtures/test';

type CatalogPerson = { fullName: string; firstName: string; lastName: string; middleName?: string; email: string; id: string; isBlocked?: boolean };

async function catalogPerson(page: import('@playwright/test').Page): Promise<CatalogPerson> {
  const catalogResponse = page.waitForResponse((response) =>
    response.url().includes('/api/person/search?') &&
    new URL(response.url()).searchParams.get('search') === '' &&
    response.ok(),
  );
  await page.goto('/catalogs');
  const payload = (await (await catalogResponse).json()) as {
    data?: { list?: CatalogPerson[] };
  };
  const person = payload.data?.list?.find((item) =>
    item.fullName && item.firstName && item.lastName && item.email && !item.isBlocked,
  );
  expect(person, 'В каталоге должен быть пользователь с ФИО и Email').toBeTruthy();
  return person!;
}

test.describe('Каталог персон — кейсы ESN-84 и ESN-339', () => {
  for (const criterion of ['ФИО', 'Email'] as const) {
    test(`поиск профиля из каталога по ${criterion}`, async ({ page }) => {
      const user = await catalogPerson(page);
      const search = page.locator('input[placeholder="Поиск по ФИО, Email или должности"]');
      await expect(search).toBeVisible();
      const nameParts = user.fullName.split(/\s+/).filter(Boolean);
      const local = user.email.split('@')[0];
      const domain = user.email.split('@')[1];
      const queries = criterion === 'ФИО'
        ? [
            user.firstName,
            user.lastName,
            user.middleName ?? nameParts[2],
            `${user.firstName} ${user.lastName}`,
            `${user.lastName} ${user.firstName}`,
            user.fullName,
          ].filter((query): query is string => Boolean(query && query.length > 1))
        : [
            user.email,
            local,
            domain,
            `${local}@${domain.slice(0, Math.max(3, Math.floor(domain.length / 2)))}`,
            user.email.toUpperCase(),
            ` ${user.email} `,
          ];

      for (const query of [...new Set(queries)]) {
        const normalized = query.trim();
        const searchResponse = page.waitForResponse(
          (response) =>
            response.url().includes('/api/person/search?') &&
            new URL(response.url()).searchParams.get('search') === normalized &&
            response.ok(),
          { timeout: 3_000 },
        ).catch(() => undefined);
        await search.fill(query);
        const response = await searchResponse;
        if (response) {
          const searchResult = (await response.json()) as { data?: { list?: CatalogPerson[] } };
          expect(searchResult.data?.list?.some((item) => item.id === user.id),
            `Поиск по ${criterion} «${query}» должен вернуть выбранного пользователя`,
          ).toBe(true);
        }
        await expect(
          page.getByRole('link', { name: `${user.firstName} ${user.lastName}`, exact: true }),
          `Результат поиска по ${criterion} «${query}»`,
        ).toBeVisible();
      }

      if (criterion === 'Email') {
        await search.fill(`${local}@`);
        await search.fill(user.email);
      }

      const result = page.getByRole('link', { name: `${user.firstName} ${user.lastName}`, exact: true });
      await expect(result).toBeVisible({ timeout: 20_000 });
      await result.click();
      await expect(page).toHaveURL(/\/profile\//);
    });
  }

  test('ESN-340: поиск персон по должности', async ({ page }) => {
    await page.goto('/catalogs');
    const search = page.locator('input[placeholder="Поиск по ФИО, Email или должности"]');
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/person/search?') &&
        new URL(response.url()).searchParams.get('search') === 'инженер' &&
        response.ok(),
    );
    await search.fill('инженер');
    const payload = (await (await responsePromise).json()) as { data?: { list?: CatalogPerson[] } };
    expect(payload.data?.list?.length, 'Поиск по должности должен вернуть персон').toBeGreaterThan(0);
    const person = payload.data!.list![0];
    await expect(page.getByRole('link', { name: `${person.firstName} ${person.lastName}`, exact: true })).toBeVisible();
  });
});
