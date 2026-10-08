import { deflateSync } from 'node:zlib';
import { expect, request, test } from '@playwright/test';
import { retryRateLimited } from './_rate-limit';
import { API_BASE, registerVerifiedUser, UI_PASSWORD } from './ui/_helpers';

// Small, valid PNG fixture built from pixel bytes; no image-decoder dependency in setup.
function png(width: number, height: number): Buffer {
  const chunk = (kind: string, bytes: Buffer) => {
    const type = Buffer.from(kind); const payload = Buffer.concat([type, bytes]);
    let crc = 0xffffffff;
    for (const byte of payload) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, payload, checksum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 4 + 1) + 1 + x * 4;
    rows[offset] = 16; rows[offset + 1] = 128; rows[offset + 2] = 192; rows[offset + 3] = 255;
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

function string(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Missing expected fixture response field');
  return value;
}

test('native avatar upload emits three independently decodable WebP variants through the gateway', async ({ browser }) => {
  const user = await registerVerifiedUser('native-avatar');
  const context = await request.newContext({ baseURL: API_BASE });
  const page = await browser.newPage();
  try {
    const csrfResponse = await retryRateLimited(() => context.get('/auth/api/v1/auth/csrf-token'));
    expect(csrfResponse.ok()).toBe(true);
    const csrfBody = await csrfResponse.json();
    const csrf = string(csrfBody.token ?? csrfBody.Token);
    const login = await retryRateLimited(() => context.post('/auth/api/v1/auth/login', {
      headers: { 'X-CSRF-Token': csrf }, data: { email: user.email, password: UI_PASSWORD },
    }));
    expect(login.ok(), 'login for disposable avatar fixture').toBe(true);
    const authenticated = await login.json();
    const headers = { Authorization: 'Bearer ' + string(authenticated.accessToken ?? authenticated.AccessToken), 'X-CSRF-Token': csrf };
    const upload = await retryRateLimited(() => context.post('/auth/api/v1/users/me/avatar', {
      headers, multipart: { file: { name: 'native-fixture.png', mimeType: 'image/png', buffer: png(128, 96) } },
    }));
    expect(upload.status(), 'native Linux decoder and encoder successfully process a valid upload').toBe(200);
    const profile = await upload.json();
    const pathname = new URL(string(profile.profilePictureUrl), API_BASE).pathname;
    const expectedUser = user.userId.replaceAll('-', '').toLowerCase();
    expect(pathname).toMatch(new RegExp(`/avatars/${expectedUser}/[a-f0-9]{16}/(?:64|128|512)\\.webp$`));
    // Only use the returned path on our own gateway; never send fixture credentials to another origin.
    const gatewayPath = pathname;
    for (const size of [64, 128, 512]) {
      const response = await retryRateLimited(() => context.get(gatewayPath.replace(/(?:64|128|512)\.webp$/, `${size}.webp`)));
      expect(response.status(), 'persisted WebP variant is served').toBe(200);
      expect(response.headers()['content-type']).toContain('image/webp');
      expect(response.headers()['x-content-type-options']).toBe('nosniff');
      expect(response.headers()['cache-control']).toContain('immutable');
      const bytes = Array.from(await response.body());
      // Chromium decoding is independent of the server's native SkiaSharp implementation.
      const dimensions = await page.evaluate(async data => {
        const decoded = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/webp' }));
        const result = { width: decoded.width, height: decoded.height }; decoded.close(); return result;
      }, bytes);
      expect(dimensions).toEqual({ width: size, height: size });
    }
    const bogus = await retryRateLimited(() => context.post('/auth/api/v1/users/me/avatar', {
      headers, multipart: { file: { name: 'spoofed.png', mimeType: 'image/png', buffer: Buffer.from('not an image') } },
    }));
    expect(bogus.status(), 'a spoofed declared MIME cannot bypass signature validation').toBe(415);
  } finally {
    await page.close(); await context.dispose();
  }
});
