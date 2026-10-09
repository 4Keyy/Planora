import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { retryRateLimited } from '../_rate-limit';
import { API_BASE, FRONTEND_BASE, registerVerifiedUser, submitLoginForm, UI_PASSWORD, type UiUser } from './_helpers';

type Json = Record<string, unknown>;
type Session = { context: BrowserContext; page: Page; user: UiUser; token: string; csrf: string };
export type GeometryCase = { key: string; id: string; title: string; completed: boolean; unread?: boolean; tall?: boolean };
export type GeometryFixtures = {
  owner: Session;
  friend: Session;
  cases: GeometryCase[];
  storage: Awaited<ReturnType<BrowserContext['storageState']>>;
};

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
  return (body.items as unknown[]).map(object);
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Expected a nonempty API identifier');
  return value;
}
async function api(session: Session, method: 'get' | 'post' | 'put' | 'patch', path: string, data?: Json): Promise<unknown> {
  const response = await retryRateLimited(() => session.context.request[method](API_BASE + path, {
    headers: { Authorization: 'Bearer ' + session.token, 'X-CSRF-Token': session.csrf }, data,
  }));
  expect(response.ok(), `${method} ${path}: HTTP ${response.status()}`).toBeTruthy();
  return response.status() === 204 ? {} : response.json();
}
async function actor(browser: Browser, label: string): Promise<Session> {
  const user = await registerVerifiedUser(label);
  const context = await browser.newContext({ baseURL: FRONTEND_BASE });
  const page = await context.newPage();
  try {
    // This token belongs only to this freshly registered fixture. Never save it or auth state to disk.
    const authenticated = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/auth/api/v1/auth/login' && response.request().method() === 'POST' && response.ok(), { timeout: 130_000 });
    await submitLoginForm(page, user.email, UI_PASSWORD);
    const login = object(await (await authenticated).json());
    await expect(page).toHaveURL(/\/(dashboard|tasks)(\/|$|\?)/, { timeout: 20_000 });
    const csrfResponse = await retryRateLimited(() => context.request.get(API_BASE + '/auth/api/v1/auth/csrf-token'));
    expect(csrfResponse.ok()).toBeTruthy();
    const csrf = object(await csrfResponse.json());
    return { context, page, user, token: string(login.accessToken ?? login.AccessToken), csrf: string(csrf.token ?? csrf.Token) };
  } catch (error) {
    await context.close();
    throw error;
  }
}

export async function createGeometryFixtures(browser: Browser): Promise<GeometryFixtures> {
  const owner = await actor(browser, 'rail-owner');
  let friend: Session | undefined;
  try {
    friend = await actor(browser, 'rail-friend');
    await api(owner, 'post', '/auth/api/v1/friendships/requests', { friendId: friend.user.userId });
    const incoming = items(await api(friend, 'get', '/auth/api/v1/friendships/requests?incoming=true'));
    const friendship = incoming.find(item => String(item.userId).toLowerCase() === owner.user.userId.toLowerCase());
    expect(friendship, 'fixture friendship request exists').toBeTruthy();
    await api(friend, 'post', `/auth/api/v1/friendships/requests/${string(friendship?.friendshipId)}/accept`);

    const cases: GeometryCase[] = [];
    const create = async (session: Session, key: string, title: string, extra: Json = {}, completed = false) => {
      const todo = unwrap(await api(session, 'post', '/todos/api/v1/todos', {
        title, description: null, categoryId: null, dueDate: null, expectedDate: null,
        priority: 3, isPublic: false, sharedWithUserIds: [], ...extra,
      }));
      const result: GeometryCase = { key, title, id: string(todo.id), completed };
      cases.push(result);
      return result;
    };
    await create(owner, 'own-short', 'Rail own short');
    const working = await create(owner, 'own-working-unread', 'Rail own working across two lines', { isPublic: true });
    working.unread = true;
    await api(owner, 'put', `/todos/api/v1/todos/${working.id}`, { status: 'inprogress' });
    await api(friend, 'post', `/todos/api/v1/todos/${working.id}/join`);
    await api(friend, 'post', `/collaboration/api/v1/comments/${working.id}`, { content: 'Geometry fixture unread comment' });

    const tall = await create(owner, 'own-tall-three-lines',
      'Rail prepare the quarterly report for the board meeting and send the complete draft to the finance team', {
        description: 'A detailed body keeps the natural card height above its control rail. '.repeat(4),
        dueDateStart: '2060-06-10T00:00:00Z', dueDate: '2060-06-20T00:00:00Z', expectedDate: '2060-06-15T00:00:00Z',
      });
    tall.tall = true;
    await create(friend, 'friend-take', 'Rail friend take', { isPublic: true });
    const friendWorking = await create(friend, 'friend-working', 'Rail friend working on a shared item', { isPublic: true });
    await api(owner, 'post', `/todos/api/v1/todos/${friendWorking.id}/join`);
    await create(friend, 'revealed', 'Rail revealed card', { isPublic: true });
    const ownDone = await create(owner, 'own-done',
      'Rail completed owner with a long title that spans several lines to exercise fractional and odd card heights', {}, true);
    await api(owner, 'put', `/todos/api/v1/todos/${ownDone.id}`, { status: 'done' });
    const friendDone = await create(friend, 'friend-done', 'Rail completed friend', { isPublic: true }, true);
    await api(friend, 'put', `/todos/api/v1/todos/${friendDone.id}`, { status: 'done' });
    await api(owner, 'patch', `/todos/api/v1/todos/${friendDone.id}/viewer-preferences`, { completedByViewer: true });

    // Six active fixtures fit the dashboard's actual six-item first page, including each active state.
    let unreadGroups: Array<{ type: unknown; count: unknown }> = [];
    try {
      await expect.poll(async () => {
      const summary = unwrap(await api(owner, 'get', '/realtime/api/v1/notifications/summary'));
      const task = (summary.perTask as Json[]).find(item => item.taskId === working.id);
      unreadGroups = (task?.groups as Json[] | undefined)?.map(group => ({ type: group.type, count: group.count })) ?? [];
      return unreadGroups.length;
      }, { timeout: 125_000, intervals: [250, 500, 1_000], message: 'real outboxes deliver a multi-type unread cluster after any genuine Gateway cooldown' }).toBeGreaterThanOrEqual(2);
    } catch (error) {
      throw new Error('Real unread fixture last type/count groups: ' + JSON.stringify(unreadGroups), { cause: error });
    }
    // The UI's first empty list may have cached the pre-friendship ID set for 30 seconds.
    // Wait on the real list predicate, rather than racing that cache with hidden-card assertions.
    await expect.poll(async () => {
      const visible = items(await api(owner, 'get', '/todos/api/v1/todos?pageNumber=1&pageSize=50'));
      return cases.every(item => visible.some(todo => todo.id === item.id));
    }, { timeout: 45_000, message: 'real task lists expose all authorized fixtures after accepting friendship' }).toBe(true);
    const storage = await owner.context.storageState();
    await owner.page.close();
    await friend.page.close();
    return { owner, friend, cases, storage };
  } catch (error) {
    await owner.context.close();
    await friend?.context.close();
    throw error;
  }
}

export async function hideRevealFixture(fixtures: GeometryFixtures) {
  // The full matrix can outlive a 15-minute access token. Use this fixture's latest
  // rotated cookie (in memory only) and the real refresh endpoint before each case.
  await fixtures.owner.context.addCookies(fixtures.storage.cookies);
  const csrfResponse = await retryRateLimited(() => fixtures.owner.context.request.get(API_BASE + '/auth/api/v1/auth/csrf-token'));
  expect(csrfResponse.ok(), 'refresh fixture CSRF').toBeTruthy();
  const csrf = object(await csrfResponse.json());
  fixtures.owner.csrf = string(csrf.token ?? csrf.Token);
  const refresh = await retryRateLimited(() => fixtures.owner.context.request.post(API_BASE + '/auth/api/v1/auth/refresh', {
    headers: { 'X-CSRF-Token': fixtures.owner.csrf }, data: {},
  }));
  expect(refresh.ok(), 'refresh geometry fixture: HTTP ' + refresh.status()).toBeTruthy();
  const authenticated = object(await refresh.json());
  fixtures.owner.token = string(authenticated.accessToken ?? authenticated.AccessToken);
  fixtures.storage = { ...fixtures.storage, cookies: await fixtures.owner.context.cookies() };
  const revealed = fixtures.cases.find(item => item.key === 'revealed')!;
  await api(fixtures.owner, 'patch', `/todos/api/v1/todos/${revealed.id}/viewer-preferences`, { hiddenByViewer: true });
}

/** Listen to real responses; no interception, limiter override, or synthetic API response. */
export class GeometryRateBudget {
  readonly events: Array<{ path: string; retryAfterSeconds: number }> = [];
  readonly waits: number[] = [];
  private retryAt = 0;
  private pending: Promise<void>[] = [];
  private invalidHeader = false;

  constructor(private readonly page: Page) {
    page.on('response', response => {
      if (response.status() !== 429 || new URL(response.url()).origin !== new URL(API_BASE).origin) return;
      const path = new URL(response.url()).pathname;
      const capture = (async () => {
        const header = await response.headerValue('retry-after');
        const seconds = header && /^\d+$/.test(header) ? Number(header) : header ? (Date.parse(header) - Date.now()) / 1000 : Number.NaN;
        if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60) {
          this.invalidHeader = true;
          return;
        }
        this.events.push({ path, retryAfterSeconds: seconds });
        // Recover the primary task-list load. Background notification polling must
        // not keep extending that deadline while the geometry test waits.
        if (path === '/todos/api/v1/todos') {
          this.retryAt = Math.max(this.retryAt, Date.now() + Math.ceil(seconds * 1000) + 100);
        }
      })().catch(() => { this.invalidHeader = true; });
      this.pending.push(capture);
    });
  }

  async wait() {
    await Promise.all(this.pending);
    this.pending = [];
    expect(this.invalidHeader, 'A real 429 must provide a valid Retry-After of at most one minute').toBe(false);
    const started = Date.now();
    while (Date.now() < this.retryAt) {
      await this.page.waitForTimeout(Math.min(30_000, this.retryAt - Date.now()));
    }
    if (this.retryAt) this.waits.push(Date.now() - started);
    this.retryAt = 0;
  }

  async loaded(ready: () => Promise<boolean>) {
    // One real cooldown and UI retry per load; other errors and still-limited retries fail.
    for (let attempt = 0; attempt < 2; attempt++) {
      let outcome = 'waiting';
      await expect.poll(async () => {
        await Promise.all(this.pending);
        outcome = await ready() ? 'ready' : this.retryAt ? 'limited' : 'waiting';
        return outcome;
      }, { timeout: 20_000, intervals: [100, 250, 500], message: 'Real page cards load or report a rate-limit response' }).not.toBe('waiting');
      if (outcome === 'ready') return;
      expect(attempt, 'UI is still rate limited after its actual Retry-After cooldown').toBe(0);
      await this.wait();
      const retry = this.page.getByRole('button', { name: 'Try again', exact: true });
      if (await retry.isVisible()) await retry.click();
      else await this.page.reload(); // A failed completed-preview request has no retry button.
    }
  }
}

export async function waitForGeometryTasks(page: Page, budget: GeometryRateBudget) {
  await budget.loaded(async () => {
    const short = page.getByRole('heading', { name: 'Rail own short', exact: true });
    return await short.count() === 1 && await short.isVisible()
      && await page.getByRole('button', { name: /^Completed\s+2$/ }).isVisible();
  });
}

export async function navigateGeometrySurface(page: Page, surface: '/tasks' | '/dashboard' | '/tasks/completed', cases: GeometryCase[], budget: GeometryRateBudget) {
  await budget.wait();
  const destination = surface === '/tasks/completed' ? '/tasks' : surface;
  // Use normal Next links after the first document, keeping first/repeated mounts independent
  // without causing dozens of unrelated refresh-token requests during the geometry matrix.
  if (new URL(page.url()).pathname !== destination) {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    if (page.viewportSize()!.width < 640) {
      await page.getByRole('button', { name: 'Open menu', exact: true }).click();
      await page.getByTestId('navbar-mobile').locator(`a[href="${destination}"]`).click();
    } else {
      const link = page.getByTestId('navbar-desktop').locator(`a[href="${destination}"]`);
      await link.focus();
      await link.click();
    }
    await expect(page).toHaveURL(new RegExp(destination.replaceAll('/', '\\/') + '$'));
  }
  if (surface === '/tasks' || surface === '/tasks/completed') {
    await waitForGeometryTasks(page, budget);
    const completed = page.getByRole('button', { name: /^Completed\s+\d+$/ });
    await expect(completed).toBeVisible({ timeout: 20_000 });
    if (await completed.getAttribute('aria-expanded') !== 'true') await completed.click();
    if (surface === '/tasks/completed') {
      await page.getByRole('link', { name: 'Open the archive' }).click();
      await expect(page).toHaveURL(/\/tasks\/completed$/);
    }
  }
  const visible = cases.filter(item => surface === '/dashboard' ? !item.completed : surface === '/tasks/completed' ? item.completed : true);
  await budget.loaded(async () => {
    if (surface === '/tasks') {
      const completed = page.getByRole('button', { name: /^Completed\s+2$/ });
      if (await completed.isVisible() && await completed.getAttribute('aria-expanded') !== 'true') await completed.click();
    }
    // Next retains the exiting page during its transition; wait for a single current
    // card before invoking a strict locator rather than measuring the exiting copy.
    const cards = visible.map(item => geometryCard(page, item));
    if (!(await Promise.all(cards.map(card => card.count()))).every(count => count === 1)) return false;
    return (await Promise.all(cards.map(card => card.isVisible()))).every(Boolean);
  });
}

export function geometryCard(page: Page, item: GeometryCase) {
  return page.locator('[data-task-card]').filter({ has: page.getByRole('heading', { name: item.title, exact: true }) });
}

export type GeometryMeasurement = {
  offCentre: number; height: number; circleHeight: number; titleLines: number; completionHovered: boolean;
  completeHitHeight: number; completeHitWidth: number;
  eyeBottom: number | null; eyeLeft: number | null; eyeHitHeight: number | null; eyeHitWidth: number | null; eyeOffset: number | null; hitIntersection: number; gap: number | null;
};

export async function measureCard(card: Locator): Promise<GeometryMeasurement> {
  return card.evaluate(element => {
    const control = element.querySelector<HTMLButtonElement>('button[aria-label="Mark as complete"], button[aria-label="Take it – start working"], button[aria-label="Mark as incomplete"]')!;
    const circle = control.querySelector<HTMLElement>('[data-completion-circle]') ?? control;
    const eye = element.querySelector<HTMLButtonElement>('button[aria-label="Collapse task card"]');
    const c = element.getBoundingClientRect();
    const b = circle.getBoundingClientRect();
    const e = eye?.getBoundingClientRect();
    const hit = (button: HTMLButtonElement) => {
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      const pseudo = getComputedStyle(button, '::after');
      const transform = new DOMMatrixReadOnly(pseudo.transform);
      const scaleX = rect.width / button.offsetWidth;
      const scaleY = rect.height / button.offsetHeight;
      const top = rect.top + (parseFloat(style.borderTopWidth) + parseFloat(pseudo.top) + transform.f) * scaleY;
      const height = parseFloat(pseudo.height) * scaleY;
      const left = rect.left + (parseFloat(style.borderLeftWidth) + parseFloat(pseudo.left) + transform.e) * scaleX;
      const width = parseFloat(pseudo.width) * scaleX;
      return { left, right: left + width, top, bottom: top + height, height, width };
    };
    const completeHit = hit(control);
    const eyeHit = eye ? hit(eye) : null;
    // Touching float32 DOMRect edges can differ by less than 0.001 CSS px.
    const overlapX = eyeHit ? Math.max(0, Math.min(eyeHit.right, completeHit.right) - Math.max(eyeHit.left, completeHit.left)) : 0;
    const overlapY = eyeHit ? Math.max(0, Math.min(eyeHit.bottom, completeHit.bottom) - Math.max(eyeHit.top, completeHit.top)) : 0;
    const title = element.querySelector('h3')!;
    return {
      offCentre: b.top + b.height / 2 - (c.top + c.height / 2),
      height: c.height, circleHeight: b.height, completionHovered: control.matches(':hover'),
      titleLines: Math.round(title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight)),
      completeHitHeight: completeHit.height, completeHitWidth: completeHit.width,
      eyeBottom: e ? c.bottom - e.bottom : null, eyeLeft: e ? e.left - c.left : null,
      eyeHitWidth: eyeHit?.width ?? null,
      eyeOffset: e ? e.left + e.width / 2 - (b.left + b.width / 2) : null,
      hitIntersection: overlapX > 0.001 && overlapY > 0.001 ? overlapX * overlapY : 0,
      eyeHitHeight: eyeHit?.height ?? null, gap: eyeHit ? eyeHit.top - completeHit.bottom : null,
    };
  });
}

export function assertGeometry(measurement: GeometryMeasurement, completed: boolean, label: string) {
  const detail = label + ': ' + JSON.stringify(measurement);
  expect(Math.abs(measurement.offCentre), detail).toBeLessThanOrEqual(0.5);
  expect(measurement.completeHitHeight, detail).toBeGreaterThanOrEqual(44 - 0.001);
  expect(measurement.completeHitWidth, detail).toBeGreaterThanOrEqual(44 - 0.001);
  expect(measurement.titleLines, detail).toBeGreaterThanOrEqual(1);
  expect(measurement.titleLines, detail).toBeLessThanOrEqual(3);
  if (completed) {
    expect(measurement.eyeBottom, detail).toBeNull();
  } else {
    expect(Math.abs(measurement.eyeBottom! - 22), detail).toBeLessThanOrEqual(0.02);
    expect(Math.abs(measurement.eyeLeft! - 23), detail).toBeLessThanOrEqual(0.02);
    expect(measurement.eyeHitHeight, detail).toBeGreaterThanOrEqual(44 - 0.001);
    expect(Math.abs(measurement.eyeOffset!), detail).toBeLessThanOrEqual(0.02);
    expect(measurement.eyeHitWidth, detail).toBeGreaterThanOrEqual(44 - 0.001);
    expect(measurement.hitIntersection, detail).toBeLessThanOrEqual(0.001);
    expect(measurement.gap, detail).toBeGreaterThanOrEqual(-0.001);
  }
}

// Observe actual browser layout shifts while the settled card controls are exercised.
// Input-triggered navigation/expansion is outside this measurement window.
type LayoutShiftEntry = PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: Array<{ node?: Element; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }> };
type RailLayoutWindow = Window & {
  railLayoutObservation?: { entries: number[]; sources: unknown[]; observer: PerformanceObserver };
};
export async function beginRailLayoutObservation(page: Page) {
  await page.evaluate(() => {
    if (!PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
      throw new Error('The browser cannot measure layout shifts');
    }
    const entries: number[] = [];
    const sources: unknown[] = [];
    const collect = (records: PerformanceEntry[]) => {
      for (const item of records as LayoutShiftEntry[]) {
        if (!item.hadRecentInput) {
          entries.push(item.value);
          sources.push({ value: item.value, nodes: item.sources?.map(source => ({
            tag: source.node?.tagName, classes: source.node?.className,
            previous: source.previousRect.toJSON(), current: source.currentRect.toJSON(),
          })) });
        }
      }
    };
    const observer = new PerformanceObserver(list => collect(list.getEntries()));
    observer.observe({ type: 'layout-shift' });
    (window as RailLayoutWindow).railLayoutObservation = { entries, sources, observer };
  });
}
export async function endRailLayoutObservation(page: Page): Promise<{ score: number; shifts: unknown[] }> {
  return page.evaluate(() => {
    const state = (window as RailLayoutWindow).railLayoutObservation!;
    for (const item of state.observer.takeRecords() as LayoutShiftEntry[]) {
      if (!item.hadRecentInput) state.entries.push(item.value);
    }
    state.observer.disconnect();
    delete (window as RailLayoutWindow).railLayoutObservation;
    const score = state.entries.reduce((total, value) => total + value, 0);
    return { score, shifts: state.sources };
  });
}
