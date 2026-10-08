import { expect, test } from '@playwright/test';
import { API_BASE, registerVerifiedUser, submitLoginForm, UI_PASSWORD } from './_helpers';

test('restores a cold session after the real gateway Retry-After window', async ({ page }) => {
  const user = await registerVerifiedUser('coldrestore');
  await submitLoginForm(page, user.email, UI_PASSWORD);
  await expect(page).toHaveURL(/dashboard/);

  // Exhaust only the disposable gateway's 30/min auth bucket; keep service limits enabled.
  let limited = false;
  for (let i = 0; i < 32; i++) {
    const response = await page.request.get(`${API_BASE}/auth/api/v1/auth/csrf-token`);
    if (response.status() === 429) { limited = true; break; }
  }
  expect(limited, 'the disposable gateway auth bucket is limited').toBe(true);
  await page.goto('/tasks');
  // AuthGuard stays pending until a real refresh succeeds; no mocked responses or saved JWT.
  await expect(page.getByRole('button', { name: /open create task panel/i }))
    .toBeVisible({ timeout: 70_000 });
  await expect(page).toHaveURL(/\/tasks$/);
});
