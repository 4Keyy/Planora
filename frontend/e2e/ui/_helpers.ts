import { expect, request, type APIRequestContext, type Page } from '@playwright/test';

import { waitForEmailToken } from '../_email';
import { retryRateLimited } from '../_rate-limit';

// Shared helpers for browser-rendered UI specs (T2.6).
//
// Design goals:
//   * Reuse the existing API path for setup (register → verify-email) instead of
//     driving the registration UI for every spec; UI specs focus on the flow they
//     actually want to validate.
//   * Fail clearly when the required frontend cannot be reached.
//   * Read delivered fixture emails from the disposable SMTP sink.

export const API_BASE = process.env.E2E_API_URL ?? 'http://127.0.0.1:5132';
export const FRONTEND_BASE = process.env.E2E_FRONTEND_URL ?? 'http://127.0.0.1:3000';
export const UI_PASSWORD = 'E2e!Passw0rd123';

export type UiUser = {
  email: string;
  userId: string;
  firstName: string;
  lastName: string;
};

/**
 * Fail visibly when the browser target is missing; a skipped suite proves nothing.
 */
export async function requireFrontendReachable() {
  const ctx = await request.newContext();
  try {
    const response = await ctx.get(FRONTEND_BASE, { timeout: 5_000 });
    expect(response.ok(), 'browser target status ' + response.status()).toBeTruthy();
  } finally { await ctx.dispose(); }
}

/**
 * Registers a fresh user via the API gateway and (in CI/docker mode) confirms
 * the email by scraping the Auth-API test SMTP sink. Returns the credentials
 * the UI spec then uses for the actual browser-driven login.
 */
export async function registerVerifiedUser(label: string): Promise<UiUser> {
  const ctx = await request.newContext({ baseURL: API_BASE });
  try {
    const csrf = await fetchCsrfToken(ctx);
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const email = `e2e-ui-${label}-${runId}@example.test`;
    const firstName = `Test ${label}`;
    const lastName = 'User';

    const response = await retryRateLimited(() => ctx.post('/auth/api/v1/auth/register', {
      headers: { 'X-CSRF-Token': csrf },
      data: { email, password: UI_PASSWORD, confirmPassword: UI_PASSWORD, firstName, lastName },
    }));
    expect(response.ok(), `register ${email}`).toBeTruthy();
    const body = await response.json();
    const userId: string = body.userId ?? body.UserId;

    const token = await waitForEmailToken(email, 'verification');
    const verify = await retryRateLimited(() => ctx.get(`/auth/api/v1/users/verify-email?token=${encodeURIComponent(token)}`));
    expect(verify.ok(), 'verify fixture email status ' + verify.status()).toBeTruthy();

    return { email, userId, firstName, lastName };
  } finally {
    await ctx.dispose();
  }
}

async function fetchCsrfToken(ctx: APIRequestContext): Promise<string> {
  const response = await retryRateLimited(() => ctx.get('/auth/api/v1/auth/csrf-token'));
  expect(response.ok(), 'fetch CSRF token status ' + response.status()).toBeTruthy();
  const body = await response.json();
  return body.token ?? body.Token;
}

/**
 * Registers a fresh user via the API gateway and captures the verification
 * token from Auth-API test SMTP sink **without** consuming it. Useful for
 * UI specs that want to drive the verify-email page itself.
 */
export async function registerUserAndCaptureVerificationToken(
  label: string,
): Promise<{ user: UiUser; verificationToken: string }> {
  const ctx = await request.newContext({ baseURL: API_BASE });
  try {
    const csrf = await fetchCsrfToken(ctx);
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const email = `e2e-ui-${label}-${runId}@example.test`;
    const firstName = `Test ${label}`;
    const lastName = 'User';

    const response = await retryRateLimited(() => ctx.post('/auth/api/v1/auth/register', {
      headers: { 'X-CSRF-Token': csrf },
      data: { email, password: UI_PASSWORD, confirmPassword: UI_PASSWORD, firstName, lastName },
    }));
    expect(response.ok(), `register ${email}`).toBeTruthy();
    const body = await response.json();
    const userId: string = body.userId ?? body.UserId;

    const verificationToken = await waitForEmailToken(email, 'verification');
    return {
      user: { email, userId, firstName, lastName },
      verificationToken,
    };
  } finally {
    await ctx.dispose();
  }
}

/**
 * Triggers a password-reset email via the public Auth endpoint, then scrapes
 * the Auth-API test SMTP sink for the resulting reset link. Returns the
 * token portion of the link, used only for the disposable reset action URL.
 *
 * Reset emails carry a
 * different Subject (`Reset your Planora password`) and arrive after the
 * verification email; matching by Subject avoids returning the older
 * verification token by mistake.
 */
export async function requestPasswordResetAndCaptureToken(email: string): Promise<string> {
  const ctx = await request.newContext({ baseURL: API_BASE });
  try {
    const csrf = await fetchCsrfToken(ctx);
    const response = await retryRateLimited(() => ctx.post('/auth/api/v1/auth/request-password-reset', {
      headers: { 'X-CSRF-Token': csrf },
      data: { email },
    }));
    expect(response.ok(), `request password reset for ${email}`).toBeTruthy();
  } finally {
    await ctx.dispose();
  }

  return waitForEmailToken(email, 'reset');
}

/**
 * Drive the login form. Leaves the page at whatever route the application
 * navigates to (typically `/dashboard` on success). Callers can then assert on
 * post-login state.
 */
export async function submitLoginForm(page: Page, email: string, password: string) {
  await page.goto('/auth/login');
  // Fields are accessible by their visible label text.
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await submitAuthForm(page, '/auth/api/v1/auth/login', /sign in/i);
}

/** Observe the real browser response before retrying a rate-limited submit. */
export async function submitAuthForm(page: Page, endpoint: string, button: RegExp) {
  return retryRateLimited(async () => {
    const completed = page.waitForResponse((response) =>
      new URL(response.url()).pathname === endpoint && response.request().method() === 'POST');
    await page.getByRole('button', { name: button }).click();
    return completed;
  });
}
