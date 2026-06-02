import { expect, test } from '@playwright/test';
import { requireFrontendReachable, UI_PASSWORD } from './_helpers';

/**
 * T2.6 — browser-rendered E2E for the register flow.
 *
 * Drives the registration form end-to-end against a real Next.js render:
 *   1. Land on /auth/register from a cold session.
 *   2. Fill name, email (unique per run), password + confirm.
 *   3. Submit, assert post-submit redirect into the authenticated app.
 *
 * Validation behaviour (mismatched confirm, weak password) is covered by
 * unit tests against the Zod resolver — this spec focuses on the *happy
 * path* of the actual browser submission so a future regression on form
 * wiring (e.g. the submit button gets bound to a different handler) is
 * caught immediately.
 */
test.describe('auth register (browser)', () => {
  test.beforeAll(async () => {
    await requireFrontendReachable();
  });

  test('a new visitor can create an account through the form', async ({ page }) => {
    await page.goto('/auth/register');

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `e2e-ui-register-${runId}@example.test`;

    await page.getByPlaceholder('Jane').fill('Jane');
    await page.getByPlaceholder('Doe').fill('Roe');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('Create a strong password').fill(UI_PASSWORD);
    await page.getByPlaceholder('••••••••').fill(UI_PASSWORD);

    await page.getByRole('button', { name: /create account/i }).click();

    // Successful registration routes to /dashboard (per `router.push` in the
    // register page). Allow either /dashboard or /tasks here so a future
    // post-register copy change does not break the assertion.
    await expect(page).toHaveURL(/\/(dashboard|tasks)(\/|$|\?)/, { timeout: 20_000 });
  });

  test('mismatched confirm password keeps the visitor on the register page', async ({ page }) => {
    await page.goto('/auth/register');

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `e2e-ui-register-mismatch-${runId}@example.test`;

    await page.getByPlaceholder('Jane').fill('Jane');
    await page.getByPlaceholder('Doe').fill('Roe');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('Create a strong password').fill(UI_PASSWORD);
    await page.getByPlaceholder('••••••••').fill('different-password');

    await page.getByRole('button', { name: /create account/i }).click();

    // The Zod resolver short-circuits the submit on a confirm mismatch — the
    // page must NOT route away. Allow a brief settle window before asserting.
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/auth\/register/);
  });
});
