require('dotenv').config();
const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const base = process.env.BASE_URL || 'https://dev-social-frontend.sddt.efko.ru';
  await page.goto(base + '/feed', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/keycloak|\/feed/, { timeout: 30000 });
  if (page.url().includes('keycloak')) {
    await page.locator('input[type="text"],input[type="email"]').first().fill(process.env.E2E_EMAIL);
    await page.locator('input[type="password"]').fill(process.env.E2E_PASSWORD);
    await page.getByRole('button', { name: /войти/i }).click();
    await page.waitForURL(/\/feed(?:\?|$)/, { timeout: 30000 });
  }
  console.log('LOGIN', page.url());
  await page.getByText('Моя страница', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Публикации', exact: true }).waitFor({ timeout: 20000 });
  console.log('PROFILE', page.url());
  console.log('MAIN', (await page.locator('body').innerText()).slice(0, 1800).replace(/\n+/g, ' | '));
  for (const name of ['Участники', 'Реакции и комментарии', 'Группы', 'Опросы', 'Файлы']) {
    const button = page.getByRole('button', { name, exact: true }).first();
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click();
    await page.waitForTimeout(450);
    console.log('TAB', name, page.url(), (await page.locator('body').innerText()).slice(-1500).replace(/\n+/g, ' | '));
  }
  await browser.close();
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
