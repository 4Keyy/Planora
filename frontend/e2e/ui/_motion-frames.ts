import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { persistJsonEvidence } from './_card-geometry';

export type MotionFrame = {
  time: number; epoch: number; rafTime: number; sequence: number; sampleLag: number;
  scrollY: number; scrollHeight: number; innerHeight: number;
  pagerTop: number | null; pagerPage: string | null; skeletons: number; headingTop: number | null; headingBottom: number | null;
  cardTitles: string[]; bodyMinHeight: string; anchor: string;
  activeLabel: string | null;
  card: null | {
    height: number; cssHeight: number; top: number; bottom: number; documentTop: number;
    nextTop: number | null; expand: boolean; collapse: boolean; title: string;
    description: string | null; dates: boolean; dateText: string | null; expected: boolean; expectedText: string | null; delay: boolean;
    buttonTop: number | null; buttonBottom: number | null; heightAnimations: number; heightFlight: number | null; heightClock: number | null;
  };
  dialog: null | { visible: boolean; opacity: number; scale: number; transformAnimations: number };
};
export type FrameEvidence = { actionTime: number | null; frames: MotionFrame[]; bodyStyles: string[]; missedFrames: Array<{ sequence: number; latestSequence: number; rafTime: number; lag: number }>; scrollCalls: Array<{ time: number; top: number; behavior: string }> };
type Recording = FrameEvidence & { start: number; selector: string | null; raf: number; counterRaf: number; originalScrollTo: Window['scrollTo']; proxyScrollTo: Window['scrollTo']; observer: MutationObserver; latestSequence: number; latestRafTime: number; queuedSequence: number; advanceSequence: (time: number) => void; queueSample: () => void; onInput: ((event: Event) => void) | null };
type RecordingWindow = Window & { motionRecording?: Recording; motionOriginalRAF?: Window['requestAnimationFrame'] };

/** Install before modules cache RAF (including Framer's scheduler). Preserve app callback order and handles. */
export async function installMotionFrames(context: BrowserContext) {
  await context.addInitScript(() => {
    const win = window as RecordingWindow;
    const original = window.requestAnimationFrame;
    win.motionOriginalRAF = original;
    window.requestAnimationFrame = callback => {
      const handle = original.call(window, time => {
        win.motionRecording?.advanceSequence(time);
        callback.call(window, time);
      });
      const state = win.motionRecording;
      if (state?.raf && state.queuedSequence > state.latestSequence) {
        cancelAnimationFrame(state.raf);
        state.queueSample();
      }
      return handle;
    };
  });
}

/** Observe painted-frame geometry, keeping a pre-action baseline and no auth/DTOs. */
export async function startFrames(page: Page, { cardSelector }: { cardSelector?: string } = {}) {
  await page.evaluate(selector => {
    const win = window as RecordingWindow;
    if (win.motionRecording) throw new Error('A frame recording is already active');
    const originalRAF = win.motionOriginalRAF;
    if (!originalRAF) throw new Error('Install the frame observer before page scripts');
    const raf = (callback: FrameRequestCallback) => originalRAF.call(window, callback);
    const start = performance.now();
    const bodyStyles = [document.body.getAttribute('style') ?? ''];
    const observer = new MutationObserver(records => {
      for (const record of records) bodyStyles.push(record.oldValue ?? '', document.body.getAttribute('style') ?? '');
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['style'], attributeOldValue: true });
    const state: Recording = { start, selector: selector ?? null, actionTime: null, frames: [], bodyStyles, missedFrames: [], scrollCalls: [], raf: 0, counterRaf: 0, originalScrollTo: window.scrollTo, proxyScrollTo: window.scrollTo, observer, latestSequence: 0, latestRafTime: -1, queuedSequence: 0, advanceSequence: () => {}, queueSample: () => {}, onInput: null };
    win.motionRecording = state;
    const scrollTo = state.originalScrollTo.bind(window);
    state.proxyScrollTo = ((first: number | ScrollToOptions, second?: number) => {
      const options = typeof first === 'number' ? { top: second ?? 0, left: first } : first;
      state.scrollCalls.push({ time: performance.now() - start, top: options.top ?? window.scrollY, behavior: options.behavior ?? 'auto' });
      if (typeof first === 'number') scrollTo(first, second ?? 0);
      else scrollTo(first);
    }) as Window['scrollTo'];
    window.scrollTo = state.proxyScrollTo;
    const animationIds = new WeakMap<Animation, number>();
    let nextAnimationId = 0;
    const read = (rafTime: number, sequence = 0) => {
      const card = state.selector ? document.querySelector<HTMLElement>(state.selector) : null;
      const box = card?.getBoundingClientRect();
      const heightAnimations = card?.getAnimations().filter(animation => animation.effect instanceof KeyframeEffect
        && animation.effect.target === card && animation.effect.getKeyframes().some(key => typeof key.height === 'string')) ?? [];
      const heightAnimation = heightAnimations[0];
      if (heightAnimation && !animationIds.has(heightAnimation)) animationIds.set(heightAnimation, ++nextAnimationId);
      const column = card?.closest('[class~="relative"][class~="flex-col"][class~="flex-1"]');
      const siblings = column ? Array.from(column.querySelectorAll<HTMLElement>('[data-task-card]')) : [];
      const next = card ? siblings[siblings.indexOf(card) + 1] : null;
      const toggle = card?.querySelector<HTMLButtonElement>('button[aria-label="Collapse task card"],button[aria-label="Expand task card"]');
      const toggleBox = toggle?.getBoundingClientRect();
      const pager = document.querySelector('nav[aria-label="Pagination"]');
      const heading = document.getElementById('active-tasks-heading')?.getBoundingClientRect();
      const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
      const dialogStyle = dialog ? getComputedStyle(dialog) : null;
      const transform = dialogStyle ? new DOMMatrixReadOnly(dialogStyle.transform) : null;
      const dbox = dialog?.getBoundingClientRect();
      const hasTransform = (animation: Animation) => animation.effect instanceof KeyframeEffect
        && animation.effect.target === dialog && animation.effect.getKeyframes().some(key => typeof key.transform === 'string');
      state.frames.push({
        time: performance.now() - start, epoch: Date.now(), rafTime, sequence, sampleLag: performance.now() - rafTime,
        scrollY: window.scrollY, scrollHeight: document.documentElement.scrollHeight, innerHeight: window.innerHeight,
        pagerTop: pager ? pager.getBoundingClientRect().top + window.scrollY : null,
        headingTop: heading?.top ?? null, headingBottom: heading?.bottom ?? null,
        pagerPage: pager?.querySelector('[aria-current="page"]')?.getAttribute('aria-label') ?? null,
        skeletons: document.querySelectorAll('.skeleton-defer,.skeleton-leave').length,
        cardTitles: Array.from(document.querySelectorAll('[data-task-card] h3')).map(element => element.textContent ?? ''),
        bodyMinHeight: document.body.style.minHeight, anchor: getComputedStyle(document.documentElement).overflowAnchor,
        activeLabel: document.activeElement?.getAttribute('aria-label') ?? null,
        card: card && box ? {
          height: box.height, cssHeight: parseFloat(getComputedStyle(card).height),
          top: box.top, bottom: box.bottom, documentTop: box.top + window.scrollY,
          nextTop: next ? next.getBoundingClientRect().top + window.scrollY : null,
          expand: !!card.querySelector('button[aria-label="Expand task card"]'),
          collapse: !!card.querySelector('button[aria-label="Collapse task card"]'),
          title: card.querySelector('h3')?.textContent ?? '',
          description: card.querySelector('p.line-clamp-2')?.textContent ?? null,
          dates: !!card.querySelector('.lucide-calendar'),
          dateText: card.querySelector('.lucide-calendar')?.parentElement?.querySelector('.tabular-nums')?.textContent ?? null,
          expectedText: card.querySelector('.lucide-clock')?.parentElement?.textContent ?? null,
          expected: /Expected/i.test(card.textContent ?? ''), delay: /Delay/i.test(card.textContent ?? ''),
          buttonTop: toggleBox?.top ?? null, buttonBottom: toggleBox?.bottom ?? null,
          heightAnimations: heightAnimations.length,
          heightFlight: heightAnimation ? animationIds.get(heightAnimation)! : null,
          heightClock: heightAnimation ? Number(heightAnimation.currentTime ?? 0) : null,
        } : null,
        dialog: dialog && dialogStyle && transform && dbox ? {
          visible: dialogStyle.visibility !== 'hidden' && dialogStyle.display !== 'none'
            && Number(dialogStyle.opacity) > 0 && dbox.height > 0,
          opacity: Number(dialogStyle.opacity), scale: transform.a,
          transformAnimations: dialog.getAnimations().filter(hasTransform).length,
        } : null,
      });
    };
    read(performance.now());
    state.advanceSequence = time => {
      if (time !== state.latestRafTime) { ++state.latestSequence; state.latestRafTime = time; }
    };
    const countFrame = (time: number) => {
      state.advanceSequence(time);
      state.counterRaf = raf(countFrame);
    };
    state.queueSample = () => {
      state.queuedSequence = state.latestSequence + 1;
      state.raf = raf(sample);
    };
    let previousSequence = 0;
    const sample = (time: number) => {
      state.advanceSequence(time);
      const sequence = state.latestSequence;
      if (previousSequence && sequence > previousSequence + 1) {
        state.missedFrames.push({ sequence: previousSequence + 1, latestSequence: sequence, rafTime: time, lag: performance.now() - time });
      }
      read(time, sequence);
      previousSequence = sequence;
      // Writers already queued the next frame. Later registrations move only
      // the future sampler behind them; the current frame's sample is retained.
      state.queueSample();
    };
    state.counterRaf = raf(countFrame);
    state.queueSample();
  }, cardSelector);
}

export async function markAction(page: Page) {
  await page.evaluate(() => {
    const state = (window as RecordingWindow).motionRecording;
    if (!state) throw new Error('No active frame recording');
    if (state.onInput) {
      document.removeEventListener('click', state.onInput, true);
      document.removeEventListener('keydown', state.onInput, true);
    }
    state.actionTime = performance.now() - state.start;
    state.onInput = event => {
      if (event instanceof KeyboardEvent && !['Enter', 'Escape'].includes(event.key)) return;
      state.actionTime = performance.now() - state.start;
      document.removeEventListener('click', state.onInput!, true);
      document.removeEventListener('keydown', state.onInput!, true);
      state.onInput = null;
    };
    document.addEventListener('click', state.onInput, true);
    document.addEventListener('keydown', state.onInput, true);
  });
}

export async function finishFrames(page: Page, { minMs = 1800, maxMs = 8000 }: { minMs?: number; maxMs?: number } = {}): Promise<FrameEvidence> {
  const evidence = await page.evaluate(async ({ minMs, maxMs }) => {
    const win = window as RecordingWindow;
    const state = win.motionRecording;
    if (!state) throw new Error('No active frame recording');
    // A paused WAAPI animation is still moving: inspect keyframes and geometry, never playState.
    while (performance.now() - state.start < maxMs) {
      await new Promise<void>(resolve => setTimeout(resolve, 50));
      if (performance.now() - state.start < minMs) continue;
      const last = state.frames.slice(-16);
      if (last.length < 16) continue;
      const stable = last.every(frame => Math.abs(frame.scrollY - last[0].scrollY) <= 0.01
        && (frame.card === null || (Math.abs(frame.card.cssHeight - last[0].card!.cssHeight) <= 0.02 && frame.card.heightAnimations === 0))
        && (frame.pagerTop === null || Math.abs(frame.pagerTop - last[0].pagerTop!) <= 0.02)
        && (frame.dialog === null || (Math.abs(frame.dialog.opacity - (last[0].dialog?.opacity ?? 0)) <= 0.00001
          && Math.abs(frame.dialog.scale - (last[0].dialog?.scale ?? 0)) <= 0.00001 && frame.dialog.transformAnimations === 0)));
      if (stable) break;
    }
    cancelAnimationFrame(state.raf);
    cancelAnimationFrame(state.counterRaf);
    if (window.scrollTo === state.proxyScrollTo) window.scrollTo = state.originalScrollTo;
    state.observer.disconnect();
    if (state.onInput) {
      document.removeEventListener('click', state.onInput, true);
      document.removeEventListener('keydown', state.onInput, true);
    }
    delete win.motionRecording;
    return { actionTime: state.actionTime, frames: state.frames, bodyStyles: state.bodyStyles, missedFrames: state.missedFrames, scrollCalls: state.scrollCalls };
  }, { minMs, maxMs });
  expect.soft(evidence.missedFrames, 'Every measured RAF sample belongs to that drawn frame; lost samples cannot certify motion').toEqual([]);
  return evidence;
}

export async function saveEvidence(info: TestInfo, name: string, data: unknown) {
  await persistJsonEvidence(info, name, { body: JSON.stringify(data, null, 2), contentType: 'application/json' });
}
export function watchRequests(page: Page) {
  const start = Date.now();
  const events: Array<{ time: number; epoch: number; kind: 'request' | 'response'; method: string; path: string; resourceType: string; status?: number }> = [];
  const safe = (url: string) => { const parsed = new URL(url); return parsed.pathname.startsWith('/todos/api/') || parsed.pathname.startsWith('/_next/'); };
  const requestListener = (request: import('@playwright/test').Request) => {
    if (request.resourceType() === 'script' || safe(request.url())) events.push({ time: Date.now() - start, epoch: Date.now(), kind: 'request',
      method: request.method(), path: new URL(request.url()).pathname, resourceType: request.resourceType() });
  };
  const responseListener = (response: import('@playwright/test').Response) => {
    if (response.request().resourceType() === 'script' || safe(response.url())) events.push({ time: Date.now() - start, epoch: Date.now(), kind: 'response',
      method: response.request().method(), path: new URL(response.url()).pathname,
      resourceType: response.request().resourceType(), status: response.status() });
  };
  page.on('request', requestListener); page.on('response', responseListener);
  return { events, stop: () => { page.off('request', requestListener); page.off('response', responseListener); } };
}

export function assertHeight(evidence: FrameEvidence, { oneStep = false, keyboard = false, requireFollowing = false }: { oneStep?: boolean; keyboard?: boolean; requireFollowing?: boolean } = {}) {
  const frames = evidence.frames.filter(frame => frame.card !== null);
  expect(frames.length, 'Every recorded frame contains the same card node').toBe(evidence.frames.length);
  const height = (frame: MotionFrame) => keyboard ? frame.card!.cssHeight : frame.card!.height;
  const first = frames[0], last = frames.at(-1)!;
  const distance = height(last) - height(first);
  expect(Math.abs(distance), 'A real change in card height is observed').toBeGreaterThan(20);
  const steps = frames.slice(1).map((frame, index) => height(frame) - height(frames[index]));
  expect.soft(Math.min(...steps.map(step => Math.sign(distance) * step)), 'Height never reverses').toBeGreaterThanOrEqual(-0.02);
  if (oneStep) expect.soft(steps.filter(step => Math.abs(step) > 0.02), 'Reduced motion changes height in one step').toHaveLength(1);
  else {
    expect.soft(Math.max(...steps.map(Math.abs)), 'Each drawn-frame height step is at most 25% of the path').toBeLessThanOrEqual(Math.abs(distance) * 0.25);
    expect.soft(frames.some(frame => Math.abs(height(frame) - height(first)) > 1 && Math.abs(height(frame) - height(last)) > 1), 'A genuine intermediate height is painted').toBe(true);
  }
  // Quantisation noise is bounded separately from the requested 1px position budget.
  expect.soft(Math.max(...frames.map(frame => Math.abs(frame.card!.documentTop - first.card!.documentTop))), 'The card keeps its document position').toBeLessThanOrEqual(1);
  if (requireFollowing) expect.soft(first.card!.nextTop, 'This reveal fixture has a real following card in the same column').not.toBeNull();
  if (first.card!.nextTop !== null) {
    expect.soft(frames.every(frame => frame.card!.nextTop !== null), 'The same column retains a following card').toBe(true);
    expect.soft(Math.max(...frames.map(frame => Math.abs(frame.card!.nextTop! - first.card!.nextTop! - (height(frame) - height(first))))), 'Following card moves by the height increment within 1px').toBeLessThanOrEqual(1);
  }
  const flights = frames.filter(frame => frame.card!.heightFlight !== null);
  if (!oneStep) {
    expect.soft(flights.length, 'The recorder observes the actual native height animation').toBeGreaterThan(0);
    for (let i = 1; i < flights.length; i++) {
      const previous = flights[i - 1].card!, current = flights[i].card!;
      if (previous.heightFlight === current.heightFlight) expect.soft(current.heightClock! - previous.heightClock!, 'The animation clock advances by at most two frames per drawn frame').toBeLessThanOrEqual(1000 / 30 + 0.001);
    }
    expect.soft(flights.every(frame => frame.anchor === 'none'), 'Scroll anchoring is disabled while the card changes height').toBe(true);
  }
  const landed = frames.findIndex((frame, index) => index > 0 && Math.abs(height(frame) - height(last)) <= 0.02 && frame.card!.heightAnimations === 0);
  expect.soft(landed, 'The growth completes within the recording').toBeGreaterThan(0);
  if (landed >= 0) expect.soft(frames.slice(landed).every(frame => Math.abs(height(frame) - height(last)) <= 0.02), 'Height stays fixed after the glide ends').toBe(true);
}

export function assertScroll(evidence: FrameEvidence, direction: 'up' | 'down', limit?: number) {
  const steps = evidence.frames.slice(1).map((frame, index) => frame.scrollY - evidence.frames[index].scrollY);
  expect.soft(direction === 'up' ? Math.max(...steps) : -Math.min(...steps), 'Scroll never changes the intended direction').toBeLessThanOrEqual(0.01);
  if (limit !== undefined) expect.soft(Math.max(...steps.map(Math.abs)), 'Scroll displacement per drawn frame').toBeLessThanOrEqual(limit);
}