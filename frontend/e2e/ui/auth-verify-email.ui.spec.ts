import { expect, test } from '@playwright/test';
import { registerUserAndCaptureVerificationToken, requireFrontendReachable } from './_helpers';

test.describe('auth verify-email (browser)', () => {
  test.beforeAll(async () => { await requireFrontendReachable(); });

  test('the delivered email link verifies the account and offers sign-in', async ({ page }) => {
    const { verificationToken } = await registerUserAndCaptureVerificationToken('verify');
    await page.goto('/auth/verify-email?token=' + encodeURIComponent(verificationToken));
    await expect(page.getByRole('heading', { name: 'Email verified', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  });

  test('an invalid link shows the failure state and sign-in recovery', async ({ page }) => {
    await page.goto('/auth/verify-email?token=not-a-real-token');
    await expect(page.getByRole('heading', { name: "This link didn't work", exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Email verified', exact: true })).toHaveCount(0);
  });
});
