import { expect, test } from '@playwright/test';
import { registerVerifiedUser, requireFrontendReachable } from './_helpers';

/**
 * T2.6 — browser-rendered E2E for the forgot-password flow.
 *
 * The Auth API returns the same 200 for "email exists" and "email unknown"
 * (anti-enumeration), so this spec validates the *user-visible behaviour*:
 *   1. Submit a valid (registered + verified) email — "Check your inbox"
 *      and the "Sign in" link appear, replacing the form.
 *   2. Submit an unregistered email — the form must still complete cleanly
 *      (no error banner), preserving the anti-enumeration contract.
 *
 * Reset-token consumption is covered by `auth-reset-password.ui.spec.ts`
 * (separate spec; it reads the delivered reset link from the disposable
 * Mailpit SMTP sink through the shared email helper).
 */
test.describe('auth forgot-password (browser)', () => {
  test.beforeAll(async () => {
    await requireFrontendReachable();
  });

  test('a registered user sees the success state after requesting a reset link', async ({ page }) => {
    const user = await registerVerifiedUser('forgot');

    await page.goto('/auth/forgot-password');
    await page.getByPlaceholder('you@example.com').fill(user.email);
    await page.getByRole('button', { name: /send the link/i }).click();

    // The form is replaced by "Check your inbox" and the sign-in link.
    await expect(page.getByRole('heading', { name: 'Check your inbox' }))
      .toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: 'Sign in', exact: true }))
      .toBeVisible();
  });

  test('an unregistered email still resolves to the success state (anti-enumeration)', async ({ page }) => {
    await page.goto('/auth/forgot-password');
    const ghostEmail = `e2e-ui-ghost-${Date.now()}@example.test`;
    await page.getByPlaceholder('you@example.com').fill(ghostEmail);
    await page.getByRole('button', { name: /send the link/i }).click();

    // Anti-enumeration: the UI cannot expose whether the email existed.
    // The same success banner appears for unknown emails.
    await expect(page.getByRole('heading', { name: 'Check your inbox' }))
      .toBeVisible({ timeout: 10_000 });
  });
});
