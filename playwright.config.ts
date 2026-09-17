import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  use: {
    baseURL: 'http://127.0.0.1:4321',
    trace: 'retain-on-failure',
    // The app animates card changes; the suite tests behaviour, not motion, and
    // a blind walk of a hundred steps must not wait 200ms for each one to settle.
    // The one test about motion switches it back on for itself.
    contextOptions: { reducedMotion: 'reduce' },
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
