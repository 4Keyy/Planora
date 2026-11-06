import { expect, test, type APIResponse } from '@playwright/test';
import { API_BASE, registerVerifiedUser, submitLoginForm, UI_PASSWORD } from './_helpers';

test('restores a cold session after the real gateway Retry-After window', async ({ page }) => {
  const user = await registerVerifiedUser('coldrestore');
  await submitLoginForm(page, user.email, UI_PASSWORD);
  await expect(page).toHaveURL(/dashboard/);

  // At most one 60/min window can roll over during this bounded burst.
  // Two windows plus one request exhaust the real bucket without prior-test traffic.
  const authPermitsPerMinute = 60;
  const requestBudget = 2 * authPermitsPerMinute + 1;
  const burstDeadline = Date.now() + 45_000;
  let limited: APIResponse | undefined;
  for (let sent = 0; sent < requestBudget && !limited && Date.now() < burstDeadline; sent += 16) {
    const responses = await Promise.all(Array.from({ length: Math.min(16, requestBudget - sent) }, () =>
      page.request.get(`${API_BASE}/auth/api/v1/auth/csrf-token`, { timeout: 5_000 })));
    limited = responses.find(response => response.status() === 429);
    for (const response of responses) {
      expect([200, 429], 'the burst receives only CSRF success or a real rate limit').toContain(response.status());
    }
  }
  expect(limited, 'the disposable gateway auth bucket is limited').toBeDefined();
  const retryAfter = Number(limited!.headers()['retry-after']);
  expect(Number.isFinite(retryAfter), 'the real 429 supplies Retry-After seconds').toBe(true);
  expect(retryAfter).toBeGreaterThanOrEqual(0);
  expect(retryAfter).toBeLessThanOrEqual(60);
  await page.goto('/tasks');
  // AuthGuard stays pending until a real refresh succeeds; no mocked responses or saved JWT.
  await expect(page.getByRole('button', { name: /open create task panel/i }))
    .toBeVisible({ timeout: 70_000 });
  await expect(page).toHaveURL(/\/tasks$/);
});
