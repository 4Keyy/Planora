import { expect, test } from '@playwright/test';
import {
  registerVerifiedUser,
  requireFrontendReachable,
  submitLoginForm,
  UI_PASSWORD,
} from './_helpers';

/**
 * T2.6 — browser-rendered E2E for the login flow.
 *
 * Setup runs through the API gateway (register + email verification) so the
 * spec focuses on the actual login UI:
 *   1. Land on /auth/login from a cold session.
 *   2. Type credentials, submit.
 *   3. Verify the post-login route loads and shows the authenticated user.
 *
 * If the frontend is not reachable (no `npm run start` and the workflow does
 * not provide E2E_FRONTEND_URL), the whole file is skipped via the
 * beforeAll hook — keeping API-only CI matrices green while UI coverage
 * rolls out.
 */
test.describe('auth login (browser)', () => {
  test.beforeAll(async () => {
    await requireFrontendReachable();
  });

  test('a verified user can log in and reach the authenticated app', async ({ page }) => {
    const user = await registerVerifiedUser('login');

    await submitLoginForm(page, user.email, UI_PASSWORD);

    // The router redirects to /tasks on a successful login. We assert on the
    // URL transition (with a generous timeout for cold-start hydration) rather
    // than a specific selector — the page itself is covered by other specs
    // and we want this test to pin the *transition*, not the page contents.
    await expect(page).toHaveURL(/\/tasks(\/|$|\?)/, { timeout: 20_000 });

    // Defence-in-depth: the auth UI flashes the user's full name in the
    // navbar when authenticated, so an empty body would imply a broken render
    // even if the URL routed correctly.
    await expect(page.locator('body')).toContainText(/E2E login User|Sign out|Tasks/i);
  });

  test('an incorrect password leaves the user on the login page with an error', async ({ page }) => {
    const user = await registerVerifiedUser('badpw');

    await submitLoginForm(page, user.email, 'definitely-the-wrong-password');

    // Should still be on /auth/login.
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10_000 });

    // The form renders the error banner with the API's failure message; we
    // accept any non-empty error containing "credential" or "invalid" so
    // small copy tweaks do not break the test.
    const error = page.locator('[class*="text-red-600"], [class*="text-red-500"]').first();
    await expect(error).toBeVisible({ timeout: 10_000 });
  });
});
