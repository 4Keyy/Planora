import { setTimeout as delay } from 'node:timers/promises';
export type RateLimitResponse = { status(): number; headers(): Record<string, string> };

/** A fixture may wait out one real Auth window; never retry validation/auth failures. */
export async function retryRateLimited<T extends RateLimitResponse>(
  send: () => Promise<T>, sleep: (ms: number) => Promise<unknown> = delay,
): Promise<T> {
  const response = await send();
  if (response.status() !== 429) return response;
  const header = response.headers()['retry-after'] ?? '60';
  const seconds = /^\d+$/.test(header) ? Number(header) : (Date.parse(header) - Date.now()) / 1000;
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60) {
    throw new Error('Auth fixture received an invalid or excessive Retry-After');
  }
  await sleep(Math.ceil(seconds * 1000) + 100);
  const retry = await send();
  if (retry.status() === 429) throw new Error('Auth fixture is still rate limited after Retry-After');
  return retry;
}
