import { expect, type Page } from '@playwright/test';
import { env } from './env';
import { PostComposerPage } from '../pages/PostComposerPage';
import { PostPage } from '../pages/PostPage';

export async function createPost(
  page: Page,
  title: string,
  body: string,
  destination = 'Моя лента',
): Promise<string> {
  await page.goto('/feed');
  const composer = new PostComposerPage(page);
  await composer.open();
  await composer.selectDestination(destination);
  await composer.fill(title, body);
  await composer.publishNow();

  const heading = page.getByRole('heading', { name: title, exact: true });
  await expect(heading).toBeVisible({ timeout: 20_000 });
  const card = heading.locator('xpath=ancestor::*[.//a[contains(@href,"/post/")]][1]');
  const href = await card.locator('a[href*="/post/"]').first().getAttribute('href');
  expect(href).toBeTruthy();
  return new URL(href!, env.baseURL).toString();
}

export async function deletePostIfPresent(page: Page, postUrl?: string): Promise<void> {
  if (!postUrl) return;
  await page.goto(postUrl);
  const actions = page.getByRole('button', { name: 'Действия', exact: true });
  if (await actions.isVisible()) await new PostPage(page).deleteThroughUi();
}
