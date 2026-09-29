import { expect, type Locator, type Page, type Response } from '@playwright/test';

const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function waitForInteractive(locator: Locator): Promise<void> {
  await locator.page().locator('#ekp-browser-banner, #ekp-browser-top-banner').evaluateAll(
    (banners) => banners.forEach((banner) => banner.remove()),
  );
  await expect(locator).toBeVisible({ timeout: 20_000 });
  await expect(locator).toBeEnabled({ timeout: 20_000 });
}

export async function clickAndWaitForMutation(
  page: Page,
  locator: Locator,
  resource: RegExp,
): Promise<Response> {
  await waitForInteractive(locator);

  const responsePromise = page.waitForResponse(
    (response) =>
      mutationMethods.has(response.request().method()) &&
      resource.test(response.url()),
    { timeout: 30_000 },
  );

  await locator.click();
  const response = await responsePromise;
  expect(
    response.ok(),
    `${response.request().method()} ${response.url()} завершился со статусом ${response.status()}`,
  ).toBe(true);
  return response;
}
