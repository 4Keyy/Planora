import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, type Page, type Route, type TestInfo } from '@playwright/test';
import {
  assertScroll, finishFrames, markAction, saveEvidence, startFrames, watchRequests,
  type FrameEvidence, type MotionFrame,
} from './_motion-frames';

const LIST_PATH = '/todos/api/v1/todos';
const listMatcher = (url: URL) => url.pathname === LIST_PATH;
const pager = (page: Page) => page.getByRole('navigation', { name: 'Pagination', exact: true });
const normalize = (titles: string[]) => titles.map(title => title.replace(/\s+/g, ' ').trim());
const titles = async (page: Page) => normalize(await page.locator('[data-task-card] h3').allTextContents());

type Read = { page: number; requestedEpoch: number; fulfilledEpoch: number | null; status: number | null };
type Mode = { reduced?: boolean };
type HeadingView = { top: number; bottom: number; clearance: number; sectionOffset: number };
const evidenceName = (name: string, mode: Mode) => (mode.reduced ? 'reduced-' : '') + name;

function activePage(route: Route): number | null {
  const request = route.request();
  const url = new URL(request.url());
  if (request.method() !== 'GET' || url.searchParams.get('isCompleted') !== 'false'
    || url.searchParams.get('pageSize') !== '6') return null;
  return Number(url.searchParams.get('pageNumber'));
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function bounded(promise: Promise<void>, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + ' did not arrive within 30 seconds')), 30_000);
    })]);
  } finally { clearTimeout(timer); }
}

async function waitPage(page: Page, number: number) {
  await page.waitForFunction(number => {
    const list = document.querySelector('section[aria-labelledby="active-tasks-heading"]');
    return document.querySelector('nav[aria-label="Pagination"] [aria-current="page"]')?.getAttribute('aria-label') === 'Page ' + number
      && !list?.querySelector('[aria-busy="true"]') && list?.querySelectorAll('[data-task-card]').length === 6;
  }, number, { timeout: 30_000 });
}

async function preparePager(page: Page) {
  await pager(page).waitFor({ state: 'visible' });
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(750);
}

async function headingView(page: Page): Promise<HeadingView | null> {
  return page.evaluate(() => {
    const heading = document.querySelector<HTMLElement>('#active-tasks-heading');
    const section = heading?.closest('section');
    if (!heading || !section) return null;
    const box = heading.getBoundingClientRect();
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:var(--bar-clearance,0px);visibility:hidden;pointer-events:none';
    document.body.appendChild(probe);
    const clearance = probe.getBoundingClientRect().height;
    probe.remove();
    return { top: box.top, bottom: box.bottom, clearance, sectionOffset: box.top - section.getBoundingClientRect().top };
  });
}

async function pressPage(page: Page, label: string) {
  // The pager was put on screen before recording; this cannot add Playwright auto-scroll.
  await pager(page).getByRole('button', { name: label, exact: true }).evaluate((button: HTMLButtonElement) => button.click());
}

function assertPaginationFrames(evidence: FrameEvidence, mode: Mode, headingBefore?: HeadingView | null, scrollIntents = 1) {
  const frames = evidence.frames;
  expect.soft(frames.length, 'Pagination has actual sampled frames').toBeGreaterThan(16);
  expect.soft(frames.every(frame => frame.skeletons === 0), 'Paging retains the cards without a skeleton').toBe(true);
  expect.soft(frames.every(frame => frame.pagerTop !== null), 'The pager stays mounted').toBe(true);
  const pagerSteps = frames.slice(1).map((frame, i) => frame.pagerTop === null || frames[i].pagerTop === null
    ? Number.POSITIVE_INFINITY : Math.abs(frame.pagerTop - frames[i].pagerTop!));
  if (!mode.reduced) {
    expect.soft(Math.max(0, ...pagerSteps), 'Pager document displacement is at most 40px in every drawn frame').toBeLessThanOrEqual(40);
  } else {
    expect.soft(pagerSteps.filter(step => step > 0.02).length, 'Reduced paging changes grid height in at most one step').toBeLessThanOrEqual(1);
  }
  assertScroll(evidence, 'up');
  if (mode.reduced) {
    expect.soft(evidence.scrollCalls.some(call => call.behavior === 'smooth'), 'Reduced paging never requests smooth scrolling').toBe(false);
    expect.soft(new Set(evidence.scrollCalls.map(call => call.top)).size, 'Reduced paging has at most one programmatic scroll destination per explicit page change').toBeLessThanOrEqual(scrollIntents);
    for (const call of evidence.scrollCalls) {
      const first = frames.find(frame => frame.time >= call.time);
      if (first) {
        const target = Math.max(0, Math.min(call.top, first.scrollHeight - first.innerHeight));
        expect.soft(Math.abs(first.scrollY - target), 'Reduced scroll reaches its requested destination in the first drawn frame').toBeLessThanOrEqual(1);
      }
    }
    expect.soft(frames.every(frame => frame.bodyMinHeight === ''), 'Reduced paging never reserves document height').toBe(true);
    expect.soft(evidence.bodyStyles.some(style => /\bmin-height\s*:/.test(style)), 'No transient reduced-motion body height hold').toBe(false);
  }
  expect.soft(frames.at(-1)?.bodyMinHeight, 'The document height hold is released after paging').toBe('');
  if (headingBefore !== undefined) {
    const last = frames.at(-1);
    expect.soft(headingBefore, 'A successful page change starts with the Active tasks heading').not.toBeNull();
    expect.soft(last?.headingTop, 'The Active tasks heading is still mounted after paging').not.toBeNull();
    expect.soft(last?.headingBottom, 'The full heading has a measured bottom edge').not.toBeNull();
    if (headingBefore && last?.headingTop !== null && last?.headingTop !== undefined
      && last.headingBottom !== null) {
      expect.soft(last.headingTop, 'The heading is fully visible below the floating bar').toBeGreaterThanOrEqual(headingBefore.clearance);
      expect.soft(last.headingBottom, 'The whole heading fits inside the viewport').toBeLessThanOrEqual(last.innerHeight);
      if (headingBefore.top < 0) {
        expect.soft(frames[0].scrollY - last.scrollY, 'An initially offscreen heading requires actual upward movement').toBeGreaterThan(0);
        const documentTop = last.headingTop + last.scrollY;
        const desiredScroll = Math.max(0, documentTop - headingBefore.sectionOffset - headingBefore.clearance - 12);
        // A shorter page may cap the reachable scroll: compare with that physical limit.
        const reachableScroll = Math.min(desiredScroll, Math.max(0, last.scrollHeight - last.innerHeight));
        expect.soft(Math.abs(last.headingTop - (documentTop - reachableScroll)), 'The heading lands at the bar clearance or the reachable page boundary').toBeLessThanOrEqual(1);
      }
    }
  }
}

async function delayedPage(page: Page, info: TestInfo, label: string, target: number, name: string, mode: Mode) {
  await preparePager(page);
  const headingBefore = await headingView(page);
  const before = await titles(page);
  const entered = gate();
  const reads: Read[] = [];
  const handler = async (route: Route) => {
    const number = activePage(route);
    if (number === null) { await route.continue(); return; }
    const read: Read = { page: number, requestedEpoch: Date.now(), fulfilledEpoch: null, status: null };
    reads.push(read);
    entered.resolve();
    const response = await route.fetch();
    read.status = response.status();
    await new Promise(resolve => setTimeout(resolve, 260));
    read.fulfilledEpoch = Date.now();
    await route.fulfill({ response });
  };
  await page.route(listMatcher, handler);
  const requests = watchRequests(page);
  let failure: string | null = null;
  let pendingTitles: string[] = [];
  let after: string[] = [];
  await startFrames(page);
  try {
    await markAction(page);
    await pressPage(page, label);
    await bounded(entered.promise, 'The delayed active-page read');
    await page.waitForTimeout(80);
    pendingTitles = await titles(page);
    await waitPage(page, target);
    after = await titles(page);
  } catch (error) { failure = error instanceof Error ? error.message : String(error); }
  const evidence = await finishFrames(page);
  requests.stop();
  await page.unroute(listMatcher, handler);
  await saveEvidence(info, evidenceName(name, mode), { mode, label, target, headingBefore, before, pendingTitles, after, reads, requests: requests.events, failure, ...evidence });
  expect.soft(failure, name + ': action completes').toBeNull();
  expect.soft(pendingTitles, name + ': the old cards remain while the response is pending').toEqual(before);
  expect.soft(after, name + ': the next page replaces the old cards').not.toEqual(before);
  expect.soft(evidence.frames.at(-1)?.pagerPage, name + ': selected page').toBe('Page ' + target);
  const delayed = reads.find(read => read.page === target);
  expect.soft(delayed?.status, name + ': delayed response is a real successful API read').toBe(200);
  const pending = delayed ? evidence.frames.filter(frame => frame.epoch >= delayed.requestedEpoch
    && frame.epoch < (delayed.fulfilledEpoch ?? Number.POSITIVE_INFINITY)) : [];
  expect.soft(pending.length, name + ': pending state was painted').toBeGreaterThan(0);
  expect.soft(pending.every(frame => JSON.stringify(normalize(frame.cardTitles)) === JSON.stringify(before)), name + ': no early card replacement').toBe(true);
  assertPaginationFrames(evidence, mode, headingBefore);
}

/** Real dashboard paging, delayed transport, out-of-order answers and an aborted latest read. */
export async function checkPagination(page: Page, info: TestInfo, options: Mode = {}): Promise<void> {
  await delayedPage(page, info, 'Next page', 2, 'pagination-next', options);
  await delayedPage(page, info, 'Page 1', 1, 'pagination-number-one', options);
  await delayedPage(page, info, 'Page 2', 2, 'pagination-number-two', options);
  await pressPage(page, 'Page 1');
  await waitPage(page, 1);
  await preparePager(page);

  const headingBefore = await headingView(page);
  const before = await titles(page);
  const secondEntered = gate();
  const releaseSecond = gate();
  const secondDone = gate();
  const thirdDone = gate();
  const reads: Read[] = [];
  const handler = async (route: Route) => {
    const number = activePage(route);
    if (number === null) { await route.continue(); return; }
    const read: Read = { page: number, requestedEpoch: Date.now(), fulfilledEpoch: null, status: null };
    reads.push(read);
    if (number === 2) secondEntered.resolve();
    const response = await route.fetch();
    read.status = response.status();
    if (number === 2) await releaseSecond.promise;
    read.fulfilledEpoch = Date.now();
    await route.fulfill({ response });
    if (number === 2) secondDone.resolve();
    if (number === 3) thirdDone.resolve();
  };
  await page.route(listMatcher, handler);
  const requests = watchRequests(page);
  await startFrames(page);
  let failure: string | null = null;
  let pendingTitles: string[] = [];
  let thirdTitles: string[] = [];
  let lateTitles: string[] = [];
  try {
    await markAction(page);
    await pressPage(page, 'Next page');
    await bounded(secondEntered.promise, 'Page 2 request');
    pendingTitles = await titles(page);
    await page.waitForFunction(() => document.querySelector('nav[aria-label="Pagination"] [aria-current="page"]')?.getAttribute('aria-label') === 'Page 2');
    await pressPage(page, 'Next page');
    await bounded(thirdDone.promise, 'Page 3 response');
    await waitPage(page, 3);
    thirdTitles = await titles(page);
    releaseSecond.resolve();
    await bounded(secondDone.promise, 'Late page 2 response');
    await page.waitForTimeout(150);
    lateTitles = await titles(page);
  } catch (error) { failure = error instanceof Error ? error.message : String(error); }
  finally { releaseSecond.resolve(); }
  const evidence = await finishFrames(page);
  requests.stop();
  await page.unroute(listMatcher, handler);
  await saveEvidence(info, evidenceName('pagination-last-request', options), { options, headingBefore, before, pendingTitles, thirdTitles, lateTitles, reads, requests: requests.events, failure, ...evidence });
  expect.soft(failure, 'Both out-of-order real reads complete').toBeNull();
  expect.soft(pendingTitles, 'Page 1 remains while page 2 is pending').toEqual(before);
  expect.soft(thirdTitles, 'Page 3 contains another real set of cards').not.toEqual(before);
  expect.soft(lateTitles, 'The late page 2 answer cannot replace page 3').toEqual(thirdTitles);
  expect.soft(evidence.frames.at(-1)?.pagerPage, 'The last requested page wins').toBe('Page 3');
  const page2 = reads.find(read => read.page === 2);
  const page3 = reads.find(read => read.page === 3);
  expect.soft(page2?.status, 'Real page 2 response status').toBe(200);
  expect.soft(page3?.status, 'Real page 3 response status').toBe(200);
  expect.soft(page2?.fulfilledEpoch ?? 0, 'Page 2 is delivered strictly after page 3').toBeGreaterThan(page3?.fulfilledEpoch ?? Number.POSITIVE_INFINITY);
  assertPaginationFrames(evidence, options, headingBefore, 2); // Two explicit Next presses.

  await preparePager(page);
  const keptTitles = await titles(page);
  const abortReads: Read[] = [];
  const abortHandler = async (route: Route) => {
    const number = activePage(route);
    if (number !== 4) { await route.continue(); return; }
    abortReads.push({ page: number, requestedEpoch: Date.now(), fulfilledEpoch: Date.now(), status: null });
    await route.abort('failed');
  };
  await page.route(listMatcher, abortHandler);
  const abortRequests = watchRequests(page);
  await startFrames(page);
  let abortFailure: string | null = null;
  let alertVisible = false;
  try {
    await markAction(page);
    await pressPage(page, 'Next page');
    await waitPage(page, 3);
    await page.getByRole('alert').getByText("Couldn't load that page", { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    alertVisible = true;
  } catch (error) { abortFailure = error instanceof Error ? error.message : String(error); }
  const aborted = await finishFrames(page);
  abortRequests.stop();
  await page.unroute(listMatcher, abortHandler);
  const afterAbort = await titles(page);
  await saveEvidence(info, evidenceName('pagination-aborted', options), { options, keptTitles, afterAbort, alertVisible, abortReads, requests: abortRequests.events, failure: abortFailure, ...aborted });
  expect.soft(abortFailure, 'An aborted latest-page read rolls back').toBeNull();
  expect.soft(abortReads, 'The user-requested latest page is aborted once').toHaveLength(1);
  expect.soft(alertVisible, 'The exact paging error is announced').toBe(true);
  expect.soft(afterAbort, 'The aborted page keeps the current cards').toEqual(keptTitles);
  expect.soft(aborted.frames.at(-1)?.pagerPage, 'Pager returns to the successfully fetched page').toBe('Page 3');
  assertPaginationFrames(aborted, options);
}

function dialogFrames(evidence: FrameEvidence): MotionFrame[] {
  return evidence.frames.filter(frame => frame.time >= (evidence.actionTime ?? 0) && frame.dialog !== null);
}

function assertDialogCurve(frames: MotionFrame[], direction: 'open' | 'close', reduced: boolean) {
  const delta = direction === 'open' ? 1 : -1;
  expect.soft(frames.length, direction + ': dialog movement is sampled').toBeGreaterThan(1);
  for (const property of ['opacity', 'scale'] as const) {
    const steps = frames.slice(1).map((frame, i) => delta * (frame.dialog![property] - frames[i].dialog![property]));
    expect.soft(Math.min(0, ...steps), direction + ': ' + property + ' is monotone').toBeGreaterThanOrEqual(-0.001);
  }
  if (reduced) {
    expect.soft(frames.every(frame => frame.dialog!.transformAnimations === 0), direction + ': reduced motion has no transform animation').toBe(true);
    expect.soft(frames.every(frame => Math.abs(frame.dialog!.scale - 1) <= 0.001), direction + ': reduced motion does not scale').toBe(true);
  }
}

/** A warmed real-card click and Escape, with native-transform and latency evidence. */
export async function checkModal(page: Page, info: TestInfo, title: string, options: Mode = {}): Promise<void> {
  const card = page.locator('[data-task-card]').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await card.waitFor({ state: 'visible' });
  await card.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(2500);
  const requests = watchRequests(page);
  await startFrames(page);
  let failure: string | null = null;
  try {
    await markAction(page);
    await card.getByRole('heading', { name: title, exact: true }).click();
  } catch (error) { failure = error instanceof Error ? error.message : String(error); }
  const opening = await finishFrames(page);
  requests.stop();
  const openFrames = dialogFrames(opening);
  const first = openFrames.find(frame => frame.dialog!.visible);
  const visibleLatency = first ? first.time - (opening.actionTime ?? 0) : null;
  const actionEpoch = opening.frames[0].epoch + (opening.actionTime ?? 0) - opening.frames[0].time;
  const scripts = requests.events.filter(event => event.kind === 'request' && event.resourceType === 'script' && event.epoch >= actionEpoch);
  const cpuAnnotation = info.annotations.find(annotation => annotation.type === 'cpu-throttle');
  const cpuRate = Number(cpuAnnotation?.description ?? 1);
  const desktop1x = (page.viewportSize()?.width ?? 0) >= 1024 && cpuRate === 1;
  let screenshotPath: string | null = null;
  let screenshotFailure: string | null = null;
  try {
    if (await page.getByRole('dialog', { name: 'Task: ' + title, exact: true }).isVisible()) {
      screenshotPath = info.outputPath(evidenceName('modal-opening.png', options));
      await mkdir(dirname(screenshotPath), { recursive: true });
      // Capture the visible dialog and its origin on screen without changing animation state.
      await page.screenshot({ path: screenshotPath, fullPage: false, animations: 'allow' });
      await info.attach(evidenceName('modal-opening.png', options), { path: screenshotPath, contentType: 'image/png' });
    }
  } catch (error) { screenshotFailure = error instanceof Error ? error.message : String(error); }
  await saveEvidence(info, evidenceName('modal-opening', options), { title, options, cpuRate, desktop1x, visibleLatency, scripts, screenshotPath, screenshotFailure, requests: requests.events, failure, ...opening });
  expect.soft(screenshotFailure, 'The visible dialog screenshot is saved and attached').toBeNull();
  if (first) expect.soft(screenshotPath, 'A visible dialog has a physical PNG before closing').not.toBeNull();
  expect.soft(failure, 'The real card click succeeds').toBeNull();
  expect.soft(scripts, 'The warmed editor loads no script after the click').toEqual([]);
  expect.soft(first, 'Opening produces a visible dialog').toBeDefined();
  if (desktop1x) expect.soft(visibleLatency ?? Number.POSITIVE_INFINITY, 'Desktop 1x first visible dialog is within 120ms').toBeLessThanOrEqual(120);
  if (!options.reduced) expect.soft(openFrames.some(frame => frame.dialog!.transformAnimations > 0), 'The opening transform is a native Web Animation on the dialog').toBe(true);
  assertDialogCurve(openFrames, 'open', !!options.reduced);
  expect.soft(opening.frames.at(-1)?.dialog?.opacity, 'Dialog opacity settles at 1').toBeCloseTo(1, 5);
  expect.soft(opening.frames.at(-1)?.dialog?.scale, 'Dialog scale settles at 1').toBeCloseTo(1, 5);

  const closeRequests = watchRequests(page);
  await startFrames(page);
  let closeFailure: string | null = null;
  try {
    await markAction(page);
    await page.keyboard.press('Escape');
  } catch (error) { closeFailure = error instanceof Error ? error.message : String(error); }
  const closing = await finishFrames(page);
  closeRequests.stop();
  const closeFrames = dialogFrames(closing);
  await saveEvidence(info, evidenceName('modal-closing', options), { title, options, requests: closeRequests.events, failure: closeFailure, ...closing });
  expect.soft(closeFailure, 'Escape reaches the editor').toBeNull();
  assertDialogCurve(closeFrames, 'close', !!options.reduced);
  expect.soft(closing.frames.at(-1)?.dialog, 'Escape removes the dialog after its exit').toBeNull();
}
