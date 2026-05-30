import { defineConfig, devices } from '@playwright/test';

// T2.6 — split the test suite into two projects:
//   - `api`: existing request-context tests under e2e/*.api.spec.ts. No browser, no UI.
//   - `ui` : browser-rendered tests under e2e/ui/*.ui.spec.ts. Requires the Next.js
//            frontend to be reachable at E2E_FRONTEND_URL; specs gracefully skip
//            (test.skip) when it is not, so the existing API-only CI matrix keeps
//            passing while UI coverage rolls out one flow at a time.

const apiBaseURL = process.env.E2E_API_URL ?? 'http://127.0.0.1:5132';
const frontendBaseURL = process.env.E2E_FRONTEND_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [
        ['github'],
        ['list'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
      ]
    : [
        ['list'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
      ],
  use: {
    baseURL: apiBaseURL,
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  outputDir: 'test-results/playwright',
  projects: [
    {
      name: 'api',
      testMatch: /.*\.api\.spec\.ts/,
      use: {
        baseURL: apiBaseURL,
      },
    },
    {
      name: 'ui',
      testMatch: /.*\.ui\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: frontendBaseURL,
        // Browser tests do not need the JSON Accept header — leave it default.
        extraHTTPHeaders: {},
      },
    },
  ],
});
