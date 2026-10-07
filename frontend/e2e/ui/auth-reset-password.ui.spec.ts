import { expect, test } from '@playwright/test';
import {
  registerVerifiedUser,
  requestPasswordResetAndCaptureToken,
  requireFrontendReachable,
  submitLoginForm,
  UI_PASSWORD,
} from './_helpers';

/**
 * T2.6 — browser-rendered E2E for the reset-password flow.
 *
 * Drives the end-to-end "forgot → new password → login with new" loop:
 *   1. Register + verify a user through the gateway and delivered SMTP mail.
 *   2. Request a password-reset email and read its link from Mailpit.
 *   3. Open /auth/reset-password?token=..., let the page consume the URL
 *      token without displaying it, type the new password twice, submit,
 *      and see the success state.
 *   4. Sign in with the new password to prove the rotation took effect.
 *
 * Requires the disposable SMTP stack; production logs never expose these tokens.
 */
test.describe('auth reset-password (browser)', () => {
  test.beforeAll(async () => {
    await requireFrontendReachable();
  });

  test('a user can complete the forgot → reset → login loop end-to-end', async ({ page }) => {
    const user = await registerVerifiedUser('reset');
    const resetToken = await requestPasswordResetAndCaptureToken(user.email);

    // Visit the reset page with the token in the query string; the page reads
    // ?token / ?resetToken on mount without showing a token field.
    await page.goto(`/auth/reset-password?token=${encodeURIComponent(resetToken)}`);

    const newPassword = `Rotated-${UI_PASSWORD}`;
    // Fill both password fields with the same new value.
    const passwordFields = page.locator('input[type="password"]');
    await passwordFields.nth(0).fill(newPassword);
    await passwordFields.nth(1).fill(newPassword);

    await page.getByRole('button', { name: /save new password/i }).click();

    // The form is replaced by the success state with a "Sign in" CTA.
    await expect(page.getByRole('heading', { name: 'Password changed' }))
      .toBeVisible({ timeout: 10_000 });

    // Prove the rotation actually rotated: log in with the *new* password.
    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10_000 });

    await submitLoginForm(page, user.email, newPassword);
    await expect(page).toHaveURL(/\/dashboard(\/|$|\?)/, { timeout: 20_000 });
  });
});
