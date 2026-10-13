import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { retryRateLimited } from '../_rate-limit';
import { persistJsonEvidence } from './_card-geometry';
import {
  API_BASE, FRONTEND_BASE, UI_PASSWORD, registerVerifiedUser, submitLoginForm, type UiUser,
} from './_helpers';

type Json = Record<string, unknown>;
type ApiMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

type TokenIdentity = {
  actorUserId: string;
  sub: string | null;
  nameIdentifier: string | null;
  selectedClaim: 'sub' | 'nameidentifier' | null;
  selectedUserId: string | null;
};

type RateLimitEvent = {
  path: string;
  status: number;
  retryAfterSeconds: number | null;
  epoch: number;
};

export type Actor = {
  context: BrowserContext;
  page: Page;
  user: UiUser;
  token: string;
  csrf: string;
  storage: Awaited<ReturnType<BrowserContext['storageState']>>;
  refreshIdentity?: { before: TokenIdentity; after: TokenIdentity };
  rateLimits: RateLimitEvent[];
};

export type MotionTask = {
  id: string;
  title: string;
  userId: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  description: string | null;
  dueDateStart: string | null;
  dueDate: string | null;
  expectedDate: string | null;
  actualDate: string | null;
  delay: string | number | null;
};

export type MotionFixtureKind = 'private' | 'shared' | 'viewer';

export type MotionFixtures = {
  owner: Actor;
  friend: Actor;
  pager: Actor;
  privateTask: MotionTask;
  sharedTask: MotionTask;
  viewerTask: MotionTask;
  otherTasks: MotionTask[];
  /** In server page order: six tall, six short, six medium, then the nineteenth row. */
  pagerTasks: MotionTask[];
};

const TODO_PATH = '/todos/api/v1/todos';
const RANGE_START = '2060-06-10T00:00:00.000Z';
const RANGE_END = '2060-06-20T00:00:00.000Z';
const EXPECTED = '2060-06-15T00:00:00.000Z';
const ACTUAL = '2060-06-17T00:00:00.000Z';
const DESCRIPTION = [
  'Продумать адаптивный дизайн карточки для большого экрана и телефона.',
  'Проверить перенос длинного заголовка и описание на нескольких строках.',
  'Сохранить диапазон дат и ожидаемое время завершения при раскрытии.',
  'Согласовать детали с участниками и проверить положение соседних карточек.',
].join('\n');

function object(value: unknown): Json {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Json;
  throw new Error('Expected an API object');
}

function unwrap(value: unknown): Json {
  const body = object(value);
  return object(body.value ?? body.data ?? body);
}

function items(value: unknown): Json[] {
  if (Array.isArray(value)) return value.map(object);
  const body = unwrap(value);
  const rows = body.items ?? body.Items;
  if (!Array.isArray(rows)) throw new Error('Expected a paged or bare API list');
  return rows.map(object);
}

function identifier(value: unknown): string {
  if (typeof value === 'string' && value) return value;
  throw new Error('Expected a nonempty API identifier');
}

const nullableString = (value: unknown): string | null => typeof value === 'string' ? value : null;

function tokenIdentity(token: string, actorUserId: string): TokenIdentity {
  let claims: Json;
  try {
    const encoded = token.split('.')[1];
    if (!encoded) throw new Error('Missing identity payload');
    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    claims = object(parsed);
  } catch {
    throw new Error('Cannot decode disposable fixture identity claims');
  }
  const sub = nullableString(claims.sub);
  const nameIdentifier = nullableString(claims['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier']);
  return {
    actorUserId, sub, nameIdentifier,
    selectedClaim: sub !== null ? 'sub' : nameIdentifier !== null ? 'nameidentifier' : null,
    selectedUserId: sub ?? nameIdentifier,
  };
}
function motionTask(value: unknown): MotionTask {
  const task = unwrap(value);
  return {
    id: identifier(task.id),
    title: identifier(task.title),
    userId: identifier(task.userId),
    categoryId: nullableString(task.categoryId),
    categoryName: nullableString(task.categoryName),
    categoryIcon: nullableString(task.categoryIcon),
    categoryColor: nullableString(task.categoryColor),
    description: nullableString(task.description),
    dueDateStart: nullableString(task.dueDateStart),
    dueDate: nullableString(task.dueDate),
    expectedDate: nullableString(task.expectedDate),
    actualDate: nullableString(task.actualDate),
    delay: typeof task.delay === 'number' && Number.isFinite(task.delay) ? task.delay : nullableString(task.delay),
  };
}

function safeTaskProjection(rows: Json[]): Json[] {
  return rows.map(row => ({
    id: nullableString(row.id), title: nullableString(row.title),
    hidden: typeof row.hidden === 'boolean' ? row.hidden : null,
    status: nullableString(row.status),
    isCompleted: typeof row.isCompleted === 'boolean' ? row.isCompleted : null,
    userId: nullableString(row.userId),
  }));
}
/** Every mutation reaches the real gateway with this disposable actor's own credentials. */
export async function APIchecked(actor: Actor, method: ApiMethod, path: string, data?: Json): Promise<unknown> {
  const response = await retryRateLimited(async () => {
    const result = await actor.context.request[method](API_BASE + path, {
      headers: { Authorization: 'Bearer ' + actor.token, 'X-CSRF-Token': actor.csrf }, data,
    });
    if (result.status() === 429) {
      const header = result.headers()['retry-after'] ?? '60';
      const seconds = /^\d+$/.test(header) ? Number(header) : (Date.parse(header) - Date.now()) / 1000;
      actor.rateLimits.push({
        path: new URL(path, API_BASE).pathname, status: 429,
        retryAfterSeconds: Number.isFinite(seconds) ? seconds : null, epoch: Date.now(),
      });
    }
    return result;
  });
  expect(response.ok(), `${method} ${path}: HTTP ${response.status()}`).toBeTruthy();
  return response.status() === 204 ? {} : response.json();
}

async function csrfFor(context: BrowserContext): Promise<string> {
  const response = await retryRateLimited(() => context.request.get(API_BASE + '/auth/api/v1/auth/csrf-token'));
  expect(response.ok(), 'motion fixture CSRF: HTTP ' + response.status()).toBeTruthy();
  const csrf = object(await response.json());
  return identifier(csrf.token ?? csrf.Token);
}

/** Refresh before each case; cookies and access tokens remain in memory throughout the suite. */
export async function refreshActor(actor: Actor): Promise<void> {
  const before = tokenIdentity(actor.token, actor.user.userId);
  // A measured UI context may have rotated the refresh cookie since this API context last ran.
  await actor.context.addCookies(actor.storage.cookies);
  actor.csrf = await csrfFor(actor.context);
  const response = await retryRateLimited(() => actor.context.request.post(API_BASE + '/auth/api/v1/auth/refresh', {
    headers: { 'X-CSRF-Token': actor.csrf },
    data: {},
  }));
  expect(response.ok(), 'motion fixture refresh: HTTP ' + response.status()).toBeTruthy();
  const login = object(await response.json());
  actor.token = identifier(login.accessToken ?? login.AccessToken);
  actor.storage = await actor.context.storageState();
  const after = tokenIdentity(actor.token, actor.user.userId);
  actor.refreshIdentity = { before, after };
  try {
    expect(after.selectedUserId, 'Refresh preserves the registered motion actor identity').toBe(actor.user.userId);
  } catch (error) {
    await persistJsonEvidence(test.info(), 'motion-refresh-identity-' + actor.user.userId, {
      body: JSON.stringify(actor.refreshIdentity, null, 2), contentType: 'application/json',
    });
    throw error;
  }
}

async function createActor(browser: Browser, label: string): Promise<Actor> {
  const user = await registerVerifiedUser(label);
  const context = await browser.newContext({ baseURL: FRONTEND_BASE });
  try {
    const page = await context.newPage();
    const authenticated = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/auth/api/v1/auth/login'
      && response.request().method() === 'POST' && response.ok(), { timeout: 130_000 });
    await submitLoginForm(page, user.email, UI_PASSWORD);
    const login = object(await (await authenticated).json());
    await expect(page).toHaveURL(/\/(dashboard|tasks)(\/|$|\?)/, { timeout: 20_000 });
    const actor: Actor = {
      context, page, user,
      token: identifier(login.accessToken ?? login.AccessToken),
      csrf: await csrfFor(context),
      storage: await context.storageState(), rateLimits: [],
    };
    // The setup UI has served its one login; keep only its API context during seeding.
    await page.close();
    return actor;
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function category(actor: Actor, name: string, icon: string, color: string): Promise<string> {
  const created = unwrap(await APIchecked(actor, 'post', '/categories/api/v1/categories', {
    userId: null, name, icon, color, displayOrder: 0,
  }));
  return identifier(created.id);
}

async function createTask(actor: Actor, title: string, extra: Json = {}): Promise<MotionTask> {
  return motionTask(await APIchecked(actor, 'post', TODO_PATH, {
    userId: null, title, description: null, categoryId: null,
    dueDate: null, dueDateStart: null, expectedDate: null,
    priority: 3, isPublic: false, sharedWithUserIds: [], ...extra,
  }));
}

async function richTask(actor: Actor, title: string, categoryId: string, extra: Json = {}): Promise<MotionTask> {
  const created = await createTask(actor, title, {
    categoryId, description: DESCRIPTION, dueDateStart: RANGE_START, dueDate: RANGE_END,
    expectedDate: EXPECTED, ...extra,
  });
  // ActualDate is an update field, not a create field. A future actual date gives a real
  // two-day delay while the fixture remains active (`status: todo`).
  const full = motionTask(await APIchecked(actor, 'put', `${TODO_PATH}/${created.id}`, {
    actualDate: ACTUAL, status: 'todo',
  }));
  expect(full.delay, 'rich motion fixture exposes a real API delay').not.toBeNull();
  if (typeof full.delay === 'number') expect(full.delay).toBeGreaterThan(0);
  return full;
}

async function acceptFriendship(owner: Actor, friend: Actor): Promise<void> {
  await APIchecked(owner, 'post', '/auth/api/v1/friendships/requests', { friendId: friend.user.userId });
  const incoming = items(await APIchecked(friend, 'get', '/auth/api/v1/friendships/requests?incoming=true'));
  const request = incoming.find(row => String(row.userId).toLowerCase() === owner.user.userId.toLowerCase());
  expect(request, 'motion fixture friendship request exists').toBeTruthy();
  await APIchecked(friend, 'post', `/auth/api/v1/friendships/requests/${identifier(request?.friendshipId)}/accept`);
}

async function waitForList(actor: Actor, tasks: MotionTask[], total: number): Promise<void> {
  let receivedSampleCount = 0;
  let latestProjection: Json[] = [];
  try {
    await expect.poll(async () => {
      const data = await APIchecked(actor, 'get', `${TODO_PATH}?pageNumber=1&pageSize=50&isCompleted=false`);
      receivedSampleCount++;
      const rows = items(data);
      latestProjection = safeTaskProjection(rows);
      return rows.length >= total && tasks.every(task => rows.some(row => row.id === task.id));
    }, { timeout: 130_000, intervals: [250, 500, 1_000, 2_000], message: 'real active task list exposes authorized motion fixtures' }).toBe(true);
  } catch (error) {
    await persistJsonEvidence(test.info(), 'motion-list-setup-' + actor.user.userId, {
      body: JSON.stringify({
        actorUserId: actor.user.userId, expectedTaskIds: tasks.map(task => task.id), expectedMinimum: total,
        receivedSampleCount, latestList: latestProjection,
        rateLimits: actor.rateLimits, refreshIdentity: actor.refreshIdentity,
      }, null, 2), contentType: 'application/json',
    });
    throw error;
  }
}

export async function createMotionFixtures(browser: Browser): Promise<MotionFixtures> {
  const actors: Actor[] = [];
  try {
    const owner = await createActor(browser, 'motion-owner');
    actors.push(owner);
    const friend = await createActor(browser, 'motion-friend');
    actors.push(friend);
    const pager = await createActor(browser, 'motion-pager');
    actors.push(pager);
    await acceptFriendship(owner, friend);

    const privateCategory = await category(owner, 'Motion private', 'Home', '#10b981');
    const sharedCategory = await category(owner, 'Motion shared', 'Briefcase', '#3b82f6');
    const viewerCategory = await category(owner, 'Motion viewer', 'Plane', '#0369a1');
    const friendCategory = await category(friend, 'Motion friend author', 'Home', '#15803d');
    const pagerCategory = await category(pager, 'Motion pager', 'Folder', '#a16207');

    const privateTask = await richTask(owner, 'Адаптивный дизайн', privateCategory, { priority: 5 });
    expect(privateTask.userId, 'Private fixture belongs to the registered owner').toBe(owner.user.userId);
    const otherTasks = [
      await createTask(owner, 'После дизайна: проверить мобильные размеры', {
        description: 'Проверить поля, перенос текста и кнопки на телефоне. '.repeat(2),
      }),
      await createTask(owner, 'После дизайна: отправить письмо'),
      await createTask(owner, 'После дизайна: собрать полный список замечаний и согласовать следующий шаг', {
        description: DESCRIPTION, expectedDate: RANGE_END,
      }),
    ];
    const sharedTask = await richTask(owner, 'Адаптивный дизайн — совместный', sharedCategory, {
      sharedWithUserIds: [friend.user.userId],
    });
    const friendTask = await richTask(friend, 'Адаптивный дизайн — от друга', friendCategory, { isPublic: true });
    await APIchecked(owner, 'patch', `${TODO_PATH}/${friendTask.id}/viewer-preferences`, {
      updateViewerCategory: true, viewerCategoryId: viewerCategory,
    });
    // Capture the real viewer DTO, including its effective category metadata.
    const viewerTask = motionTask(await APIchecked(owner, 'get', `${TODO_PATH}/${friendTask.id}`));
    expect(viewerTask.categoryId).toBe(viewerCategory);

    const pagerTasks: MotionTask[] = [];
    // Active pages are ordered CreatedAt DESC by the repository: create the display order backwards.
    for (let number = 19; number >= 1; number--) {
      let task: MotionTask;
      if (number <= 6) {
        const title = `Пагинация ${number}: ` + (number % 2
          ? 'подготовить подробный адаптивный дизайн, проверить размеры, описание и даты карточки'
          : 'согласовать большой макет с участниками');
        // Two rich rows make one desktop column taller than the others, so
        // collapsing its bottom really lowers the document bottom (no tied-column no-op).
        task = number === 1 || number === 4
          ? await richTask(pager, title, pagerCategory)
          : await createTask(pager, title, { categoryId: pagerCategory, description: DESCRIPTION, dueDate: RANGE_END });
      } else if (number <= 12 || number === 19) {
        task = await createTask(pager, `Пагинация ${number}`, { categoryId: pagerCategory });
      } else {
        task = await createTask(pager, `Пагинация ${number}: проверить макет и согласовать правки`, {
          categoryId: pagerCategory,
          description: 'Описание средней карточки с деталями для следующего шага. '.repeat(number % 3 + 1),
          dueDate: RANGE_END,
        });
      }
      pagerTasks.unshift(task);
    }

    await waitForList(owner, [privateTask, sharedTask, viewerTask, ...otherTasks], 6);
    await waitForList(pager, pagerTasks, 19);
    const firstPage = items(await APIchecked(pager, 'get', `${TODO_PATH}?pageNumber=1&pageSize=6&isCompleted=false`));
    expect(firstPage.map(row => row.id)).toEqual(pagerTasks.slice(0, 6).map(task => task.id));
    const fixtures: MotionFixtures = { owner, friend, pager, privateTask, sharedTask, viewerTask, otherTasks, pagerTasks };
    await setHiddenFixture(fixtures, 'viewer');
    for (const actor of actors) actor.storage = await actor.context.storageState();

    return fixtures;
  } catch (error) {
    await Promise.allSettled(actors.map(actor => actor.context.close()));
    throw error;
  }
}

/** Reset the three candidates, then hide just the selected actor-specific projection. */
export async function setHiddenFixture(fixtures: MotionFixtures, kind: MotionFixtureKind | null): Promise<void> {
  const { owner, friend, privateTask, sharedTask, viewerTask } = fixtures;
  await refreshActor(owner);
  await APIchecked(owner, 'patch', `${TODO_PATH}/${privateTask.id}/hidden`, { hidden: false });
  await APIchecked(owner, 'patch', `${TODO_PATH}/${sharedTask.id}/hidden`, { hidden: false });
  await APIchecked(owner, 'patch', `${TODO_PATH}/${viewerTask.id}/viewer-preferences`, { hiddenByViewer: false });
  if (kind === 'viewer') {
    await APIchecked(owner, 'patch', `${TODO_PATH}/${viewerTask.id}/viewer-preferences`, { hiddenByViewer: true });
  } else if (kind) {
    const selected = kind === 'private' ? privateTask : sharedTask;
    await APIchecked(owner, 'patch', `${TODO_PATH}/${selected.id}/hidden`, { hidden: true });
  }
  const selectedId = kind === 'private' ? privateTask.id : kind === 'shared' ? sharedTask.id : kind === 'viewer' ? viewerTask.id : null;
  let receivedSampleCount = 0;
  let latestProjection: Json[] = [];
  try {
    await expect.poll(async () => {
      const data = await APIchecked(owner, 'get', `${TODO_PATH}?pageNumber=1&pageSize=50&isCompleted=false`);
      receivedSampleCount++;
      const rows = items(data);
      latestProjection = safeTaskProjection(rows);
      return [privateTask, sharedTask, viewerTask].every(task => {
        const row = rows.find(item => item.id === task.id);
        return !!row && Boolean(row.hidden) === (task.id === selectedId);
      });
    }, { timeout: 130_000, intervals: [250, 500, 1_000, 2_000], message: 'only the selected motion fixture is hidden for its viewer' }).toBe(true);
  } catch (error) {
    await persistJsonEvidence(test.info(), 'motion-visibility-setup-' + (kind ?? 'open'), {
      body: JSON.stringify({
        kind, selectedId, receivedSampleCount,
        fixtureIds: { private: privateTask.id, shared: sharedTask.id, viewer: viewerTask.id },
        actorUserIds: { owner: owner.user.userId, friend: friend.user.userId },
        rateLimits: { owner: owner.rateLimits, friend: friend.rateLimits },
        refreshIdentity: { owner: owner.refreshIdentity, friend: friend.refreshIdentity },
        latestList: latestProjection,
      }, null, 2),
      contentType: 'application/json',
    });
    throw error;
  }
  owner.storage = await owner.context.storageState();
  friend.storage = await friend.context.storageState();
}

export async function disposeMotionFixtures(fixtures: MotionFixtures): Promise<void> {
  await Promise.allSettled([fixtures.owner, fixtures.friend, fixtures.pager].map(actor => actor.context.close()));
}
