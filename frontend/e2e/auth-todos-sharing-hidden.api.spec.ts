import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { expect, request, test, type APIRequestContext, type APIResponse } from '@playwright/test';

const DEFAULT_API_URL = 'http://127.0.0.1:5132';
const AUTH_LOG_CONTAINER = process.env.E2E_AUTH_LOG_CONTAINER ?? 'planora-auth-api';
const VERIFY_EMAIL_FROM_LOGS = process.env.E2E_VERIFY_EMAIL_FROM_LOGS !== 'false';
const PASSWORD = 'E2e!Passw0rd123';
const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

type Session = {
  context: APIRequestContext;
  csrfToken: string;
  accessToken: string;
  userId: string;
  email: string;
};

type JsonObject = Record<string, unknown>;

test('auth, sharing, todos and hidden viewer preferences work through the API gateway', async () => {
  const owner = await registerUser('owner');
  const viewer = await registerUser('viewer');

  try {
    await verifyEmailFromAuthLogs(owner);
    await verifyEmailFromAuthLogs(viewer);

    const friendshipResponse = await owner.context.post('/auth/api/v1/friendships/requests', {
      headers: authHeaders(owner),
      data: { friendId: viewer.userId },
    });
    await expectOk(friendshipResponse, 'owner sends a friend request');

    const requestsResponse = await viewer.context.get('/auth/api/v1/friendships/requests?incoming=true', {
      headers: authHeaders(viewer),
    });
    await expectOk(requestsResponse, 'viewer loads incoming friend requests');

    const incomingRequests = unwrapArray(await requestsResponse.json());
    const requestFromOwner = incomingRequests.find((item) => sameId(item.userId, owner.userId));
    expect(requestFromOwner, 'incoming request from the owner exists').toBeTruthy();
    if (!requestFromOwner) {
      throw new Error('Incoming friend request from the owner was not found');
    }

    const acceptResponse = await viewer.context.post(
      `/auth/api/v1/friendships/requests/${requestFromOwner.friendshipId}/accept`,
      { headers: authHeaders(viewer) },
    );
    await expectOk(acceptResponse, 'viewer accepts the friend request');

    const ownerCategory = await createCategory(owner, 'E2E Owner Focus');
    const viewerCategory = await createCategory(viewer, 'E2E Viewer Hidden');
    const ownerCategoryId = requireString(ownerCategory.id, 'owner category id');
    const viewerCategoryId = requireString(viewerCategory.id, 'viewer category id');
    const todo = await createSharedTodo(owner, ownerCategoryId, viewer.userId);
    const todoId = requireString(todo.id, 'todo id');
    const todoTitle = requireString(todo.title, 'todo title');
    const todoDescription = requireString(todo.description, 'todo description');

    const viewerTodosResponse = await viewer.context.get('/todos/api/v1/todos?pageNumber=1&pageSize=50', {
      headers: authHeaders(viewer),
    });
    await expectOk(viewerTodosResponse, 'viewer loads shared todos');
    const viewerTodos = unwrapPagedItems(await viewerTodosResponse.json());
    expect(
      viewerTodos.some((item) => sameId(item.id, todoId) && item.title === todoTitle),
      'viewer sees the shared task before hiding it',
    ).toBe(true);

    const hideResponse = await viewer.context.patch(`/todos/api/v1/todos/${todoId}/viewer-preferences`, {
      headers: authHeaders(viewer),
      data: {
        hiddenByViewer: true,
        viewerCategoryId,
        updateViewerCategory: true,
      },
    });
    await expectOk(hideResponse, 'viewer hides the shared task and assigns a viewer category');

    const hiddenDetail = unwrapObject(
      await getJson(viewer.context, `/todos/api/v1/todos/${todoId}`, viewer),
    );
    expect(hiddenDetail.title).toBe('Hidden task');
    expect(hiddenDetail.hidden).toBe(true);
    expect(normalizeGuid(hiddenDetail.userId)).toBe(EMPTY_GUID);
    expect(normalizeGuid(hiddenDetail.categoryId)).toBe(normalizeGuid(viewerCategoryId));
    expect(hiddenDetail.description ?? null).toBeNull();
    expect(hiddenDetail.sharedWithUserIds ?? []).toEqual([]);

    const ownerDetail = unwrapObject(
      await getJson(owner.context, `/todos/api/v1/todos/${todoId}`, owner),
    );
    expect(ownerDetail.title).toBe(todoTitle);
    expect(ownerDetail.description).toBe(todoDescription);
    expect(normalizeGuid(ownerDetail.userId)).toBe(normalizeGuid(owner.userId));

    const revealResponse = await viewer.context.patch(`/todos/api/v1/todos/${todoId}/viewer-preferences`, {
      headers: authHeaders(viewer),
      data: {
        hiddenByViewer: false,
        updateViewerCategory: false,
      },
    });
    await expectOk(revealResponse, 'viewer reveals the shared task');

    const revealedDetail = unwrapObject(
      await getJson(viewer.context, `/todos/api/v1/todos/${todoId}`, viewer),
    );
    expect(revealedDetail.title).toBe(todoTitle);
    expect(revealedDetail.description).toBe(todoDescription);
    expect(revealedDetail.hidden).toBe(false);
  } finally {
    await Promise.all([owner.context.dispose(), viewer.context.dispose()]);
  }
});

async function newApiContext() {
  return request.newContext({
    baseURL: process.env.E2E_API_URL ?? DEFAULT_API_URL,
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
  });
}

async function registerUser(label: string): Promise<Session> {
  const context = await newApiContext();
  const csrfToken = await fetchCsrfToken(context);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const email = `e2e-${label}-${runId}@example.test`;

  const response = await context.post('/auth/api/v1/auth/register', {
    headers: {
      'X-CSRF-Token': csrfToken,
    },
    data: {
      email,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      firstName: `E2E ${label}`,
      lastName: 'User',
    },
  });
  await expectOk(response, `${label} registers`);

  const body = await response.json();
  return {
    context,
    csrfToken,
    accessToken: pick(body, 'accessToken', 'AccessToken'),
    userId: pick(body, 'userId', 'UserId'),
    email,
  };
}

async function fetchCsrfToken(context: APIRequestContext) {
  const response = await context.get('/auth/api/v1/auth/csrf-token');
  await expectOk(response, 'fetches CSRF token');

  const body = await response.json();
  return pick(body, 'token', 'Token');
}

async function verifyEmailFromAuthLogs(session: Session) {
  test.skip(
    !VERIFY_EMAIL_FROM_LOGS,
    'E2E_VERIFY_EMAIL_FROM_LOGS=false disables email verification through Docker logs',
  );

  const token = await waitForVerificationToken(session.email);
  const response = await session.context.get(
    `/auth/api/v1/users/verify-email?token=${encodeURIComponent(token)}`,
    { headers: authHeaders(session) },
  );
  await expectOk(response, `verifies ${session.email}`);
}

async function waitForVerificationToken(email: string) {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    const logs = getAuthLogs();
    const token = extractVerificationToken(logs, email);
    if (token) {
      return token;
    }

    await delay(2_000);
  }

  throw new Error(
    `Verification token for ${email} was not found in Docker logs of ${AUTH_LOG_CONTAINER}. ` +
      'Make sure the Docker stack is running and the Auth EmailService logs verification links.',
  );
}

function getAuthLogs() {
  try {
    return execFileSync('docker', ['logs', '--since', '10m', AUTH_LOG_CONTAINER], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(
      `Cannot read Docker logs from ${AUTH_LOG_CONTAINER}. ` +
        'Set E2E_AUTH_LOG_CONTAINER if the Auth API container name is different. ' +
        `Original error: ${String(error)}`,
    );
  }
}

function extractVerificationToken(logs: string, email: string) {
  const line = logs
    .split(/\r?\n/)
    .reverse()
    .find((entry) => entry.includes(`Verification email to ${email}:`));

  const match = line?.match(/[?&]token=([^\s"'<>]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function createCategory(session: Session, name: string) {
  const response = await session.context.post('/categories/api/v1/categories', {
    headers: authHeaders(session),
    data: {
      userId: null,
      name: `${name} ${Date.now()}`,
      description: 'Created by Playwright e2e',
      color: '#4F46E5',
      icon: 'folder',
      displayOrder: 0,
    },
  });
  await expectOk(response, `${session.email} creates a category`);

  return unwrapObject(await response.json());
}

async function createSharedTodo(owner: Session, categoryId: string, viewerId: string) {
  const title = `E2E shared hidden flow ${Date.now()}`;
  const description = 'Owner-only details that must be redacted while hidden.';
  const response = await owner.context.post('/todos/api/v1/todos', {
    headers: authHeaders(owner),
    data: {
      userId: null,
      title,
      description,
      categoryId,
      dueDate: null,
      expectedDate: null,
      priority: 2,
      isPublic: true,
      sharedWithUserIds: [viewerId],
    },
  });
  await expectOk(response, 'owner creates a shared todo');

  return unwrapObject(await response.json());
}

async function getJson(context: APIRequestContext, url: string, session: Session) {
  const response = await context.get(url, { headers: authHeaders(session) });
  await expectOk(response, `GET ${url}`);
  return response.json();
}

function authHeaders(session: Session) {
  return {
    Authorization: `Bearer ${session.accessToken}`,
    'X-CSRF-Token': session.csrfToken,
  };
}

async function expectOk(response: APIResponse, action: string) {
  if (!response.ok()) {
    throw new Error(`${action} failed with ${response.status()}: ${await response.text()}`);
  }
}

function unwrapPagedItems(body: unknown): JsonObject[] {
  const value = unwrap(body);
  if (Array.isArray(value)) {
    return value.filter(isJsonObject);
  }

  if (value && typeof value === 'object') {
    const objectValue = value as JsonObject;
    if (Array.isArray(objectValue.items)) {
      return objectValue.items.filter(isJsonObject);
    }
    if (Array.isArray(objectValue.Items)) {
      return objectValue.Items.filter(isJsonObject);
    }
  }

  throw new Error(`Expected a paged response with items, got: ${JSON.stringify(body)}`);
}

function unwrapArray(body: unknown): JsonObject[] {
  const value = unwrap(body);
  if (!Array.isArray(value)) {
    throw new Error(`Expected an array response, got: ${JSON.stringify(body)}`);
  }

  return value.filter(isJsonObject);
}

function unwrapObject(body: unknown): JsonObject {
  const value = unwrap(body);
  if (!isJsonObject(value)) {
    throw new Error(`Expected an object response, got: ${JSON.stringify(body)}`);
  }

  return value;
}

function unwrap(body: unknown): unknown {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const objectValue = body as Record<string, unknown>;
  if ('value' in objectValue) {
    return objectValue.value;
  }
  if ('Value' in objectValue) {
    return objectValue.Value;
  }
  if ('data' in objectValue) {
    return objectValue.data;
  }

  return body;
}

function pick<T extends string>(body: Record<string, unknown>, camelCase: T, pascalCase: Capitalize<T>) {
  const value = body[camelCase] ?? body[pascalCase];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Response is missing ${camelCase}/${pascalCase}: ${JSON.stringify(body)}`);
  }

  return value;
}

function sameId(left: unknown, right: unknown) {
  return normalizeGuid(left) === normalizeGuid(right);
}

function normalizeGuid(value: unknown) {
  return String(value ?? '').toLowerCase();
}

function isJsonObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value: unknown, name: string) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected ${name} to be a non-empty string, got: ${JSON.stringify(value)}`);
  }

  return value;
}
