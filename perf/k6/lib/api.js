// Shared k6 helpers: CSRF bootstrap, register, login. Mirrors the contract
// exercised by frontend/e2e/auth-todos-sharing-hidden.api.spec.ts so the perf
// signal and the e2e signal stay comparable.

import http from 'k6/http';
import { check, fail } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const DEFAULT_API_BASE = 'http://127.0.0.1:5132';

export const PASSWORD = 'Perf!Passw0rd123';

export function apiBaseUrl() {
  return __ENV.API_BASE_URL || DEFAULT_API_BASE;
}

export function fetchCsrf(jar) {
  const res = http.get(`${apiBaseUrl()}/auth/api/v1/auth/csrf-token`, { jar, tags: { name: 'csrf' } });
  check(res, { 'csrf 200': (r) => r.status === 200 }) || fail(`CSRF fetch failed: ${res.status}`);
  // Header value matches the readable XSRF-TOKEN cookie set in the response.
  const token = jar.cookiesForURL(apiBaseUrl())['XSRF-TOKEN'];
  if (!token) fail('CSRF cookie missing from response jar');
  return token[0];
}

export function registerUser(role) {
  const jar = http.cookieJar();
  const csrf = fetchCsrf(jar);
  const email = `perf-${role}-${uuidv4()}@planora.test`;
  const res = http.post(
    `${apiBaseUrl()}/auth/api/v1/auth/register`,
    JSON.stringify({
      email,
      password: PASSWORD,
      firstName: role,
      lastName: 'Perf',
      username: `perf_${role}_${uuidv4().slice(0, 8)}`,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
      },
      jar,
      tags: { name: 'register' },
    },
  );
  check(res, { 'register 2xx': (r) => r.status >= 200 && r.status < 300 })
    || fail(`Register failed for ${email}: ${res.status} ${res.body}`);
  return { jar, csrf, email };
}

export function login(email) {
  const jar = http.cookieJar();
  const csrf = fetchCsrf(jar);
  const res = http.post(
    `${apiBaseUrl()}/auth/api/v1/auth/login`,
    JSON.stringify({ email, password: PASSWORD }),
    {
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
      },
      jar,
      tags: { name: 'login' },
    },
  );
  check(res, { 'login 2xx': (r) => r.status >= 200 && r.status < 300 })
    || fail(`Login failed for ${email}: ${res.status} ${res.body}`);
  // The access token lives in the response body; the refresh token is set
  // as an httpOnly cookie by the backend, which k6's cookieJar already holds.
  let body;
  try {
    body = JSON.parse(res.body);
  } catch {
    fail(`Login response is not JSON: ${res.body}`);
  }
  const accessToken =
    body?.accessToken ?? body?.value?.accessToken ?? body?.data?.accessToken;
  if (!accessToken) fail(`Login response missing accessToken: ${res.body}`);
  return { jar, csrf, accessToken, email };
}

export function authHeaders(session) {
  return {
    'Authorization': `Bearer ${session.accessToken}`,
    'X-CSRF-Token': session.csrf,
  };
}
