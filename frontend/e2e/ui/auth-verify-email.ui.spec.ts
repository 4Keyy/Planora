import { expect, test } from '@playwright/test';
import {
  registerUserAndCaptureVerificationToken,
  requireFrontendReachable,
  VERIFY_EMAIL_FROM_LOGS,
} from './_helpers';

/**
 * T2.6 — browser-rendered E2E for the verify-email flow.
 *
 * Two scenarios:
 *   1. **Link click**: open `/auth/verify-email?token=<real-token>`. The
 *      page auto-submits via its useEffect and the success state replaces
 *      the form.
 *   2. **Paste token**: open `/auth/verify-email` with no query string,
 *      paste an invalid token, submit, see the form remain visible (the
 *      error path is asserted via the form staying mounted — toast
 *      messages are out of scope here).
 *
 * The verification token is captured from Auth-API container logs by
 * `registerUserAndCaptureVerificationToken` (does NOT pre-verify, so the
 * token is still consumable).
 */
test.describe('auth verify-email (browser)', () => {
  test.beforeAll(async () => {
    await requireFrontendReachable();
  });

  test('clicking the verification link from the query string auto-verifies and shows the success state', async ({ page }) => {
    test.skip(
      !VERIFY_EMAIL_FROM_LOGS,
      'E2E_VERIFY_EMAIL_FROM_LOGS=false disables docker-log scraping for the verification token',
    );

    const { verificationToken } = await registerUserAndCaptureVerificationToken('verify');

    await page.goto(`/auth/verify-email?token=${encodeURIComponent(verificationToken)}`);

    await expect(page.getByText(/email verified successfully/i))
      .toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /go to dashboard/i }))
      .toBeVisible();
  });

  test('an invalid pasted token keeps the form on screen for retry', async ({ page }) => {
    await page.goto('/auth/verify-email');

    await page.getByPlaceholder('Paste token').fill('not-a-real-token');
    await page.getByRole('button', { name: /verify email/i }).click();

    // Verification failed; the form must still be visible so the user can
    // paste a different token.
    await expect(page.getByPlaceholder('Paste token')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/email verified successfully/i)).toHaveCount(0);
  });
});
