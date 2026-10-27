import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test';
import { FRONTEND_BASE, requireFrontendReachable } from './_helpers';
import { GeometryRateBudget } from './_card-geometry';
import { APIchecked, createMotionFixtures, disposeMotionFixtures, refreshActor, setHiddenFixture, type Actor, type MotionFixtures } from './_motion-fixtures';
import { assertHeight, assertScroll, finishFrames, installMotionFrames, markAction, saveEvidence, startFrames, watchRequests } from './_motion-frames';
import { checkModal, checkPagination } from './_motion-pagination-modal';

// Production only: dev React and hidden scrollbars change the geometry being measured.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });
const desktop = { width: 1440, height: 900 };
const mobile = { width: 390, height: 844 };
const targetSelector = '[data-motion-target]';
let fixtures: MotionFixtures;
let lastContextStart = 0;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await requireFrontendReachable();
  fixtures = await createMotionFixtures(browser);
  // Registration, verification and seeding consumed the real gateway windows.
  await new Promise(resolve => setTimeout(resolve, 60_100));
});
test.afterAll(async () => { if (fixtures) await disposeMotionFixtures(fixtures); });

async function screenshot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(name + '.png');
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

async function onPage(
  browser: Browser, actor: Actor, info: TestInfo, name: string,
  options: { surface?: '/dashboard' | '/tasks'; viewport?: typeof desktop; touch?: boolean; reduced?: boolean },
  run: (page: Page) => Promise<void>,
) {
  // Pace setup outside the measured action to respect the real gateway's windows.
  const cooldown = 15_000 - (Date.now() - lastContextStart);
  if (cooldown > 0) await new Promise(resolve => setTimeout(resolve, cooldown));
  lastContextStart = Date.now();
  const context = await browser.newContext({ baseURL: FRONTEND_BASE, storageState: actor.storage,
    viewport: options.viewport ?? desktop, deviceScaleFactor: 1,
    hasTouch: options.touch ?? false, reducedMotion: options.reduced ? 'reduce' : 'no-preference' });
  await installMotionFrames(context);
  const page = await context.newPage();
  const budget = new GeometryRateBudget(page);
  try {
    await page.goto(options.surface ?? '/dashboard');
    await budget.loaded(async () => await page.locator('[data-task-card]').count() === 6);
    await page.waitForTimeout(800);
    await run(page);
  } catch (error) {
    await screenshot(page, info, name + '-failure');
    throw error;
  } finally {
    await saveEvidence(info, name + '-rate-limits', { events: budget.events, waits: budget.waits });
    actor.storage = await context.storageState();
    await context.close();
  }
}

async function markHiddenCard(page: Page): Promise<Locator> {
  const hidden = page.locator('[data-task-card]').filter({ has: page.getByRole('button', { name: 'Expand task card', exact: true }) });
  await expect(hidden, 'Only the selected real fixture is hidden').toHaveCount(1);
  await hidden.evaluate(element => element.setAttribute('data-motion-target', ''));
  const card = page.locator(targetSelector);
  await card.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(450);
  return card;
}

async function reveal(page: Page, info: TestInfo, name: string, hover: boolean, touch = false, reduced = false) {
  const card = await markHiddenCard(page);
  const requests = watchRequests(page);
  try {
    if (hover) {
      await card.hover();
      await page.waitForTimeout(150);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(350); // Let the unrelated -2px hover lift return to rest.
    }
    await startFrames(page, { cardSelector: targetSelector });
    await markAction(page);
    if (touch) await card.getByRole('button', { name: 'Expand task card', exact: true }).tap();
    else await card.getByRole('button', { name: 'Expand task card', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
    const evidence = await finishFrames(page, { minMs: 2500 });
    await saveEvidence(info, name, { ...evidence, requests: requests.events });
    await screenshot(page, info, name + '-settled');
    assertHeight(evidence, { oneStep: reduced, requireFollowing: true });
    const baseline = evidence.frames[0].card!.height;
    const firstGrowth = evidence.frames.find(frame => frame.card && frame.card.height > baseline + 0.02);
    expect.soft(firstGrowth?.card?.description, 'Description is in the DOM in the first growth frame').toBe(fixtures.privateTask.description);
    expect.soft(firstGrowth?.card?.dates, 'Date range is in the DOM in the first growth frame').toBe(true);
    expect.soft(firstGrowth?.card?.dateText, 'Both range bounds are present in the first growth frame').toMatch(/\b10\b.*–.*\b20\b/);
    expect.soft(firstGrowth?.card?.expectedText, 'The expected date arrives with the first growth frame').toMatch(/Expected.*\b15\b/);
    expect.soft(firstGrowth?.card?.expected, 'Expected date is present with the revealed content').toBe(true);
    expect.soft(firstGrowth?.card?.delay, 'Delay is present with the revealed content').toBe(true);
    const detail = requests.events.find(event => event.kind === 'request' && event.method === 'GET' && event.path.endsWith('/' + fixtures.privateTask.id));
    const patch = requests.events.find(event => event.kind === 'request' && event.method === 'PATCH' && event.path.endsWith('/hidden'));
    expect.soft(detail, 'The real private task is fetched').toBeDefined();
    expect.soft(patch, 'The owner writes the real hidden preference').toBeDefined();
    if (detail && patch) expect.soft(requests.events.indexOf(detail), 'GET is dispatched before or with PATCH').toBeLessThanOrEqual(requests.events.indexOf(patch));
    if (detail && patch) expect.soft(detail.epoch, 'GET starts no later than PATCH /hidden').toBeLessThanOrEqual(patch.epoch);
    if (reduced) expect.soft(evidence.bodyStyles.filter(style => /min-height\s*:/.test(style)), 'Reduced motion never assigns body minHeight').toEqual([]);
  } finally { requests.stop(); }
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function maskedReveal(page: Page, info: TestInfo, kind: 'shared' | 'viewer') {
  const item = kind === 'shared' ? fixtures.sharedTask : fixtures.viewerTask;
  const card = await markHiddenCard(page);
  const write = deferred(), read = deferred();
  let writeHeld = false, readHeld = false;
  const responses: Array<{ method: string; status: number; epoch: number }> = [];
  const requests = watchRequests(page);
  await page.route('**/todos/api/v1/todos/' + item.id + '**', async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const isWrite = method === 'PATCH' && path.endsWith(kind === 'shared' ? '/hidden' : '/viewer-preferences');
    const isRead = method === 'GET' && path.endsWith('/' + item.id);
    if (!isWrite && !isRead) return route.continue();
    const response = await route.fetch();
    responses.push({ method, status: response.status(), epoch: Date.now() });
    if (isWrite) { writeHeld = true; await write.promise; }
    if (isRead) { readHeld = true; await read.promise; }
    await route.fulfill({ response });
  });
  try {
    await startFrames(page, { cardSelector: targetSelector });
    await markAction(page);
    await card.getByRole('button', { name: 'Expand task card', exact: true }).click();
    await page.mouse.move(0, 0);
    await expect.poll(() => writeHeld, { message: 'Real PATCH response is being held' }).toBe(true);
    await page.waitForTimeout(450); // Longer than the private-owner 350ms deadline.
    await screenshot(page, info, kind + '-pending-write');
    expect.soft(await card.getByRole('button', { name: 'Expand task card', exact: true }).count(), 'Pending write keeps Expand').toBe(1);
    expect.soft(await card.getByRole('button', { name: 'Collapse task card', exact: true }).count(), 'Pending write never shows Collapse').toBe(0);
    const writeReleaseEpoch = Date.now();
    write.release();
    await expect.poll(() => readHeld, { message: 'Real GET response is being held' }).toBe(true);
    await page.waitForTimeout(450);
    await screenshot(page, info, kind + '-pending-read');
    expect.soft(await card.getByRole('button', { name: 'Expand task card', exact: true }).count(), 'Pending read keeps Expand').toBe(1);
    expect.soft(await card.getByRole('button', { name: 'Collapse task card', exact: true }).count(), 'Pending read never shows Collapse').toBe(0);
    const readReleaseEpoch = Date.now();
    read.release();
    const evidence = await finishFrames(page, { minMs: 3000 });
    await saveEvidence(info, kind + '-pending-reveal', { ...evidence, requests: requests.events, responses, writeReleaseEpoch, readReleaseEpoch });
    await screenshot(page, info, kind + '-revealed');
    assertHeight(evidence);
    const pending = evidence.frames.filter(frame => frame.epoch < readReleaseEpoch);
    expect.soft(pending.every(frame => frame.card?.expand && !frame.card.collapse), 'Both real responses must arrive before the open form').toBe(true);
    expect.soft(evidence.frames.filter(frame => frame.card?.collapse && frame.card.title === 'Hidden task'), 'No opened frame contains the redacted placeholder title').toEqual([]);
    const forms = evidence.frames.map(frame => frame.card?.collapse ?? false);
    expect.soft(forms.slice(1).filter((open, i) => open && !forms[i]), 'The card opens once').toHaveLength(1);
    expect.soft(evidence.frames.at(-1)?.card?.title).toBe(item.title);
    expect.soft(responses.every(response => response.status >= 200 && response.status < 300), 'Delayed payloads are genuine successful service responses').toBe(true);
  } finally { write.release(); read.release(); requests.stop(); }
}

async function bottomCollapse(page: Page, info: TestInfo) {
  const count = await page.locator('[data-task-card]').count();
  expect(count).toBe(6);
  await page.evaluate(() => {
    // A column is the placed cards that share a left edge (7532703); take the tallest one's last card.
    const byLeft = new Map<number, Element[]>();
    for (const placed of Array.from(document.querySelectorAll('[data-masonry-card]'))) {
      const left = Math.round(placed.getBoundingClientRect().left);
      byLeft.set(left, [...(byLeft.get(left) ?? []), placed]);
    }
    const bottom = (column: Element[]) => Math.max(...column.map(placed => placed.getBoundingClientRect().bottom));
    const tallest = Array.from(byLeft.values()).sort((a, b) => bottom(b) - bottom(a))[0];
    const last = tallest.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).at(-1)!;
    const card = last.querySelector('[data-task-card]')!;
    if (!card.querySelector('button[aria-label="Collapse task card"]')) throw new Error('Tallest-column bottom fixture is unexpectedly hidden');
    card.setAttribute('data-motion-target', '');
    card.setAttribute('data-motion-title', card.querySelector('h3')?.textContent ?? '');
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
  });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(600);
  const initialY = await page.evaluate(() => window.scrollY);
  expect(initialY, 'The real document has a scrollable bottom').toBeGreaterThan(20);
  await screenshot(page, info, 'bottom-before');
  await startFrames(page, { cardSelector: targetSelector });
  await markAction(page);
  // A click event at the visible bottom row avoids Playwright centring the tall card first.
  await page.locator(targetSelector).getByRole('button', { name: 'Collapse task card', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  const evidence = await finishFrames(page, { minMs: 3000 });
  await saveEvidence(info, 'bottom-collapse', evidence);
  await screenshot(page, info, 'bottom-after');
  assertHeight(evidence);
  assertScroll(evidence, 'up', 20);
  const last = evidence.frames.at(-1)!;
  expect.soft(last.scrollY, 'The final view reaches the actual new page bottom').toBeGreaterThanOrEqual(last.scrollHeight - last.innerHeight - 1);
  expect.soft(last.card!.top, 'The collapsed row is wholly in view').toBeGreaterThanOrEqual(0);
  expect.soft(last.card!.bottom).toBeLessThanOrEqual(last.innerHeight);
  expect.soft(Math.min(...evidence.frames.map(frame => frame.scrollY)), 'No frame returns to the page top').toBeGreaterThan(0);
}

async function keyboardReveal(page: Page, info: TestInfo) {
  const card = await markHiddenCard(page);
  // Tab is the sole way the target obtains focus; setup scroll is outside the measured action.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.tabIndex = -1;
    document.body.focus({ preventScroll: true });
  });
  let focused = false;
  for (let i = 0; i < 100; i++) {
    await page.keyboard.press('Tab');
    focused = await card.getByRole('button', { name: 'Expand task card', exact: true }).evaluate(button => button === document.activeElement);
    if (focused) break;
  }
  expect(focused, 'Tab reaches the actual hidden-card expander').toBe(true);
  await card.evaluate(element => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: Math.max(0, top - window.innerHeight + 70), behavior: 'instant' });
  });
  await page.waitForTimeout(300);
  const before = await card.getByRole('button', { name: 'Expand task card', exact: true }).boundingBox();
  expect(before!.y + before!.height, 'Hidden toggle starts near the viewport bottom').toBeGreaterThan(mobile.height - 100);
  await screenshot(page, info, 'keyboard-before');
  await startFrames(page, { cardSelector: targetSelector });
  await markAction(page);
  await page.keyboard.press('Enter');
  const evidence = await finishFrames(page, { minMs: 3000 });
  await saveEvidence(info, 'keyboard-reveal', evidence);
  await screenshot(page, info, 'keyboard-after');
  assertHeight(evidence, { keyboard: true }); // Known ~0.998 whileTap must not masquerade as height movement.
  assertScroll(evidence, 'down', 20);
  const last = evidence.frames.at(-1)!;
  expect.soft(last.activeLabel, 'Keyboard focus transfers to the collapse control').toBe('Collapse task card');
  expect.soft(last.card!.buttonTop, 'The focused button is wholly visible after growth').toBeGreaterThanOrEqual(0);
  expect.soft(last.card!.buttonBottom).toBeLessThanOrEqual(last.innerHeight);
}

// One attempt: the matrix may use its whole 30-minute limit, and each retry spent another 20
// minutes of the shard on the same scenarios — three attempts exhausted it before Playwright
// could print why the first one failed.
test.describe.configure({ retries: 0 });

// Every scenario has its own fresh browser context. Soft metric failures retain the
// rest of the matrix and its raw evidence without retrying Auth or hiding defects.
test('real services satisfy the motion regression matrix', async ({ browser }, info) => {
  // Seventeen scenarios on real services: on CI the matrix reached its last one at about 20 minutes
  // in one run and ran out before the eleventh in the next.
  test.setTimeout(1_800_000);
  info.annotations.push({ type: 'cpu-throttle', description: '1' });
  const run = async (name: string, action: () => Promise<void>) => {
    await test.step(name, async () => {
      console.info('[motion] ' + name);
      try { await action(); }
      catch (error) { expect.soft(error instanceof Error ? error.message : String(error), name + ' completed without a setup/action error').toBe('Scenario completed'); }
    });
  };
  for (const surface of ['/dashboard', '/tasks'] as const) {
    for (const viewport of [desktop, mobile]) {
      const prefix = surface.slice(1) + '-' + viewport.width;
      for (const touch of [false, true]) {
        const name = prefix + (touch ? '-touch' : '-hover');
        await run(name, async () => {
          await setHiddenFixture(fixtures, 'private');
          await onPage(browser, fixtures.owner, info, name, { surface, viewport, touch }, page => reveal(page, info, name, !touch, touch));
        });
      }
    }
  }
  for (const kind of ['shared', 'viewer'] as const) {
    await run(kind + '-pending', async () => {
      await setHiddenFixture(fixtures, kind);
      await onPage(browser, fixtures.owner, info, kind, {}, page => maskedReveal(page, info, kind));
    });
  }
  await run('bottom-collapse-desktop', async () => {
    await refreshActor(fixtures.pager);
    await onPage(browser, fixtures.pager, info, 'bottom', {}, async page => {
      try { await bottomCollapse(page, info); }
      finally {
        const title = await page.locator(targetSelector).getAttribute('data-motion-title');
        const task = fixtures.pagerTasks.find(task => task.title === title);
        if (task) await APIchecked(fixtures.pager, 'patch', '/todos/api/v1/todos/' + task.id + '/hidden', { hidden: false });
      }
    });
  });
  await run('pagination-desktop', async () => {
    await refreshActor(fixtures.pager);
    await onPage(browser, fixtures.pager, info, 'pagination', {}, page => checkPagination(page, info));
  });
  for (const reduced of [false, true]) {
    await run('modal-' + (reduced ? 'reduced' : 'normal'), async () => {
      await setHiddenFixture(fixtures, 'shared');
      await onPage(browser, fixtures.owner, info, 'modal-' + reduced, { reduced }, page => checkModal(page, info, fixtures.privateTask.title, { reduced }));
    });
  }
  await run('height-reduced', async () => {
    await setHiddenFixture(fixtures, 'private');
    await onPage(browser, fixtures.owner, info, 'reduced', { reduced: true }, async page => {
      await reveal(page, info, 'reduced-reveal', true, false, true);
      await startFrames(page, { cardSelector: targetSelector });
      await markAction(page);
      await page.locator(targetSelector).getByRole('button', { name: 'Collapse task card', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
      const evidence = await finishFrames(page);
      await saveEvidence(info, 'reduced-collapse', evidence);
      assertHeight(evidence, { oneStep: true });
      expect.soft(evidence.bodyStyles.filter(style => /min-height\s*:/.test(style)), 'Reduced hiding never assigns body minHeight').toEqual([]);
    });
  });
  await run('pagination-reduced', async () => {
    await refreshActor(fixtures.pager);
    await onPage(browser, fixtures.pager, info, 'pagination-reduced', { reduced: true }, page => checkPagination(page, info, { reduced: true }));
  });
  await run('keyboard-near-bottom', async () => {
    await setHiddenFixture(fixtures, 'private');
    await onPage(browser, fixtures.owner, info, 'keyboard', { surface: '/tasks', viewport: mobile }, page => keyboardReveal(page, info));
  });
});