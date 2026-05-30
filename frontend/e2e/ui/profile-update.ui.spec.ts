import { expect, test } from '@playwright/test';
import {
  registerVerifiedUser,
  requireFrontendReachable,
  submitLoginForm,
  UI_PASSWORD,
} from './_helpers';

/**
 * T2.6 — browser-rendered E2E for the profile-update flow.
 *
 * Drives the rename round-trip:
 *   1. Register + verify a user (API path).
 *   2. Log in through the UI.
 *   3. Navigate to /profile.
 *   4. Edit the first-name field, click "Save profile", expect the
 *      navigation chrome or page heading to reflect the new name.
 */
test.describe('profile update (browser)', () => {
  test.beforeAll(async () => {
    await requireFrontendReachable();
  });

  test('a logged-in user can rename themselves and the change persists', async ({ page }) => {
    const user = await registerVerifiedUser('profile');
    await submitLoginForm(page, user.email, UI_PASSWORD);
    await expect(page).toHaveURL(/\/tasks(\/|$|\?)/, { timeout: 20_000 });

    await page.goto('/profile');
    await expect(page).toHaveURL(/\/profile/, { timeout: 10_000 });

    // FieldGroup wraps the input inside its <label> so getByLabel resolves
    // via the accessible name pathway.
    const firstName = page.getByLabel(/first name/i);
    await expect(firstName).toBeVisible({ timeout: 10_000 });

    const newFirst = 'Renamed';
    await firstName.fill(newFirst);

    await page.getByRole('button', { name: /save profile/i }).click();

    // Reload the page and confirm the new first name persisted.
    await page.reload();
    await expect(page.getByLabel(/first name/i)).toHaveValue(newFirst, { timeout: 10_000 });
  });
});
