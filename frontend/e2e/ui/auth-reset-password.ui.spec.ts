import { expect, test } from '@playwright/test';
import {
  registerVerifiedUser,
  requestPasswordResetAndCaptureToken,
  requireFrontendReachable,
  submitLoginForm,
  UI_PASSWORD,
  VERIFY_EMAIL_FROM_LOGS,
} from './_helpers';

/**
 * T2.6 — browser-rendered E2E for the reset-password flow.
 *
 * Drives the end-to-end "forgot → new password → login with new" loop:
 *   1. Register + verify a user (API path, fast).
 *   2. Trigger the password-reset email (API path, scrape token from logs).
 *   3. Open /auth/reset-password?token=..., land on the form with the token
 *      auto-populated from the query string, type the new password twice,
 *      submit, see the success state.
 *   4. Sign in with the new password to prove the rotation took effect.
 *
 * Skips automatically if `E2E_VERIFY_EMAIL_FROM_LOGS=false` because the
 * token scrape depends on the docker compose log channel.
 */
test.describe('auth reset-password (browser)', () => {
  test.beforeAll(async () => {
    await requireFrontendReachable();
  });

  test('a user can complete the forgot → reset → login loop end-to-end', async ({ page }) => {
    test.skip(
      !VERIFY_EMAIL_FROM_LOGS,
      'E2E_VERIFY_EMAIL_FROM_LOGS=false disables docker-log scraping for the reset token',
    );

    const user = await registerVerifiedUser('reset');
    const resetToken = await requestPasswordResetAndCaptureToken(user.email);

    // Visit the reset page with the token in the query string; the page reads
    // ?token / ?resetToken on mount and pre-fills the field.
    await page.goto(`/auth/reset-password?token=${encodeURIComponent(resetToken)}`);

    const newPassword = `Rotated-${UI_PASSWORD}`;
    // Two password fields share the same shape (no htmlFor on the visible
    // labels, no name attribute) — disambiguate by DOM order: first
    // password input is "New password", second is "Confirm password".
    const passwordFields = page.locator('input[type="password"]');
    await passwordFields.nth(0).fill(newPassword);
    await passwordFields.nth(1).fill(newPassword);

    await page.getByRole('button', { name: /reset password/i }).click();

    // The form is replaced by the success state with a "Sign in" CTA.
    await expect(page.getByText(/password has been reset/i))
      .toBeVisible({ timeout: 10_000 });

    // Prove the rotation actually rotated: log in with the *new* password.
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10_000 });

    await submitLoginForm(page, user.email, newPassword);
    await expect(page).toHaveURL(/\/tasks(\/|$|\?)/, { timeout: 20_000 });
  });
});
