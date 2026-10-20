import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  // The target is a shared public environment that resets its data periodically.
  // Run serially until test isolation has been demonstrated (see README).
  workers: 1,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,

  timeout: 30_000,
  expect: { timeout: 10_000 },

  // On CI the github reporter adds failure, flaky and summary annotations to the run. It prints
  // no test output, so `list` stays for the log (including cleanup-warning annotation lines).
  reporter: isCI ? [['list'], ['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: process.env.BASE_URL ?? 'https://automationintesting.online',
    actionTimeout: 10_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      // API specs use only the `request` fixture, so no browser is launched.
      name: 'api',
      testDir: './tests/api',
    },
    {
      name: 'chromium',
      testDir: './tests/ui',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Offline unit tests: injected fakes only, no fixtures and no HTTP (enforced by ESLint).
      name: 'unit',
      testDir: './tests/unit',
    },
  ],
});
