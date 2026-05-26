// Login flow load test.
// Exercises CSRF fetch -> POST /auth/api/v1/auth/login on a pre-registered user.
// Each VU performs login many times; register is done once in setup() and the
// resulting email is shared across all iterations (we are stressing the login
// path, not the register path).

import { sleep } from 'k6';
import { registerUser, login } from '../lib/api.js';

export const options = {
  scenarios: {
    warmup: {
      executor: 'constant-vus',
      vus: 1,
      duration: '10s',
      gracefulStop: '5s',
      tags: { stage: 'warmup' },
    },
    ramp: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '20s', target: 5 },
      ],
      startTime: '10s',
      gracefulRampDown: '5s',
      tags: { stage: 'ramp' },
    },
    steady: {
      executor: 'constant-vus',
      vus: 10,
      duration: '30s',
      startTime: '30s',
      tags: { stage: 'steady' },
    },
  },
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'http_req_duration{name:login,stage:steady}': ['p(95)<800', 'p(99)<1500'],
    'http_req_duration{name:csrf}': ['p(95)<200'],
  },
};

export function setup() {
  const user = registerUser('login-load');
  return { email: user.email };
}

export default function (data) {
  login(data.email);
  sleep(0.5);
}
