// Todo list read load test.
// Hot read path: GET /todos/api/v1/todos?pageNumber=1&pageSize=20 with a real
// auth context. Exercises the Todo API + gRPC hop to Auth (friendship resolution)
// + gRPC hop to Category (metadata enrichment) + the per-viewer hidden filter.
// p95 is the budget consumers see when scrolling the todo list.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { registerUser, login, authHeaders, apiBaseUrl } from '../lib/api.js';

export const options = {
  scenarios: {
    warmup: {
      executor: 'constant-vus',
      vus: 1,
      duration: '10s',
      gracefulStop: '5s',
      tags: { stage: 'warmup' },
    },
    steady: {
      executor: 'constant-vus',
      vus: 10,
      duration: '30s',
      startTime: '10s',
      tags: { stage: 'steady' },
    },
  },
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'http_req_duration{name:todo_list,stage:steady}': ['p(95)<400', 'p(99)<800'],
  },
};

export function setup() {
  const user = registerUser('todo-reader');
  const session = login(user.email);
  return session;
}

export default function (session) {
  const res = http.get(
    `${apiBaseUrl()}/todos/api/v1/todos?pageNumber=1&pageSize=20`,
    {
      headers: authHeaders(session),
      jar: session.jar,
      tags: { name: 'todo_list' },
    },
  );
  check(res, { 'todo list 200': (r) => r.status === 200 });
  sleep(0.5);
}
