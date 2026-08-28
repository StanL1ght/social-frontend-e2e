import { test as base, expect } from '@playwright/test';
import { startNetworkRecorder } from '../helpers/network-recorder';

export const test = base.extend<{ networkRecorder: void }>({
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
