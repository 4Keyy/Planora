import { defineConfig, devices } from '@playwright/test';

// Both projects require their services; missing prerequisites fail visibly.

const apiBaseURL = process.env.E2E_API_URL ?? 'http://127.0.0.1:5132';
const frontendBaseURL = process.env.E2E_FRONTEND_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './e2e',
  // Setup can respect both one registration and one login Retry-After window.
  timeout: 180_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['list']]
    : [
        ['list'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
      ],
  use: {
    baseURL: apiBaseURL,
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
    // Auth fixture responses and action URLs carry secrets; keep them out of artifacts.
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
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
