import { test as base, expect } from '@playwright/test';
import { startNetworkRecorder } from '../helpers/network-recorder';
import { env, requireCredentials } from '../helpers/env';
import { LoginPage } from '../pages/LoginPage';

export const test = base.extend<{ networkRecorder: void }>({
  page: async ({ page }, use) => {
    requireCredentials();
    await new LoginPage(page).login(env.email, env.password);
    await use(page);
  },
  networkRecorder: [
    async ({ page }, use, testInfo) => {
      const stop = startNetworkRecorder(page, testInfo);
      await use();
      await stop();
    },
    { auto: true },
  ],
});

export { expect };
