import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  use: {
    baseURL: 'http://127.0.0.1:4321',
    trace: 'retain-on-failure',
    // Lets the suite run against a Chromium that is already on the machine
    // (sandboxes, CI images with preinstalled browsers). Unset everywhere else,
    // so Playwright picks its own download as usual.
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:4321/',
    reuseExistingServer: !process.env.CI,
  },
});
