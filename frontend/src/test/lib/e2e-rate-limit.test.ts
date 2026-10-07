import { describe, expect, it, vi } from 'vitest';
import { retryRateLimited } from '../../../e2e/_rate-limit';
const response = (status: number, retryAfter?: string) => ({
  status: () => status, headers: () => retryAfter === undefined ? {} : { 'retry-after': retryAfter },
});
describe('disposable E2E fixtures respect Auth rate limiting', () => {
  it.each([200, 400, 401, 403, 503])('does not retry status %i', async (status) => {
    const expected = response(status); const send = vi.fn().mockResolvedValue(expected); const sleep = vi.fn();
    expect(await retryRateLimited(send, sleep)).toBe(expected);
    expect(send).toHaveBeenCalledTimes(1); expect(sleep).not.toHaveBeenCalled();
  });
  it('honors Retry-After seconds and retries only once', async () => {
    const expected = response(200); const send = vi.fn().mockResolvedValueOnce(response(429, '60')).mockResolvedValue(expected); const sleep = vi.fn().mockResolvedValue(undefined);
    expect(await retryRateLimited(send, sleep)).toBe(expected);
    expect(sleep).toHaveBeenCalledWith(60_100); expect(send).toHaveBeenCalledTimes(2);
  });
  it('uses the server fixed-window duration when the header is absent', async () => {
    const send = vi.fn().mockResolvedValueOnce(response(429)).mockResolvedValue(response(200)); const sleep = vi.fn().mockResolvedValue(undefined);
    await retryRateLimited(send, sleep); expect(sleep).toHaveBeenCalledWith(60_100);
  });
  it('accepts HTTP-date Retry-After', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T18:00:00Z'));
    try { const send = vi.fn().mockResolvedValueOnce(response(429, 'Wed, 07 Oct 2026 18:00:20 GMT')).mockResolvedValue(response(200)); const sleep = vi.fn().mockResolvedValue(undefined);
      await retryRateLimited(send, sleep); expect(sleep).toHaveBeenCalledWith(20_100);
    } finally { vi.useRealTimers(); }
  });
  it('fails after a second 429 instead of hiding persistent rejection', async () => {
    const send = vi.fn().mockResolvedValue(response(429, '0')); const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(retryRateLimited(send, sleep)).rejects.toThrow('still rate limited'); expect(send).toHaveBeenCalledTimes(2);
  });
  it.each(['61', '-1', 'not-a-date'])('rejects an invalid or excessive retry budget %s', async (header) => {
    const send = vi.fn().mockResolvedValue(response(429, header)); const sleep = vi.fn();
    await expect(retryRateLimited(send, sleep)).rejects.toThrow('Retry-After'); expect(sleep).not.toHaveBeenCalled();
  });
});
