import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;
const isGitHubActions = !!process.env.GITHUB_ACTIONS;

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
  // On GitHub Actions the job-summary reporter also writes the run's job summary.
  // Locally this is just list + html.
  reporter: [
    ['list'],
    ...(isCI ? [['github'] as const] : []),
    ...(isGitHubActions ? [['./src/reporting/job-summary-reporter.ts'] as const] : []),
    ['html', { open: 'never' }],
  ],

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
