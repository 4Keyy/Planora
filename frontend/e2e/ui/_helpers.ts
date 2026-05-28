import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';

// Shared helpers for browser-rendered UI specs (T2.6).
//
// Design goals:
//   * Reuse the existing API path for setup (register → verify-email) instead of
//     driving the registration UI for every spec; UI specs focus on the flow they
//     actually want to validate.
//   * Gracefully skip when the frontend is not reachable so the spec can land
//     today without forcing every CI matrix entry to spin up Next.js.
//   * Email verification reads the token from the docker compose Auth-API logs,
//     identical to the existing API spec.

export const API_BASE = process.env.E2E_API_URL ?? 'http://127.0.0.1:5132';
export const FRONTEND_BASE = process.env.E2E_FRONTEND_URL ?? 'http://127.0.0.1:3000';
export const AUTH_LOG_CONTAINER = process.env.E2E_AUTH_LOG_CONTAINER ?? 'planora-auth-api';
export const VERIFY_EMAIL_FROM_LOGS = process.env.E2E_VERIFY_EMAIL_FROM_LOGS !== 'false';
export const UI_PASSWORD = 'E2e!Passw0rd123';

export type UiUser = {
  email: string;
  userId: string;
  firstName: string;
  lastName: string;
};

/**
 * Probe the frontend URL once at suite start. If it does not respond inside
 * the timeout the whole UI suite is skipped — useful when running locally
 * without a running Next.js server.
 */
export async function requireFrontendReachable() {
  try {
    const ctx = await request.newContext();
    const response = await ctx.get(FRONTEND_BASE, { timeout: 5_000 });
    await ctx.dispose();
    if (response.status() >= 500) {
      test.skip(true, `Frontend at ${FRONTEND_BASE} returned ${response.status()}`);
    }
  } catch (err) {
    test.skip(true, `Frontend at ${FRONTEND_BASE} unreachable: ${(err as Error).message}`);
  }
}

/**
 * Registers a fresh user via the API gateway and (in CI/docker mode) confirms
 * the email by scraping the Auth-API container logs. Returns the credentials
 * the UI spec then uses for the actual browser-driven login.
 */
export async function registerVerifiedUser(label: string): Promise<UiUser> {
  const ctx = await request.newContext({ baseURL: API_BASE });
  try {
    const csrf = await fetchCsrfToken(ctx);
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const email = `e2e-ui-${label}-${runId}@example.test`;
    const firstName = `E2E ${label}`;
    const lastName = 'User';

    const response = await ctx.post('/auth/api/v1/auth/register', {
      headers: { 'X-CSRF-Token': csrf },
      data: { email, password: UI_PASSWORD, confirmPassword: UI_PASSWORD, firstName, lastName },
    });
    expect(response.ok(), `register ${email}`).toBeTruthy();
    const body = await response.json();
    const userId: string = body.userId ?? body.UserId;

    if (VERIFY_EMAIL_FROM_LOGS) {
      const token = await waitForVerificationToken(email);
      const verify = await ctx.get(`/auth/api/v1/users/verify-email?token=${encodeURIComponent(token)}`);
      expect(verify.ok(), `verify ${email}`).toBeTruthy();
    }

    return { email, userId, firstName, lastName };
  } finally {
    await ctx.dispose();
  }
}

async function fetchCsrfToken(ctx: APIRequestContext): Promise<string> {
  const response = await ctx.get('/auth/api/v1/auth/csrf-token');
  expect(response.ok(), 'fetch CSRF token').toBeTruthy();
  const body = await response.json();
  return body.token ?? body.Token;
}

async function waitForVerificationToken(email: string): Promise<string> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const logs = getAuthLogs();
    const token = extractVerificationToken(logs, email);
    if (token) return token;
    await delay(2_000);
  }
  throw new Error(`Verification token for ${email} not found in ${AUTH_LOG_CONTAINER} logs.`);
}

/**
 * Triggers a password-reset email via the public Auth endpoint, then scrapes
 * the Auth-API container logs for the resulting reset link. Returns the
 * token portion of the link, ready to paste into the reset UI.
 *
 * Distinct from `waitForVerificationToken` because reset emails carry a
 * different Subject (`Reset your Planora password`) and arrive after the
 * verification email; matching by Subject avoids returning the older
 * verification token by mistake.
 */
export async function requestPasswordResetAndCaptureToken(email: string): Promise<string> {
  const ctx = await request.newContext({ baseURL: API_BASE });
  try {
    const csrf = await fetchCsrfToken(ctx);
    const response = await ctx.post('/auth/api/v1/auth/request-password-reset', {
      headers: { 'X-CSRF-Token': csrf },
      data: { email },
    });
    expect(response.ok(), `request password reset for ${email}`).toBeTruthy();
  } finally {
    await ctx.dispose();
  }

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const logs = getAuthLogs();
    const token = extractResetToken(logs, email);
    if (token) return token;
    await delay(2_000);
  }
  throw new Error(`Reset token for ${email} not found in ${AUTH_LOG_CONTAINER} logs.`);
}

function getAuthLogs(): string {
  try {
    return execFileSync('docker', ['logs', '--tail', '500', AUTH_LOG_CONTAINER], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return '';
  }
}

function extractVerificationToken(logs: string, email: string): string | undefined {
  // The Auth EmailService logs the verification link as:
  //   "Sending email verification link to <email>: <url>?token=<token>"
  const re = new RegExp(`${escapeRegExp(email)}[^\n]*token=([A-Za-z0-9_\\-\\.]+)`);
  const match = logs.match(re);
  return match?.[1];
}

function extractResetToken(logs: string, email: string): string | undefined {
  // EmailService.LogDevelopmentEmail logs:
  //   [EMAIL:LOG] Subject="Reset your Planora password", To=<email>, Link=<url>
  // Subject is the disambiguator vs the verification email which also contains token=.
  // Match the whole line that mentions both "Reset" and the email, then extract token=.
  const lines = logs.split('\n').reverse();
  for (const line of lines) {
    if (!line.includes(email)) continue;
    if (!/Reset/i.test(line)) continue;
    const tokenMatch = line.match(/token=([A-Za-z0-9_\-.]+)/);
    if (tokenMatch?.[1]) return tokenMatch[1];
  }
  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Drive the login form. Leaves the page at whatever route the application
 * navigates to (typically `/tasks` on success). Callers can then assert on
 * post-login state.
 */
export async function submitLoginForm(page: Page, email: string, password: string) {
  await page.goto('/auth/login');
  // Fields are accessible by their visible label text.
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
}
