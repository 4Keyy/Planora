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
 * The reachability hook fails if the frontend is missing. CI starts the full stack.
 */
test.describe('auth login (browser)', () => {
  test.beforeAll(async () => {
    await requireFrontendReachable();
  });

  test('a verified user can log in and reach the authenticated app', async ({ page }) => {
    const user = await registerVerifiedUser('login');

    await submitLoginForm(page, user.email, UI_PASSWORD);

    // The router redirects to /dashboard on a successful login. We assert on the
    // URL transition (with a generous timeout for cold-start hydration) rather
    // than a specific selector — the page itself is covered by other specs
    // and we want this test to pin the *transition*, not the page contents.
    await expect(page).toHaveURL(/\/dashboard(\/|$|\?)/, { timeout: 20_000 });

    // Authenticated navigation content must render after the URL transition.
    await expect(page.locator('body')).toContainText(/Test login User|Sign out|Tasks/i);
  });

  test('an incorrect password leaves the user on the login page with an error', async ({ page }) => {
    const user = await registerVerifiedUser('badpw');

    await submitLoginForm(page, user.email, 'definitely-the-wrong-password');

    // Should still be on /auth/login.
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10_000 });

    // The invalid-credentials response keeps an accessible alert visible.
    const error = page.locator('form').getByRole('alert');
    await expect(error).toBeVisible({ timeout: 10_000 });
  });
});
