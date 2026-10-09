import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { API_BASE, FRONTEND_BASE, registerVerifiedUser, requireFrontendReachable, submitLoginForm, UI_PASSWORD } from './_helpers';
import { retryRateLimited } from '../_rate-limit';
import { GeometryRateBudget } from './_card-geometry';

const runFile = promisify(execFile);
const require = createRequire(resolve(process.cwd(), 'package.json'));
let axeScript: string | undefined;
try { axeScript = require.resolve('axe-core/axe.min.js'); } catch { /* Report this optional audit explicitly, without installing dependencies. */ }
const missingPath = () => '/e2e-missing-' + randomUUID();
const notices = (page: Page) => page.getByRole('region', { name: 'Notifications' });
const cards = (page: Page) => page.locator('[data-task-card]');
const cardFor = (page: Page, title: string) => cards(page).filter({ has: page.getByRole('heading', { name: title, exact: true }) });

async function evidence(info: TestInfo, name: string, value: unknown) {
  const json = JSON.stringify(value, null, 2);
  const file = info.outputPath(name + '.json');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, json);
  await info.attach(name, { body: json, contentType: 'application/json' });
}

async function axe(page: Page, selector: string, info: TestInfo) {
  if (!axeScript) {
    info.annotations.push({ type: 'audit unavailable', description: 'axe-core is not installed; no dependency was added.' });
    return;
  }
  // Audit settled readable content, rather than a transient colour blended by entrance opacity.
  await expect.poll(() => page.locator(selector).evaluate(scope => {
    const readable = Array.from(scope.querySelectorAll('h1, h2, h3, p, a, button'));
    if (readable.length === 0) return false;
    return readable.every(node => {
      if (node.closest('[aria-hidden="true"]') || !node.getBoundingClientRect().width) return true;
      for (let current: Element | null = node; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.visibility === 'hidden') return true;
        if (Number(style.opacity) < 0.99999) return false;
        if (current === scope) break;
      }
      return true;
    });
  }), { message: 'Readable audit content finishes its entrance opacity' }).toBe(true);
  // DevTools evaluation runs the audit without weakening production CSP.
  await page.evaluate(readFileSync(axeScript, 'utf8'));
  const result = await page.evaluate(async scope => {
    const engine = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: unknown[] }> } }).axe;
    return engine.run({ include: [scope] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
  }, selector);
  await evidence(info, 'axe', result);
  expect(result.violations, 'WCAG A/AA violations in ' + selector).toEqual([]);
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

async function gotoMissing(page: Page) {
  const path = missingPath();
  const response = await page.goto(path);
  expect(response?.status(), 'unknown route returns an actual 404').toBe(404);
  await expect(page).toHaveTitle('Page not found · Planora');
  await expect(page.getByRole('heading', { name: "This page isn't on any list." })).toBeVisible();
  return path;
}

function recordPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    // The intentional HTTP 404 has an expected browser network diagnostic.
    if (/Failed to load resource: the server responded with a status of 404/.test(message.text())) return;
    errors.push(message.text());
  });
  return errors;
}

async function deleteCard(page: Page, title: string) {
  const card = cardFor(page, title);
  await expect(card).toBeVisible();
  const remove = card.getByRole('button', { name: 'Delete task: ' + title, exact: true });
  const visible = await remove.all();
  for (const button of visible) {
    if (await button.isVisible()) {
      await expect(button).toBeVisible();
      await button.focus();
      await button.press('Enter');
      return;
    }
  }
  throw new Error('No visible delete affordance for fixture ' + title);
}

async function swipe(page: Page, notice: Locator, direction: -1 | 1) {
  const rect = await notice.boundingBox();
  expect(rect).not.toBeNull();
  const x = rect!.x + rect!.width / 2;
  const y = rect!.y + rect!.height / 2;
  const positions: number[] = [];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 145 * direction, y, { steps: 10 });
  const tracking = notice.evaluate(element => new Promise<number[]>(resolve => {
    const samples: number[] = [];
    const sample = () => {
      if (!element.isConnected) { resolve(samples); return; }
      samples.push(element.getBoundingClientRect().x);
      if (samples.length >= 40) { resolve(samples); return; }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  await page.mouse.up();
  positions.push(...await tracking);
  await expect(notice).toHaveCount(0);
  expect(positions.some(value => direction * (value - rect!.x) >= 145), 'notice exits in the actual swipe direction').toBe(true);
  return positions;
}

test.describe('notices and error scenes: public production routes', () => {
  test.beforeAll(async () => { await requireFrontendReachable(); });

  test('anonymous 404: status, metadata, exits, keyboard, mobile and axe', async ({ page }, info) => {
    const errors = recordPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoMissing(page);
    const pile = page.getByRole('list', { name: 'Where to go instead' });
    await expect(pile.getByRole('link', { name: /^Planora home/ })).toHaveAttribute('href', '/');
    await expect(pile.getByRole('link', { name: /^Sign in/ })).toHaveAttribute('href', '/auth/login');
    await expect(pile.getByRole('link', { name: /^Dashboard/ })).toHaveCount(0);
    const first = page.getByRole('button', { name: 'Go to the home page', exact: true });
    await first.focus();
    await page.keyboard.press('Tab');
    const history = page.getByRole('button', { name: /^Go back/ });
    if (await history.count()) {
      await expect(history).toBeFocused();
      await page.keyboard.press('Tab');
    }
    await expect(pile.getByRole('link', { name: /^Planora home/ })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(pile.getByRole('link', { name: /^Sign in/ })).toBeFocused();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath('anonymous-404-mobile.png') });
    await axe(page, 'main', info);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/auth\/login$/);
    expect(errors).toEqual([]);
  });

  test('404 destination check waits for its animation; Ctrl-click and dragging preserve link behavior', async ({ page, context }, info) => {
    await gotoMissing(page);
    const link = page.getByRole('link', { name: /^Sign in/ });
    await expect(link).toBeVisible();
    const popup = context.waitForEvent('page', { timeout: 10_000 });
    await link.click({ modifiers: ['ControlOrMeta'] });
    const opened = await popup;
    // A popup event precedes document readiness. Check committed URL and the actual form,
    // without making unrelated load-event resources part of this link contract.
    await opened.waitForURL(/\/auth\/login$/, { waitUntil: 'commit', timeout: 20_000 });
    await expect(opened.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible({ timeout: 20_000 });
    await opened.close();
    await page.bringToFront();
    // Popup focus pauses RAF in WebKit; allow the restored pile to settle before dragging.
    await page.waitForTimeout(800);
    const before = page.url();
    const rect = (await link.boundingBox())!;
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2 + 85, rect.y + rect.height / 2 + 25, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(550);
    expect(page.url(), 'dragging a destination must not follow it').toBe(before);
    await page.waitForTimeout(400);
    expect(page.url(), 'the drag must not schedule a delayed destination click').toBe(before);
    const started = Date.now();
    await link.click({ timeout: 10_000 });
    await page.waitForTimeout(200);
    expect(page.url(), 'destination is still here while its check draws').toBe(before);
    await expect(page).toHaveURL(/\/auth\/login$/);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(400);
    await evidence(info, 'destination-animation', { elapsedMs: elapsed, browser: context.browser()?.version() });
  });

  test('404 zero leads home after its check, and Go back follows real history', async ({ page }) => {
    await page.goto('/auth/login');
    await gotoMissing(page);
    await page.getByRole('button', { name: /^Go back/ }).click();
    await expect(page).toHaveURL(/\/auth\/login$/);
    const path = await gotoMissing(page);
    await page.getByRole('button', { name: 'Go to the home page', exact: true }).click();
    await page.waitForTimeout(250);
    expect(new URL(page.url()).pathname).toBe(path);
    await expect(page).toHaveURL(FRONTEND_BASE + '/');
  });

  test('landing keyboard deletion uses the shared notice and Undo restores its row', async ({ page }, info) => {
    const errors = recordPageErrors(page);
    await page.goto('/');
    const console = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Press ? right now.', exact: true }) });
    const rows = console.locator('[data-task-card]');
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const count = await rows.count();
    await console.scrollIntoViewIfNeeded();
    await page.keyboard.press('j');
    await page.keyboard.press('Delete');
    await expect(rows).toHaveCount(count - 1);
    const undo = notices(page).getByRole('button', { name: 'Undo', exact: true });
    await expect(undo).toBeVisible();
    await expect(notices(page).locator('.toast-countdown')).toHaveCount(1);
    await undo.focus();
    await notices(page).screenshot({ path: info.outputPath('landing-notice.png') });
    await axe(page, '[role="region"][aria-label="Notifications"]', info);
    await undo.press('Enter');
    await expect(rows).toHaveCount(count);
    expect(errors).toEqual([]);
  });

  test('landing reserved viewer space records actual open and hidden footprints', async ({ page }, info) => {
    await page.goto('/');
    const section = page.getByRole('region', { name: 'Your list', exact: true });
    await section.scrollIntoViewIfNeeded();
    const card = section.locator('[data-task-card]');
    await expect(card).toBeVisible();
    const measure = () => card.evaluate(element => {
      const reserve = element.closest('[class*="min-h-[10.375rem]"]') as HTMLElement | null;
      const box = element.getBoundingClientRect();
      return { cardHeight: box.height, reservedHeight: reserve?.getBoundingClientRect().height, minimumHeight: reserve ? getComputedStyle(reserve).minHeight : null };
    });
    await page.waitForTimeout(750);
    const open = await measure();
    await card.getByRole('button', { name: 'Collapse task card', exact: true }).click();
    await page.waitForTimeout(750);
    const hidden = await measure();
    await section.screenshot({ path: info.outputPath('landing-viewer-reserve.png') });
    await evidence(info, 'landing-viewer-reserve', { open, hidden, browser: page.context().browser()?.version() });
    expect(open.minimumHeight).toBe('166px');
    expect(hidden.cardHeight).toBeLessThan(open.cardHeight);
  });
});

type Json = Record<string, unknown>;
type Actor = { context: BrowserContext; storage: Awaited<ReturnType<BrowserContext['storageState']>>; token: string; csrf: string };
async function actor(browser: Browser, label: string): Promise<Actor> {
  const user = await registerVerifiedUser(label);
  const context = await browser.newContext({ baseURL: FRONTEND_BASE });
  const page = await context.newPage();
  try {
    const loggedIn = page.waitForResponse(response => new URL(response.url()).pathname === '/auth/api/v1/auth/login' && response.request().method() === 'POST' && response.ok(), { timeout: 130_000 });
    await submitLoginForm(page, user.email, UI_PASSWORD);
    const body = await (await loggedIn).json() as Json;
    await expect(page).toHaveURL(/\/(dashboard|tasks)(\?|$)/, { timeout: 20_000 });
    const csrfResponse = await retryRateLimited(() => context.request.get(API_BASE + '/auth/api/v1/auth/csrf-token'));
    expect(csrfResponse.ok()).toBe(true);
    const csrfBody = await csrfResponse.json() as Json;
    const token = body.accessToken ?? body.AccessToken;
    const csrf = csrfBody.token ?? csrfBody.Token;
    expect(typeof token).toBe('string');
    expect(typeof csrf).toBe('string');
    const storage = await context.storageState();
    await page.close();
    return { context, storage, token: token as string, csrf: csrf as string };
  } catch (error) { await context.close(); throw error; }
}
async function api(session: Actor, method: 'post' | 'put' | 'delete' | 'get', path: string, data?: Json) {
  return retryRateLimited(() => session.context.request[method](API_BASE + path, {
    headers: { Authorization: 'Bearer ' + session.token, 'X-CSRF-Token': session.csrf }, data,
  }));
}
async function createTask(session: Actor, label: string) {
  const title = label + ' ' + randomUUID().slice(0, 8);
  const response = await api(session, 'post', '/todos/api/v1/todos', { title, description: null, categoryId: null, dueDate: null, expectedDate: null, priority: 3, isPublic: false, sharedWithUserIds: [] });
  expect(response.ok(), 'create disposable task: HTTP ' + response.status()).toBe(true);
  const raw = await response.json() as Json;
  const body = (raw.value ?? raw.data ?? raw) as Json;
  expect(typeof body.id).toBe('string');
  return { title, id: body.id as string };
}

test.describe('notices and error scenes: real-service signed-in flows', () => {
  let owner: Actor;
  let stranger: Actor;
  let context: BrowserContext;
  let page: Page;
  let budget: GeometryRateBudget;
  let contextOpen = false;
  const fixtures: Array<{ actor: Actor; id: string }> = [];
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    await requireFrontendReachable();
    owner = await actor(browser, 'noticeowner');
    stranger = await actor(browser, 'noticestranger');
  });
  test.afterAll(async () => {
    // These identifiers belong only to this suite; fixture credentials never leave memory.
    try {
      for (const fixture of fixtures) {
        const response = await api(fixture.actor, 'delete', '/todos/api/v1/todos/' + fixture.id);
        expect([200, 204, 404], 'disposable task cleanup status').toContain(response.status());
      }
    } finally {
      await owner?.context.close();
      await stranger?.context.close();
    }
  });
  test.beforeEach(async ({ browser }) => {
    contextOpen = false;
    await owner.context.addCookies(owner.storage.cookies);
    const csrfResponse = await retryRateLimited(() => owner.context.request.get(API_BASE + '/auth/api/v1/auth/csrf-token'));
    expect(csrfResponse.ok(), 'fixture renewal obtains real CSRF').toBe(true);
    const csrfBody = await csrfResponse.json() as Json;
    owner.csrf = String(csrfBody.token ?? csrfBody.Token);
    const refresh = await retryRateLimited(() => owner.context.request.post(API_BASE + '/auth/api/v1/auth/refresh', {
      headers: { 'X-CSRF-Token': owner.csrf }, data: {},
    }));
    expect(refresh.ok(), 'renew fixture through the real Auth refresh endpoint').toBe(true);
    const refreshed = await refresh.json() as Json;
    owner.token = String(refreshed.accessToken ?? refreshed.AccessToken);
    owner.storage = { ...owner.storage, cookies: await owner.context.cookies() };
    context = await browser.newContext({ baseURL: FRONTEND_BASE, storageState: owner.storage });
    contextOpen = true;
    page = await context.newPage();
    budget = new GeometryRateBudget(page);
  });
  test.afterEach(async () => {
    if (contextOpen && owner) {
      owner.storage = { ...owner.storage, cookies: await context.cookies() };
      await owner.context.addCookies(owner.storage.cookies);
    }
    if (contextOpen) await context.close();
    contextOpen = false;
  });
  const ownTask = async (label: string, working = false) => {
    const task = await createTask(owner, label);
    fixtures.push({ actor: owner, id: task.id });
    if (working) {
      const path = '/todos/api/v1/todos/' + task.id;
      const changed = await api(owner, 'put', path, { status: 'inProgress' });
      expect(changed.ok(), 'prepare working fixture: HTTP ' + changed.status()).toBe(true);
      const persisted = await api(owner, 'get', path);
      expect(persisted.ok(), 'read real working fixture: HTTP ' + persisted.status()).toBe(true);
      const raw = await persisted.json() as Json;
      const body = (raw.value ?? raw.data ?? raw) as Json;
      expect(String(body.status ?? '').toLowerCase().replace(/\s/g, ''), 'persisted fixture status before loading the UI').toBe('inprogress');
    }
    // Assert the real active-list predicate before loading its UI; no fixed cache sleep.
    await expect.poll(async () => {
      const response = await api(owner, 'get', '/todos/api/v1/todos?pageNumber=1&pageSize=200&isCompleted=false');
      expect(response.ok(), 'fixture active list: HTTP ' + response.status()).toBe(true);
      const raw = await response.json() as Json;
      const body = (raw.value ?? raw.data ?? raw) as Json;
      expect(Array.isArray(body.items), 'real active-list response contains items').toBe(true);
      return (body.items as Json[]).some(item => item.id === task.id);
    }, { timeout: 45_000, intervals: [500, 1_000, 2_000], message: 'the real active task list exposes this disposable fixture before UI actions' }).toBe(true);
    return task;
  };
  const loadTask = async (title: string, surface = '/tasks') => {
    await page.goto(surface);
    await budget.loaded(async () => await cardFor(page, title).isVisible());
  };

  test('completion confirms its real PUT before a polite notice appears and never steals focus', async ({ browser: _browser }, info) => {
    const errors = recordPageErrors(page);
    const task = await ownTask('Notice complete', true);
    await loadTask(task.title);
    const circle = cardFor(page, task.title).getByRole('button', { name: 'Mark as complete', exact: true });
    await expect(circle).toBeVisible();
    await circle.focus();
    const completed = page.waitForResponse(response => new URL(response.url()).pathname === '/todos/api/v1/todos/' + task.id && response.request().method() === 'PUT');
    await circle.press('Enter');
    expect((await completed).ok(), 'real completion succeeds').toBe(true);
    const toast = notices(page).getByRole('status').filter({ hasText: /^Task completed!?/ });
    await expect(toast).toBeVisible();
    await expect(toast).toHaveAttribute('aria-live', 'polite');
    expect(await page.evaluate(() => document.activeElement?.closest('[aria-label="Notifications"]') !== null), 'appearance does not take focus into the deck').toBe(false);
    await toast.getByRole('button', { name: 'Dismiss notification' }).focus();
    await axe(page, '[role="region"][aria-label="Notifications"]', info);
    expect(errors).toEqual([]);
  });

  test('six different real UI notices keep a three-card deck, expand without overlaps, and retain only the newest five', async ({ browser: _browser }, info) => {
    const errors = recordPageErrors(page);
    const categoryName = 'Notice deck ' + randomUUID().slice(0, 8);
    const taskTitle = 'Notice deck task ' + randomUUID().slice(0, 8);
    let categoryId: string | undefined;
    const writes: Array<{ method: string; path: string; status: number; atMs: number }> = [];
    const began = Date.now();
    const noticeItems = notices(page).locator('[data-toast-id]');
    const snapshot = () => noticeItems.evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return {
        title: element.querySelector('[data-toast-body] p > span')?.textContent ?? '',
        opacity: Number(getComputedStyle(element).opacity),
        top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left,
      };
    }));
    const pressWrite = async (method: string, path: string, control: Locator) => {
      await expect(control).toBeVisible();
      const received = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method);
      await control.focus();
      await control.press('Enter');
      const response = await received;
      writes.push({ method, path, status: response.status(), atMs: Date.now() - began });
      if (response.status() === 400) {
        const body = await response.json().catch(() => ({})) as Json;
        const error = (body.error ?? {}) as Json;
        const validation = (body.errors ?? body.validationErrors ?? error.errors ?? {}) as Json;
        const text = [typeof error.message === 'string' ? error.message : '', ...Object.values(validation).flat().filter(value => typeof value === 'string')].join(' ');
        const knownFields = ['Name', 'Description', 'Color', 'Icon', 'DisplayOrder', 'Title', 'Status', 'Priority', 'CategoryId', 'DueDate', 'ExpectedDate', 'IsPublic', 'SharedWithUserIds'];
        const fields = knownFields.filter(field => Object.keys(validation).some(key => key.toLowerCase() === field.toLowerCase()) || new RegExp('\\b' + field + '\\s*:', 'i').test(text));
        const knownMessages = ['Category name is required', 'Category name cannot exceed 50 characters', 'Description cannot exceed 500 characters', 'Invalid color format', 'Display order must be zero or greater'];
        // Persist only public field names, known validator messages and a bounded code.
        // Raw responses, headers, cookies and fixture authorization never enter evidence.
        await evidence(info, 'ui-validation-400', {
          method, path, status: 400,
          code: typeof error.code === 'string' && /^[a-z0-9_.-]{1,80}$/i.test(error.code) ? error.code : undefined,
          fields, messages: knownMessages.filter(message => text.includes(message)),
        });
      }
      expect(response.ok(), 'real UI mutation ' + method + ' ' + path + ': HTTP ' + response.status()).toBe(true);
      if (response.status() === 204) return {} as Json;
      const raw = await response.json() as Json;
      return (raw.value ?? raw.data ?? raw) as Json;
    };
    const expectTitles = async (titles: string[]) => {
      await expect.poll(async () => (await snapshot()).map(item => item.title).sort()).toEqual([...titles].sort());
    };
    const hoverDeck = async () => {
      const deck = notices(page).locator('ol');
      const rect = (await deck.boundingBox())!;
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height - 8);
    };
    const firstFour = ['Category created', 'Category deleted', 'Task created', 'Task completed'];

    try {
      await page.goto('/categories');
      const createCategory = page.getByRole('button', { name: 'New category', exact: true });
      await expect(createCategory).toBeVisible();
      await createCategory.focus();
      await createCategory.press('Enter');
      const categoryDialog = page.getByRole('dialog', { name: 'New category', exact: true });
      const categoryNameInput = categoryDialog.getByRole('textbox', { name: 'Name', exact: true });
      await expect(categoryNameInput).toBeVisible();
      await categoryNameInput.fill(categoryName);
      // The API accepts six-digit hex; choose it through the actual colour field.
      const categoryColour = categoryDialog.getByRole('textbox', { name: 'Hex colour', exact: true });
      await expect(categoryColour).toBeVisible();
      await categoryColour.fill('0ea5e9');
      await expect(categoryColour).toHaveValue('0ea5e9');
      const category = await pressWrite('POST', '/categories/api/v1/categories', categoryDialog.getByRole('button', { name: 'Create category', exact: true }));
      expect(typeof category.id).toBe('string');
      categoryId = category.id as string;
      await expectTitles(['Category created']);
      // Keep a real pointer over the higher toast layer while keyboard actions
      // use the forms below it. The app itself pauses every existing clock.
      await hoverDeck();
      await expect(categoryDialog).toHaveCount(0);
      const deleteCategory = page.getByRole('button', { name: 'Delete category ' + categoryName, exact: true }).filter({ visible: true });
      await expect(deleteCategory).toBeVisible();
      await deleteCategory.focus();
      await deleteCategory.press('Enter');
      const confirm = page.getByRole('dialog', { name: 'Delete Category?', exact: true });
      await pressWrite('DELETE', '/categories/api/v1/categories/' + categoryId, confirm.getByRole('button', { name: 'Delete Category', exact: true }));
      await expectTitles(['Category created', 'Category deleted']);

      const tasksLink = page.getByTestId('navbar-desktop').locator('a[href="/tasks"]');
      await expect(tasksLink).toBeVisible();
      await tasksLink.focus();
      await tasksLink.press('Enter');
      await expect(page).toHaveURL(/\/tasks$/);
      const openCreate = page.getByRole('button', { name: 'Open create task panel', exact: true });
      await expect(openCreate).toBeVisible();
      await openCreate.focus();
      await openCreate.press('Enter');
      await page.getByPlaceholder('What needs to be done?', { exact: true }).fill(taskTitle);
      const task = await pressWrite('POST', '/todos/api/v1/todos', page.getByRole('button', { name: 'Create task', exact: true }));
      expect(typeof task.id).toBe('string');
      fixtures.push({ actor: owner, id: task.id as string });
      await expectTitles(firstFour.slice(0, 3));
      await pressWrite('PUT', '/todos/api/v1/todos/' + task.id, cardFor(page, taskTitle).getByRole('button', { name: 'Take it – start working', exact: true }));
      await expectTitles(firstFour.slice(0, 3));
      await pressWrite('PUT', '/todos/api/v1/todos/' + task.id, cardFor(page, taskTitle).getByRole('button', { name: 'Mark as complete', exact: true }));
      await expectTitles(firstFour);

      // Release both genuine reading affordances to inspect the closed deck.
      await expect(tasksLink).toBeVisible();
      await tasksLink.focus();
      await page.mouse.move(2, 2);
      await expect.poll(async () => (await snapshot()).filter(item => item.opacity > 0.95).length).toBe(3);
      const collapsedFour = await snapshot();
      expect(collapsedFour[0].title, 'the last real mutation is the deck front').toBe('Task completed');
      await hoverDeck();
      await expect.poll(async () => (await snapshot()).every(item => item.opacity > 0.95)).toBe(true);
      await expect.poll(async () => {
        const items = (await snapshot()).sort((a, b) => a.top - b.top);
        return items.every((item, index) => index === 0 || item.top >= items[index - 1].bottom);
      }, { message: 'all four expanded notice border-boxes are disjoint' }).toBe(true);
      const expandedFour = await snapshot();
      expect([...expandedFour].sort((a, b) => a.top - b.top).at(-1)?.title).toBe('Task completed');
      await notices(page).screenshot({ path: info.outputPath('deck-four-expanded.png') });

      const completed = page.getByRole('button', { name: /^Completed\s+\d+$/ });
      await expect(completed).toBeVisible();
      await completed.focus();
      await completed.press('Enter');
      const completedCard = cardFor(page, taskTitle).filter({ has: page.getByRole('button', { name: 'Mark as incomplete', exact: true }) });
      await completedCard.getByRole('heading', { name: taskTitle, exact: true }).click();
      await hoverDeck();
      const editor = page.getByRole('dialog');
      const menu = editor.getByRole('button', { name: 'Add a subtask or attachment', exact: true });
      await expect(menu).toBeVisible();
      await menu.focus();
      await menu.press('Enter');
      const duplicate = await pressWrite('POST', '/todos/api/v1/todos/' + task.id + '/duplicate', editor.getByRole('button', { name: /^Duplicate task/ }));
      expect(typeof duplicate.id).toBe('string');
      fixtures.push({ actor: owner, id: duplicate.id as string });
      await expect(editor).toHaveCount(0);
      await expectTitles([...firstFour, 'Task duplicated']);
      await pressWrite('PUT', '/todos/api/v1/todos/' + task.id, completedCard.getByRole('button', { name: 'Mark as incomplete', exact: true }));
      const retained = ['Category deleted', 'Task created', 'Task completed', 'Task duplicated', 'Task reopened'];
      await expectTitles(retained);
      await expect(noticeItems).toHaveCount(5);
      await expect.poll(async () => {
        const items = (await snapshot()).sort((a, b) => a.top - b.top);
        return items.every((item, index) => index === 0 || item.top >= items[index - 1].bottom);
      }).toBe(true);
      const expandedFive = await snapshot();
      expect([...expandedFive].sort((a, b) => a.top - b.top).at(-1)?.title).toBe('Task reopened');
      await notices(page).screenshot({ path: info.outputPath('deck-five-expanded.png') });
      await expect(tasksLink).toBeVisible();
      await tasksLink.focus();
      await page.mouse.move(2, 2);
      await expect.poll(async () => (await snapshot()).filter(item => item.opacity > 0.95).length).toBe(3);
      const collapsedFive = await snapshot();
      await notices(page).screenshot({ path: info.outputPath('deck-five-collapsed.png') });
      await evidence(info, 'real-notice-deck', { writes, collapsedFour, expandedFour, expandedFive, collapsedFive, retained, browser: context.browser()?.version() });
      expect(errors).toEqual([]);
    } finally {
      // Only this disposable category is eligible for cleanup if the UI failed
      // before its confirmed deletion. The task IDs use the suite's own cleanup.
      if (categoryId) {
        const response = await api(owner, 'delete', '/categories/api/v1/categories/' + categoryId);
        expect([200, 204, 404], 'disposable deck category cleanup').toContain(response.status());
      }
    }
  });
  test('Undo restores a removed real task and no DELETE reaches the gateway', async ({ browser: _browser }, info) => {
    const task = await ownTask('Notice undo');
    await loadTask(task.title);
    const deletes: number[] = [];
    page.on('request', request => { if (request.method() === 'DELETE' && new URL(request.url()).pathname === '/todos/api/v1/todos/' + task.id) deletes.push(Date.now()); });
    await deleteCard(page, task.title);
    await expect(cardFor(page, task.title)).toHaveCount(0);
    const undo = notices(page).getByRole('button', { name: 'Undo', exact: true });
    await expect(undo).toBeVisible();
    await expect(notices(page).locator('.toast-countdown')).toHaveCount(1);
    await undo.click();
    await expect(cardFor(page, task.title)).toBeVisible();
    await page.waitForTimeout(5_200);
    expect(deletes).toHaveLength(0);
    const persisted = await api(owner, 'get', '/todos/api/v1/todos/' + task.id);
    expect(persisted.ok()).toBe(true);
    await evidence(info, 'undo-network', { deleteCount: deletes.length, taskRestored: true });
  });

  for (const input of ['pointer', 'keyboard'] as const) {
    test(input + ' pauses the real DELETE and ring for eight seconds, then uses the remaining window once', async ({ browser: _browser }, info) => {
      const task = await ownTask('Notice hold ' + input);
      await loadTask(task.title);
      const deletes: number[] = [];
      page.on('request', request => { if (request.method() === 'DELETE' && new URL(request.url()).pathname === '/todos/api/v1/todos/' + task.id) deletes.push(Date.now()); });
      const began = Date.now();
      await deleteCard(page, task.title);
      const undo = notices(page).getByRole('button', { name: 'Undo', exact: true });
      await expect(undo).toBeVisible();
      await page.waitForTimeout(750);
      if (input === 'pointer') await undo.hover(); else await undo.focus();
      const ring = notices(page).locator('.toast-countdown');
      await expect(ring).toHaveCSS('animation-play-state', 'paused');
      const heldAt = Date.now();
      const offset = await ring.evaluate(element => getComputedStyle(element).strokeDashoffset);
      await page.waitForTimeout(8_200);
      expect(deletes).toHaveLength(0);
      expect(await ring.evaluate(element => getComputedStyle(element).strokeDashoffset)).toBe(offset);
      await page.mouse.move(2, 2);
      if (input === 'keyboard') await page.getByTestId('navbar-desktop').locator('a[href="/tasks"]').focus();
      const releasedAt = Date.now();
      const response = page.waitForResponse(result => new URL(result.url()).pathname === '/todos/api/v1/todos/' + task.id && result.request().method() === 'DELETE', { timeout: 7_000 });
      await page.waitForTimeout(1_000);
      expect(deletes, 'release does not commit before the remaining undo time').toHaveLength(0);
      expect((await response).ok()).toBe(true);
      await page.waitForTimeout(600);
      expect(deletes).toHaveLength(1);
      const remaining = Math.max(0, 5_000 - (heldAt - began));
      expect(deletes[0] - releasedAt).toBeGreaterThanOrEqual(remaining - 250);
      await evidence(info, 'paused-undo-network', { input, heldMs: releasedAt - heldAt, remainingMs: remaining, releasedToDeleteMs: deletes[0] - releasedAt, deleteCount: deletes.length });
    });
  }

  test('unheld expiry issues exactly one real DELETE', async ({ browser: _browser }, info) => {
    const task = await ownTask('Notice expiry');
    await loadTask(task.title);
    const deletes: number[] = [];
    page.on('request', request => { if (request.method() === 'DELETE' && new URL(request.url()).pathname === '/todos/api/v1/todos/' + task.id) deletes.push(Date.now()); });
    const response = page.waitForResponse(result => new URL(result.url()).pathname === '/todos/api/v1/todos/' + task.id && result.request().method() === 'DELETE', { timeout: 8_000 });
    const began = Date.now();
    await deleteCard(page, task.title);
    await page.mouse.move(2, 2);
    expect((await response).ok()).toBe(true);
    await page.waitForTimeout(800);
    expect(deletes).toHaveLength(1);
    expect(deletes[0] - began).toBeGreaterThanOrEqual(4_800);
    await evidence(info, 'expiry-network', { deleteCount: deletes.length, elapsedMs: deletes[0] - began });
  });

  for (const method of ['close', 'escape', 'left', 'right'] as const) {
    test(method + ' dismisses a notice through a real task action', async ({ browser: _browser }, info) => {
      const task = await ownTask('Notice dismiss ' + method);
      await loadTask(task.title);
      const deletePath = '/todos/api/v1/todos/' + task.id;
      const deletes: number[] = [];
      const deleteStatuses: number[] = [];
      page.on('request', request => {
        if (request.method() === 'DELETE' && new URL(request.url()).pathname === deletePath) deletes.push(Date.now());
      });
      page.on('response', response => {
        if (response.request().method() === 'DELETE' && new URL(response.url()).pathname === deletePath) deleteStatuses.push(response.status());
      });
      await deleteCard(page, task.title);
      const notice = notices(page).locator('[data-toast-id]').filter({ has: page.getByRole('button', { name: 'Undo', exact: true }) });
      await expect(notice).toBeVisible();
      let positions: number[] | undefined;
      if (method === 'close') await notice.getByRole('button', { name: 'Dismiss notification' }).click();
      else if (method === 'escape') { await notice.getByRole('button', { name: 'Undo', exact: true }).focus(); await page.keyboard.press('Escape'); }
      else positions = await swipe(page, notice, method === 'left' ? -1 : 1);
      await expect(notice).toHaveCount(0);
      await evidence(info, 'notice-dismissal-gesture', { method, x: positions });
      // Closing the offer is not Undo. The delayed operation must still complete.
      await page.mouse.move(2, 2);
      await page.waitForTimeout(5_400);
      try {
        await expect.poll(() => deleteStatuses.length, { message: method + ' receives a real DELETE response' }).toBe(1);
      } finally {
        await evidence(info, 'notice-dismissal-network', { method, deleteCount: deletes.length, deleteStatuses });
      }
      expect(deletes, method + ' sends exactly one DELETE before fixture cleanup').toHaveLength(1);
      expect(deleteStatuses[0], method + ' DELETE succeeds').toBeGreaterThanOrEqual(200);
      expect(deleteStatuses[0], method + ' DELETE succeeds').toBeLessThan(300);
      const persisted = await api(owner, 'get', deletePath);
      expect(persisted.status(), method + ' task is absent before fixture cleanup').toBe(404);
      await evidence(info, 'notice-dismissal', { method, x: positions, deleteCount: deletes.length, deleteStatuses, persistedStatus: persisted.status() });
    });
  }

  for (const surface of ['/dashboard', '/tasks']) {
    test('390px dock clearance above capture and selection on ' + surface, async ({ browser: _browser }, info) => {
      const first = await ownTask('Notice dock first', true);
      const second = await ownTask('Notice dock second');
      await page.setViewportSize({ width: 390, height: 844 });
      await loadTask(first.title, surface);
      const complete = cardFor(page, first.title).getByRole('button', { name: 'Mark as complete', exact: true });
      await expect(complete).toBeVisible();
      await complete.click();
      await expect(notices(page).locator('[data-toast-id]').first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'New task', exact: true })).toBeVisible();
      const measure = async (label: string) => {
        const geometry = await page.evaluate(() => {
          const notice = document.querySelector('[aria-label="Notifications"] [data-toast-id]')?.getBoundingClientRect();
          const bubble = document.querySelector('[aria-label="New task"]')?.getBoundingClientRect();
          const selection = document.querySelector('[aria-label="Clear the selection"]')?.closest('[role="status"]')?.getBoundingClientRect();
          return { label: '', clearance: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pl-dock-clearance')), noticeBottom: notice?.bottom, bubbleTop: bubble?.top, selectionTop: selection?.top };
        });
        geometry.label = label;
        expect(geometry.clearance).toBeGreaterThan(0);
        expect(geometry.noticeBottom).toBeLessThanOrEqual(Math.min(geometry.bubbleTop ?? Infinity, geometry.selectionTop ?? Infinity));
        return geometry;
      };
      await page.waitForTimeout(450);
      const result = [await measure('capture')];
      if (surface === '/tasks') {
        const row = cardFor(page, second.title).locator('..');
        await expect(row).toBeVisible();
        await expect(row).toHaveAttribute('tabindex', /^(?:0|-1)$/);
        await row.focus();
        await expect(row).toBeFocused();
        // Programmatic focus seats a hidden cursor; the documented select-all key
        // explicitly shows it and gathers the real active rows on mobile as well.
        await page.keyboard.press('ControlOrMeta+a');
        await expect(row).toHaveAttribute('data-selected', '');
        await expect(page.getByRole('button', { name: 'Clear the selection', exact: true })).toBeVisible();
        await page.waitForTimeout(450);
        result.push(await measure('selection'));
      }
      await noHorizontalOverflow(page);
      await evidence(info, 'mobile-dock', result);
      await page.screenshot({ path: info.outputPath('mobile-dock.png') });
    });
  }

  test('authenticated 404 offers Dashboard and palette; the zero returns to Dashboard', async ({ browser: _browser }, info) => {
    await gotoMissing(page);
    await expect(page.getByRole('link', { name: /^Dashboard/ })).toHaveAttribute('href', '/dashboard');
    await expect(page.getByRole('link', { name: /^Sign in/ })).toHaveCount(0);
    await page.getByRole('button', { name: /^Find it/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await axe(page, 'main', info);
    await page.getByRole('button', { name: 'Go to your dashboard', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('random and another owner private branches show the same missing-task scene', async ({ browser: _browser }, info) => {
    const privateTask = await createTask(stranger, 'Private missing branch');
    fixtures.push({ actor: stranger, id: privateTask.id });
    const statuses: number[] = [];
    for (const id of [randomUUID(), privateTask.id]) {
      const response = page.waitForResponse(result => new URL(result.url()).pathname === '/todos/api/v1/todos/' + id && result.request().method() === 'GET');
      await page.goto('/branch/' + id);
      statuses.push((await response).status());
      expect([403, 404]).toContain(statuses.at(-1));
      await expect(page.getByRole('heading', { name: "This task isn't here.", exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: /^Your tasks/ })).toHaveAttribute('href', '/tasks');
      await expect(page.getByTestId('navbar-desktop')).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await noHorizontalOverflow(page);
      await axe(page, 'section[aria-labelledby="error-title"]', info);
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    await evidence(info, 'missing-branch-statuses', statuses);
  });

  test('a genuine disposable todo-service outage emits one assertive notice with a repetition count', async ({ browser: _browser }, info) => {
    const container = process.env.E2E_DISPOSABLE_TODO_CONTAINER;
    test.skip(!container, 'Set E2E_DISPOSABLE_TODO_CONTAINER to an explicitly owned disposable container to exercise a real outage.');
    if (!container || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(container)) throw new Error('Invalid explicitly selected disposable container');
    const project = process.env.E2E_DISPOSABLE_PROJECT;
    if (!project) throw new Error('E2E_DISPOSABLE_PROJECT is required when E2E_DISPOSABLE_TODO_CONTAINER is set');
    if (!/^planora-(?:e2e[a-z0-9_-]*|codex-[a-z0-9][a-z0-9_-]*)$/.test(project)) throw new Error('E2E_DISPOSABLE_PROJECT must name a planora-e2e* or planora-codex-* disposable project');
    // Inspect only ownership and running state; never read or log Config.Env.
    const inspected = await runFile('docker', ['inspect', '--type', 'container', '--format', '{"Id":{{json .Id}},"Running":{{json .State.Running}},"Project":{{json (index .Config.Labels "com.docker.compose.project")}},"Service":{{json (index .Config.Labels "com.docker.compose.service")}}}', container], { timeout: 15_000 });
    const metadata = JSON.parse(inspected.stdout.trim()) as { Id?: unknown; Running?: unknown; Project?: unknown; Service?: unknown };
    expect(typeof metadata.Id === 'string' && /^[a-f0-9]{64}$/.test(metadata.Id), 'Docker returns the immutable full container ID').toBe(true);
    expect(metadata.Project, 'container belongs to the explicitly declared disposable compose project').toBe(project);
    expect(metadata.Service, 'container is the Todo service').toBe('todo-api');
    expect(metadata.Running, 'only a currently running disposable service may be stopped').toBe(true);
    const verifiedId = metadata.Id as string;
    const task = await ownTask('Notice outage', true);
    await loadTask(task.title);
    const complete = cardFor(page, task.title).getByRole('button', { name: 'Mark as complete', exact: true });
    await expect(complete).toBeVisible();
    try {
      await runFile('docker', ['stop', verifiedId], { timeout: 60_000 });
      for (let attempt = 0; attempt < 2; attempt++) {
        const failed = page.waitForResponse(response => new URL(response.url()).pathname === '/todos/api/v1/todos/' + task.id && response.request().method() === 'PUT');
        await expect(complete).toBeVisible();
        await complete.click();
        expect((await failed).status()).toBeGreaterThanOrEqual(500);
        const alert = notices(page).getByRole('alert');
        await expect(alert).toHaveCount(1);
        await expect(alert).toHaveAttribute('aria-live', 'assertive');
        await alert.getByRole('button', { name: 'Dismiss notification' }).focus();
      }
      await expect(notices(page).getByRole('alert')).toHaveText(/×2/);
      await evidence(info, 'real-outage', { attempts: 2, assertiveNotices: 1, repeated: true });
    } finally { await runFile('docker', ['start', verifiedId], { timeout: 60_000 }); }
  });

  test('categories chunk HTTP500 investigation records the actual fallback and verifies recovery when the segment scene appears', async ({ browser: _browser }, info) => {
    const probeContext = await context.browser()!.newContext({ baseURL: FRONTEND_BASE, storageState: owner.storage });
    const probe = await probeContext.newPage();
    let taskScripts: string[];
    let categoryScripts: string[];
    let chunks: string[];
    try {
      await probe.goto('/tasks');
      await expect(probe.getByRole('heading', { name: 'Tasks', exact: true, level: 1 })).toBeVisible({ timeout: 30_000 });
      taskScripts = await probe.locator('script[src]').evaluateAll(elements => elements.map(element => (element as HTMLScriptElement).src));
      await probe.goto('/categories');
      await expect(probe.getByRole('heading', { name: 'Categories', exact: true, level: 1 })).toBeVisible({ timeout: 30_000 });
      categoryScripts = await probe.locator('script[src]').evaluateAll(elements => elements.map(element => (element as HTMLScriptElement).src));
      chunks = categoryScripts.filter(url => url.includes('/_next/static/') && !taskScripts.includes(url));
    } finally {
      try {
        // The probe's real session restore rotates its refresh cookie. Reuse only
        // this fixture's newest cookies in memory before loading the action page.
        const cookies = await probeContext.cookies();
        owner.storage = { ...owner.storage, cookies };
        await owner.context.addCookies(cookies);
        await context.addCookies(cookies);
      } finally { await probeContext.close(); }
    }
    const scriptPaths = {
      tasks: taskScripts.map(url => new URL(url).pathname),
      categories: categoryScripts.map(url => new URL(url).pathname),
      categoryOnly: chunks.map(url => new URL(url).pathname),
    };
    await evidence(info, 'segment-chunk-scripts', scriptPaths);
    test.skip(chunks.length === 0, 'Production bundle exposes no separate category script; chunk-failure investigation is inconclusive.');
    const blocked: string[] = [];
    await page.route('**/_next/static/**', async route => {
      if (!chunks.includes(route.request().url())) { await route.continue(); return; }
      await route.fulfill({ status: 500, contentType: 'application/javascript', body: '' });
      blocked.push(new URL(route.request().url()).pathname);
    });
    try {
      await page.goto('/tasks');
      // Navbar mounts outside AuthGuard; the real Tasks heading proves session restoration.
      await expect(page.getByRole('heading', { name: 'Tasks', exact: true, level: 1 })).toBeVisible({ timeout: 30_000 });
      await expect(page).toHaveURL(/\/tasks$/);
      await expect(page.getByTestId('navbar-desktop')).toBeVisible();
      const categoriesLink = page.getByTestId('navbar-desktop').locator('a[href="/categories"]');
      await expect(categoriesLink).toBeVisible();
      await categoriesLink.click({ timeout: 10_000 });
      const scene = page.getByRole('heading', { name: 'Something went wrong while loading categories.', exact: true });
      // Allow the client transition to settle, including its observed full-page fallback.
      // Absence of this scene is an investigation result, never a claimed recovery.
      await Promise.race([
        scene.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined),
        page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined),
      ]);
      const observation = {
        actualURL: page.url(),
        headings: await page.locator('h1, h2').allTextContents(),
        navbarPresent: await page.getByTestId('navbar-desktop').isVisible(),
        sceneVisible: await scene.isVisible(),
        blockedCount: blocked.length,
        blocked: [...blocked],
        scriptPaths,
      };
      await page.screenshot({ path: info.outputPath('segment-chunk-observed.png') });
      await evidence(info, 'segment-chunk-observation', observation);
      test.skip(blocked.length === 0, 'No category-only chunk request was intercepted; it may already be prefetched or cached. Static HTTP500 and its fallback were not exercised, so this investigation is inconclusive.');
      expect(blocked.length, 'the investigation follows at least one successfully fulfilled static HTTP500').toBeGreaterThan(0);
      if (observation.sceneVisible) {
        await expect(page.getByTestId('navbar-desktop')).toBeVisible();
        await page.unroute('**/_next/static/**');
        await page.getByRole('button', { name: /^Retry/ }).click();
        await expect(page.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible();
        await evidence(info, 'segment-chunk-failure', { ...observation, recovered: true });
      } else {
        const observedFallback = new URL(observation.actualURL).pathname === '/auth/login' ? 'Sign in' : observation.headings.join(' | ');
        info.annotations.push({ type: 'investigation', description: 'Static HTTP500 did not render the Planora categories segment scene. Observed fallback: ' + observedFallback + '. Retry recovery was not exercised; see segment-chunk-observation.' });
        await evidence(info, 'segment-chunk-failure', { ...observation, observedFallback, recoveryAttempted: false });
      }
    } finally { await page.unroute('**/_next/static/**'); }
  });

  test('offline client navigation investigation records the actual scene and online recovery', async ({ browser: _browser }, info) => {
    await page.goto('/tasks');
    // The bar alone is insufficient: it renders before AuthGuard restores the session.
    await expect(page.getByRole('heading', { name: 'Tasks', exact: true, level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByTestId('navbar-desktop')).toBeVisible();
    const categoriesLink = page.getByTestId('navbar-desktop').locator('a[href="/categories"]');
    await expect(categoriesLink).toBeVisible();
    // This is a real transport outage, including whatever Next has already prefetched.
    await context.setOffline(true);
    try {
      await categoriesLink.click({ timeout: 10_000 });
      await page.waitForTimeout(2_000);
      const ours = await page.getByRole('heading', { name: "You're offline.", exact: true }).isVisible();
      const observation = { ours, pathname: new URL(page.url()).pathname, headings: await page.locator('h1').allTextContents(), browserOnline: await page.evaluate(() => navigator.onLine) };
      await evidence(info, 'offline-navigation', observation);
      await page.screenshot({ path: info.outputPath('offline-navigation.png') });
      await context.setOffline(false);
      if (ours) {
        await expect(page.getByRole('heading', { name: "You're offline.", exact: true })).toHaveCount(0, { timeout: 15_000 });
        await expect(page.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible();
      } else {
        info.annotations.push({ type: 'investigation', description: 'The offline client transition did not render the Planora offline scene; see offline-navigation artifact.' });
      }
    } finally { await context.setOffline(false); }
  });
});
