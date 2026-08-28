import { mkdirSync } from 'node:fs';
import { test as setup } from '@playwright/test';
import { env, requireCredentials } from './helpers/env';
import { LoginPage } from './pages/LoginPage';

setup('authenticate', async ({ page }) => {
  requireCredentials();
  mkdirSync('.auth', { recursive: true });

  await new LoginPage(page).login(env.email, env.password);
  await page.context().storageState({ path: '.auth/user.json' });
});
