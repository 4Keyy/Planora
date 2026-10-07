
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { redact } = require('./_report-redaction.cjs');
test('redacts verification and reset URL tokens while preserving diagnostics', () => {
  for (const name of ['token', 'resetToken', 'accessToken']) {
    const input = 'page.goto http://127.0.0.1/auth/reset-password?' + name + '=secret%2Bvalue&source=email timeout';
    const output = redact(input);
    assert(!output.includes('secret')); assert(output.includes('&source=email timeout'));
  }
});
test('redacts secret JSON fields', () => {
  const output = redact('{"accessToken":"secret-a","refreshToken":"secret-r","password":"secret-p","confirmPassword":"secret-c","csrfToken":"secret-s","error":"Forbidden"}');
  assert(!output.includes('secret-')); assert(output.includes('Forbidden'));
});
test('redacts JWT and bearer credentials', () => {
  const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJmaXh0dXJlIn0', 'Zml4dHVyZQ'].join('.');
  assert(!redact('Authorization: Bearer opaque-auth-value').includes('opaque-auth-value'));
  assert(!redact('received ' + jwt + ' at gateway').includes(jwt));
});
test('redacts the shared disposable password in action errors', () => {
  assert(!redact("locator.fill('E2e!Passw0rd123') timed out").includes('E2e!Passw0rd123'));
});
test('keeps ordinary pass/fail counts and non-secret URLs', () => {
  const input = '16 passed (4.2m) GET /health 200 http://127.0.0.1/tasks?page=1';
  assert.equal(redact(input), input);
});

test('redacts opaque action tokens and rotated passwords in JSON errors', () => {
  for (const key of ['token', 'verificationToken', 'resetToken', 'newPassword']) {
    assert(!redact(JSON.stringify({ [key]: 'opaque-fixture-value' })).includes('opaque-fixture-value'));
  }
});
