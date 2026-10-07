import { expect, test } from '@playwright/test';
import {
  registerVerifiedUser,
  requireFrontendReachable,
  submitLoginForm,
  UI_PASSWORD,
} from './_helpers';

/**
 * T2.6 — browser-rendered E2E for the tasks page surface.
 *
 * After a fresh login reaches /dashboard, navigate to /tasks and check
 * that the create panel opens, accepts a title, and closes again. This
 * smoke test does not submit a task; motion-geometry.ui.spec.ts covers
 * task creation and the geometry of the rendered task controls.
 */
test.describe('tasks page (browser, post-login)', () => {
  test.beforeAll(async () => {
    await requireFrontendReachable();
  });

  test('a logged-in user lands on /tasks and can open the create-task panel', async ({ page }) => {
    const user = await registerVerifiedUser('tasks');
    await submitLoginForm(page, user.email, UI_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard(\/|$|\?)/, { timeout: 20_000 });

    await page.goto('/tasks');

    // The persistent "+" affordance is exposed with an aria-label that swaps
    // between "Open create task panel" and "Close create task panel" — that
    // toggle is what we drive.
    const openPanel = page.getByRole('button', { name: /open create task panel/i });
    await expect(openPanel).toBeVisible({ timeout: 10_000 });
    await openPanel.click();

    // The open panel exposes an editable task title.
    const titleField = page.getByPlaceholder('What needs to be done?');
    await expect(titleField).toBeVisible();
    await titleField.fill('E2E smoke task');
    await expect(titleField).toHaveValue('E2E smoke task');

    // Closing the panel via the same affordance returns it to the collapsed
    // state — keeps the spec idempotent and proves the toggle round-trips.
    const closePanel = page.getByRole('button', { name: /close create task panel/i });
    await closePanel.click();
    await expect(openPanel).toBeVisible({ timeout: 5_000 });
  });
});
