import { expect, request, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { HubConnectionBuilder, HttpTransportType, LogLevel, type HubConnection } from '@microsoft/signalr';

import { retryRateLimited } from './_rate-limit';
import { API_BASE, registerVerifiedUser, UI_PASSWORD, type UiUser } from './ui/_helpers';

type JsonObject = Record<string, unknown>;
type Session = UiUser & {
  context: APIRequestContext;
  accessToken: string;
  csrfToken: string;
  rateLimitWaits: number;
};
type Capture = {
  hub: HubConnection;
  notifications: JsonObject[];
  feedChanges: JsonObject[];
};
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
const TODOS = '/todos/api/v1/todos';
const COMMENTS = '/collaboration/api/v1/comments';

// SMTP fixtures exercise the real Auth -> Todo -> Collaboration/Realtime contracts.
// Authentication remains in memory; neither request traces nor storageState are saved.
test('All friends freezes its audience, refreshes explicitly and revokes live access and content', async () => {
  test.setTimeout(300_000);
  const sessions: Session[] = [];
  const captures: Capture[] = [];
  const created: string[] = [];
  let owner: Session | undefined;

  try {
    owner = await fixture('frozen-a');
    sessions.push(owner);
    const early = await fixture('frozen-b');
    sessions.push(early);
    const late = await fixture('frozen-c');
    sessions.push(late);
    const stranger = await fixture('frozen-d');
    sessions.push(stranger);
    const author = owner;
    const title = `E2E frozen audience ${Date.now()}`;

    await befriend(author, early);
    const original = object(await json(author, 'post', TODOS, {
      title, description: 'Disposable frozen audience content', priority: 2,
      isPublic: true, sharedWithUserIds: [], requiredWorkers: null,
    }, 201));
    const id = string(original.id, 'created task id');
    created.push(id);
    const child = object(await json(author, 'post', `${TODOS}/${id}/subtasks`, {
      title: 'E2E inherited audience child', priority: 2,
    }, 201));
    const childId = string(child.id, 'created subtask id');
    await visible(early, author, id, childId, title);

    await befriend(author, late);
    // By-id is the first regression assertion: the former dynamic All friends
    // implementation grants C access even if its list cache has not caught up yet.
    await denied(late, author, id, childId, 'C joined after the snapshot', true);
    await denied(stranger, author, id, childId, 'D is not a friend', false);
    await snapshot(author, id, [early.userId]);
    await snapshot(author, childId, [early.userId]);

    await json(author, 'put', `${TODOS}/${id}`, {
      title, isPublic: true, sharedWithUserIds: [], requiredWorkers: null,
    });
    await snapshot(author, id, [early.userId]);
    await snapshot(author, childId, [early.userId]);
    await forbidden(late, 'get', `${TODOS}/${id}`, 'public autosave [] preserves the snapshot');

    const copy = object(await json(author, 'post', `${TODOS}/${id}/duplicate`, undefined, 201));
    const copyId = string(copy.id, 'duplicate id');
    created.push(copyId);
    expect(copyId, 'duplicate is a new task').not.toBe(id);
    await snapshot(author, copyId, [early.userId, late.userId]);
    expect(audience(object(await json(late, 'get', `${TODOS}/${copyId}`)))).toEqual([]);
    expect(array(await json(author, 'get', `${TODOS}/${copyId}/subtasks`))).toEqual([]);
    await forbidden(late, 'get', `${TODOS}/${id}`, 'duplicating does not refresh the original');

    await refresh(author, id, [early.userId, late.userId]);
    await snapshot(author, childId, [early.userId, late.userId]);
    await visible(late, author, id, childId, title);
    expect(audience(object(await json(late, 'post', `${TODOS}/${id}/join`)))).toEqual([]);
    const comment = object(await json(late, 'post', `${COMMENTS}/${id}`, {
      content: 'E2E admitted after an explicit audience refresh',
    }, 201));
    expect(string(comment.content, 'created comment content')).toBe('E2E admitted after an explicit audience refresh');
    await json(late, 'get', `${COMMENTS}/${id}`);
    const contributed = object(await json(late, 'post', `${TODOS}/${id}/subtasks`, {
      title: 'E2E refreshed collaborator child', priority: 2,
    }, 201));
    const contributedId = string(contributed.id, 'collaborator subtask id');
    expect(audience(contributed), 'collaborator-created public child redacts snapshot IDs').toEqual([]);
    await snapshot(author, contributedId, [early.userId, late.userId]);

    const earlyLive = await capture(early);
    captures.push(earlyLive);
    const lateLive = await capture(late);
    captures.push(lateLive);
    // Warm both read paths before removing B to expose stale friend-id caches.
    await visible(early, author, id, childId, title);
    await json(author, 'delete', `/auth/api/v1/friendships/${early.userId}`, undefined, 204);
    await denied(early, author, id, childId, 'removed B loses access immediately', false, true);
    await forbidden(early, 'get', `${TODOS}/${copyId}`, 'removed B cannot read the duplicate');

    // The open B socket stays authenticated. C's actual content delivery is the
    // positive control; thin invalidation may reach B but must carry no title/body.
    await json(author, 'put', `${TODOS}/${id}`, { status: 'Done' });
    await expect.poll(() => lateLive.notifications.some((item) => completed(item, id)), {
      message: 'current snapshot friend C receives the completion content over SignalR',
      timeout: 30_000,
    }).toBe(true);
    const delivered = lateLive.notifications.find((item) => completed(item, id));
    expect(string(delivered?.message, 'completion message')).toContain(title);
    await expect.poll(async () => (await notifications(late)).some((item) => completed(item, id)), {
      message: 'C completion is durably persisted', timeout: 15_000,
    }).toBe(true);
    expect((await notifications(early)).filter((item) => completed(item, id)),
      'former friend B has no persisted completion content').toEqual([]);
    expect(earlyLive.notifications.filter((item) => completed(item, id)),
      'former friend B receives no completion content over its retained socket').toEqual([]);
    await expect.poll(() => lateLive.feedChanges.some((item) =>
      item.action === 'task.completed' && sameId(item.taskId, id)), {
      message: 'C receives the real completion invalidation as a positive control', timeout: 15_000,
    }).toBe(true);
    for (const signal of [...earlyLive.feedChanges, ...lateLive.feedChanges].filter((item) => sameId(item.taskId, id))) {
      expect(Object.keys(signal).sort(), 'feed invalidation contains only routing IDs, action and timestamp')
        .toEqual(['action', 'actorId', 'taskId', 'timestamp']);
    }
    await json(author, 'put', `${TODOS}/${id}`, { status: 'Todo' });

    // Re-add only after the real FriendshipRemoved consumer has pruned every
    // stored snapshot; otherwise re-friending races the asynchronous cleanup.
    await expect.poll(async () => {
      const roots = await Promise.all([id, childId, contributedId, copyId].map((taskId) =>
        json(author, 'get', `${TODOS}/${taskId}`).then(object)));
      return roots.every((task) => !audience(task).includes(normalize(early.userId)));
    }, { message: 'FriendshipRemoved consumer removes B from parent, child and duplicate', timeout: 45_000, intervals: [500, 1_000, 2_000] }).toBe(true);
    await befriend(author, early);
    await denied(early, author, id, childId, 're-adding B does not restore its old snapshot', true);
    await forbidden(early, 'get', `${TODOS}/${copyId}`, 're-added B cannot read the frozen duplicate');
    await visible(late, author, id, childId, title);

    await refresh(author, id, [early.userId, late.userId]);
    await snapshot(author, childId, [early.userId, late.userId]);
    await snapshot(author, contributedId, [early.userId, late.userId]);
    await visible(early, author, id, childId, title);
    await visible(late, author, id, childId, title);
    await denied(stranger, author, id, childId, 'D stays outside every refreshed audience', false);
    // Check B again after subsequent events, not only at C's first delivery.
    expect(earlyLive.notifications.filter((item) => completed(item, id))).toEqual([]);
    expect((await notifications(early)).filter((item) => completed(item, id))).toEqual([]);
  } finally {
    // Stop sockets before deleting fixture tasks so teardown cannot create false
    // positive content assertions or retain authenticated connections after failure.
    await Promise.all(captures.map(({ hub }) => hub.stop().catch(() => undefined)));
    if (owner) {
      for (const id of created.reverse()) {
        await send(owner, 'delete', `${TODOS}/${id}`).catch(() => undefined);
      }
    }
    await Promise.all(sessions.map(({ context }) => context.dispose()));
  }
});

async function fixture(label: string): Promise<Session> {
  let user: UiUser;
  try {
    user = await registerVerifiedUser(label);
  } catch {
    // Verification URLs include single-use tokens; do not retain the original
    // request exception in the Playwright report when setup infrastructure fails.
    throw new Error(`SMTP registration/verification fixture failed for ${label}`);
  }
  const context = await request.newContext({ baseURL: API_BASE, extraHTTPHeaders: { Accept: 'application/json' } });
  try {
    const csrfResponse = await retryRateLimited(() => context.get('/auth/api/v1/auth/csrf-token'));
    expect(csrfResponse.status(), `${label} fetches CSRF`).toBe(200);
    const csrfToken = string(object(await csrfResponse.json()).token, 'CSRF token');
    const login = await retryRateLimited(() => context.post('/auth/api/v1/auth/login', {
      headers: { 'X-CSRF-Token': csrfToken }, data: { email: user.email, password: UI_PASSWORD },
    }));
    expect(login.status(), `${label} logs in`).toBe(200);
    const body = object(await login.json());
    return { ...user, context, csrfToken, accessToken: string(body.accessToken, 'access token'), rateLimitWaits: 0 };
  } catch {
    await context.dispose();
    throw new Error(`In-memory login fixture failed for ${label}`);
  }
}

async function befriend(owner: Session, friend: Session) {
  const sent = await send(owner, 'post', '/auth/api/v1/friendships/requests', { friendId: friend.userId });
  expect(sent.status(), 'friend request is created').toBe(201);
  const incoming = array(await json(friend, 'get', '/auth/api/v1/friendships/requests?incoming=true'));
  const pending = incoming.find((item) => sameId(item.userId, owner.userId));
  const friendshipId = string(pending?.friendshipId, 'incoming friendship id');
  await json(friend, 'post', `/auth/api/v1/friendships/requests/${friendshipId}/accept`);
}

async function refresh(owner: Session, id: string, expected: string[]) {
  await json(owner, 'put', `${TODOS}/${id}`, { isPublic: false });
  const privateTask = object(await json(owner, 'get', `${TODOS}/${id}`));
  expect(privateTask.isPublic).toBe(false);
  expect(audience(privateTask)).toEqual([]);
  await json(owner, 'put', `${TODOS}/${id}`, { isPublic: true, sharedWithUserIds: [] });
  await snapshot(owner, id, expected);
}

async function snapshot(owner: Session, id: string, expected: string[]) {
  const dto = object(await json(owner, 'get', `${TODOS}/${id}`));
  expect(dto.isPublic, 'owner sees All friends mode').toBe(true);
  expect(dto.requiredWorkers, 'All friends has no finite worker limit').toBeNull();
  expect(audience(dto), 'owner sees exactly the frozen snapshot').toEqual(expected.map(normalize).sort());
}

async function visible(viewer: Session, owner: Session, id: string, childId: string, title: string) {
  const detail = object(await json(viewer, 'get', `${TODOS}/${id}`));
  expect(detail.title).toBe(title);
  expect(audience(detail), 'non-owner detail redacts snapshot IDs').toEqual([]);
  const child = object(await json(viewer, 'get', `${TODOS}/${childId}`));
  expect(audience(child), 'non-owner child detail redacts snapshot IDs').toEqual([]);
  const children = array(await json(viewer, 'get', `${TODOS}/${id}/subtasks`));
  expect(children.some((item) => sameId(item.id, childId)), 'the inherited child is accessible').toBe(true);
  for (const item of children) expect(audience(item)).toEqual([]);
  for (const path of listPaths(owner, true)) {
    const found = paged(await json(viewer, 'get', path)).find((item) => sameId(item.id, id));
    expect(Boolean(found), `authorized task appears in ${path}`).toBe(true);
    if (found) expect(audience(found), 'non-owner list redacts snapshot IDs').toEqual([]);
  }
  await json(viewer, 'get', `${COMMENTS}/${id}`);
}

async function denied(viewer: Session, owner: Session, id: string, childId: string, label: string, isFriend: boolean, immediate = false) {
  const waitsBeforeRead = viewer.rateLimitWaits;
  await forbidden(viewer, 'get', `${TODOS}/${id}`, `${label}: by-id`);
  for (const path of listPaths(owner, isFriend)) {
    const items = paged(await json(viewer, 'get', path));
    expect(items.some((item) => sameId(item.id, id) || sameId(item.id, childId)), `${label}: list ${path}`).toBe(false);
  }
  if (immediate) {
    expect(viewer.rateLimitWaits, 'revocation reads cannot pass after waiting out a stale cache').toBe(waitsBeforeRead);
  }
  if (!isFriend) {
    const rejected = await json(viewer, 'get', `${TODOS}/public?pageNumber=1&pageSize=50&friendId=${owner.userId}`, undefined, 403);
    if (!isObject(rejected)) throw new Error('Expected a friendship rejection envelope');
    expect(rejected.success ?? rejected.Success, `${label}: single-friend feed rejects the former/non-friend`).toBe(false);
    const error = rejected.error ?? rejected.Error;
    if (!isObject(error)) throw new Error('Expected a friendship rejection error');
    expect(error.code ?? error.Code).toBe('NOT_FRIENDS');
  }
  await forbidden(viewer, 'get', `${TODOS}/${childId}`, `${label}: child by-id`);
  await forbidden(viewer, 'get', `${TODOS}/${id}/subtasks`, `${label}: subtask list`);
  await forbidden(viewer, 'post', `${TODOS}/${id}/join`, `${label}: joining`);
  await forbidden(viewer, 'post', `${TODOS}/${childId}/join`, `${label}: child joining`);
  await forbidden(viewer, 'post', `${TODOS}/${id}/subtasks`, `${label}: child creation`, { title: 'Denied fixture child', priority: 2 });
  await forbidden(viewer, 'patch', `${TODOS}/${id}/viewer-preferences`, `${label}: viewer preference`, { hiddenByViewer: true });
  await forbidden(viewer, 'put', `${TODOS}/${id}`, `${label}: personal completion`, { status: 'Done' });
  await forbidden(viewer, 'get', `${COMMENTS}/${id}`, `${label}: comments via Todo gRPC`);
  await forbidden(viewer, 'post', `${COMMENTS}/${id}`, `${label}: comment creation via Todo gRPC`, { content: 'Denied fixture comment' });
}

function listPaths(owner: Session, isFriend: boolean) {
  const paths = [
    `${TODOS}?pageNumber=1&pageSize=50&includeSubtasks=true`,
    `${TODOS}/public?pageNumber=1&pageSize=50`,
  ];
  if (isFriend) paths.push(`${TODOS}/public?pageNumber=1&pageSize=50&friendId=${owner.userId}`);
  return paths;
}

async function forbidden(session: Session, method: Method, path: string, action: string, data?: JsonObject) {
  const response = await send(session, method, path, data);
  expect(response.status(), action).toBe(403);
}

async function json(session: Session, method: Method, path: string, data?: JsonObject, status = 200): Promise<unknown> {
  const response = await send(session, method, path, data);
  expect(response.status(), `${method.toUpperCase()} ${path}`).toBe(status);
  return status === 204 ? undefined : response.json();
}

async function send(session: Session, method: Method, path: string, data?: JsonObject): Promise<APIResponse> {
  try {
    return await retryRateLimited(async () => {
      const response = await session.context[method](path, {
        headers: { Authorization: `Bearer ${session.accessToken}`, 'X-CSRF-Token': session.csrfToken },
        ...(data ? { data } : {}),
      });
      if (response.status() === 429) session.rateLimitWaits++;
      return response;
    });
  } catch {
    throw new Error(`${method.toUpperCase()} ${path} could not complete`);
  }
}

async function capture(session: Session): Promise<Capture> {
  const notifications: JsonObject[] = [];
  const feedChanges: JsonObject[] = [];
  const hub = new HubConnectionBuilder().withUrl(`${API_BASE}/realtime/hubs/notifications`, {
    transport: HttpTransportType.WebSockets, skipNegotiation: true,
    accessTokenFactory: () => session.accessToken,
  }).configureLogging(LogLevel.None).build();
  hub.on('ReceiveNotification', (item: unknown) => { if (isObject(item)) notifications.push(item); });
  hub.on('TaskFeedChanged', (item: unknown) => { if (isObject(item)) feedChanges.push(item); });
  try {
    await hub.start();
  } catch {
    await hub.stop().catch(() => undefined);
    throw new Error('Authenticated fixture SignalR connection could not start');
  }
  return { hub, notifications, feedChanges };
}

async function notifications(session: Session) {
  return array(await json(session, 'get', '/realtime/api/v1/notifications?take=100'));
}

function completed(item: JsonObject, id: string) {
  return item.type === 'task.completed' && sameId(item.taskId, id);
}

function audience(dto: JsonObject): string[] {
  const ids = dto.sharedWithUserIds;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    throw new Error('Task response did not contain a valid audience array');
  }
  return (ids as string[]).map(normalize).sort();
}

function object(body: unknown): JsonObject {
  const value = unwrap(body);
  if (!isObject(value)) throw new Error('Expected an object API response');
  return value;
}

function array(body: unknown): JsonObject[] {
  const value = unwrap(body);
  if (!Array.isArray(value) || value.some((item) => !isObject(item))) {
    throw new Error('Expected an array API response');
  }
  return value as JsonObject[];
}

function paged(body: unknown): JsonObject[] {
  const value = object(body);
  if (!Array.isArray(value.items ?? value.Items)) {
    throw new Error('Expected paged items; response keys: ' + Object.keys(value).join(','));
  }
  return array(value.items ?? value.Items);
}

function unwrap(body: unknown): unknown {
  if (!isObject(body)) return body;
  if (body.isSuccess === false || body.IsSuccess === false || body.success === false || body.Success === false) {
    throw new Error('API returned a failed result envelope');
  }
  if ('value' in body) return body.value;
  if ('Value' in body) return body.Value;
  if ('data' in body) return body.data;
  return body;
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Missing ${field}`);
  return value;
}

function normalize(value: string) { return value.toLowerCase(); }
function sameId(value: unknown, expected: string) { return typeof value === 'string' && normalize(value) === normalize(expected); }
