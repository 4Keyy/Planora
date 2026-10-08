import { expect, test } from '@playwright/test';
import { requireFrontendReachable, submitAuthForm, UI_PASSWORD } from './_helpers';

/**
 * T2.6 — browser-rendered E2E for the register flow.
 *
 * Drives the registration form end-to-end against a real Next.js render:
 *   1. Land on /auth/register from a cold session.
 *   2. Fill name, email (unique per run), password + confirm.
 *   3. Submit, assert post-submit redirect into the authenticated app.
 *
 * The file also checks that a confirm-password mismatch keeps the visitor
 * on the form and displays the client-side validation message.
 */
test.describe('auth register (browser)', () => {
  test.beforeAll(async () => {
    await requireFrontendReachable();
  });

  test('a new visitor can create an account through the form', async ({ page }) => {
    await page.goto('/auth/register');

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `e2e-ui-register-${runId}@example.test`;

    await page.getByLabel('First name', { exact: true }).fill('Jane');
    await page.getByLabel('Last name', { exact: true }).fill('Roe');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(UI_PASSWORD);
    await page.getByLabel('Confirm password', { exact: true }).fill(UI_PASSWORD);

    await submitAuthForm(page, '/auth/api/v1/auth/register', /create account/i);

    // Registration enters the authenticated app; its current landing route is /dashboard.
    await expect(page).toHaveURL(/\/(dashboard|tasks)(\/|$|\?)/, { timeout: 20_000 });
  });

  test('mismatched confirm password keeps the visitor on the register page', async ({ page }) => {
    await page.goto('/auth/register');

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `e2e-ui-register-mismatch-${runId}@example.test`;

    await page.getByLabel('First name', { exact: true }).fill('Jane');
    await page.getByLabel('Last name', { exact: true }).fill('Roe');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(UI_PASSWORD);
    await page.getByLabel('Confirm password', { exact: true }).fill('different-password');

    await page.getByRole('button', { name: /create account/i }).click();

    // A confirm mismatch must show validation feedback and keep the form on screen.
    await expect(page.getByText("The two passwords don't match.", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/register/);
  });
});
