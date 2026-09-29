import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL ?? 'https://dev-social-frontend.sddt.efko.ru';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  outputDir: 'test-results',
  use: {
    baseURL,
    // Login/setup contexts must not depend on a session file they create.
    storageState: { cookies: [], origins: [] },
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: {
        storageState: { cookies: [], origins: [] },
      },
    },
    {
      name: 'unauthenticated-chromium',
      testMatch: /auth\/login-ui\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: { cookies: [], origins: [] },
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: 'desktop-chromium',
      use: {
        storageState: '.auth/user.json',
        ...devices['Desktop Chrome'],
        viewport: { width: 1366, height: 900 },
      },
      dependencies: ['setup'],
      testIgnore: [/mobile\/.*\.spec\.ts/, /auth\/login-ui\.spec\.ts/, /multi-user\/.*\.spec\.ts/],
    },
    {
      name: 'multi-user-chromium',
      testMatch: /multi-user\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: { cookies: [], origins: [] },
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: 'mobile-chromium',
      use: {
        storageState: '.auth/user.json',
        ...devices['Pixel 7'],
      },
      dependencies: ['setup'],
      testMatch: /mobile\/.*\.spec\.ts/,
    },
    {
      name: 'mobile-webkit',
      use: {
        storageState: '.auth/user.json',
        ...devices['iPhone 13'],
      },
      dependencies: ['setup'],
      testMatch: /mobile\/.*\.spec\.ts/,
    },
  ],
});
