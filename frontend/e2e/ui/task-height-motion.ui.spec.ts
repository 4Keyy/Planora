import { expect, test, type Locator } from '@playwright/test';
import { API_BASE, FRONTEND_BASE, requireFrontendReachable } from './_helpers';
import { persistJsonEvidence, createGeometryFixtures, geometryCard, hideRevealFixture, GeometryRateBudget, type GeometryFixtures } from './_card-geometry';
import { retryRateLimited } from '../_rate-limit';

type Frame = { time: number; height: number; nextTop: number | null; pagerTop: number | null; controlsPager: boolean; animations: number };
let fixtures: GeometryFixtures;
test.describe('real-service card height and layout motion', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    await requireFrontendReachable();
    fixtures = await createGeometryFixtures(browser);
  });
  test.afterAll(async () => {
    await fixtures?.owner.context.close();
    await fixtures?.friend.context.close();
  });

  async function collect(card: Locator, toggle: 'Collapse task card' | 'Expand task card') {
    return card.evaluate((element, label) => new Promise<Frame[]>(resolve => {
      const column = element.closest('[class~="relative"][class~="flex-col"][class~="flex-1"]')!;
      if (!column) throw new Error('A real masonry column is required');
      const grid = column.parentElement!;
      const following = Array.from(column.querySelectorAll('[data-task-card]'));
      const next = following[following.indexOf(element) + 1];
      const pager = document.querySelector('nav[aria-label="Pagination"]');
      const frames: Frame[] = [];
      const start = performance.now();
      const read = (time: number) => {
        const columnHeight = column.getBoundingClientRect().height;
        frames.push({
          time: time - start, height: element.getBoundingClientRect().height,
          nextTop: next?.getBoundingClientRect().top ?? null,
          pagerTop: pager?.getBoundingClientRect().top ?? null,
          controlsPager: Array.from(grid.children).every(child => child.getBoundingClientRect().height <= columnHeight + 1),
          animations: element.getAnimations().length,
        });
      };
      read(start);
      const toggle = element.querySelector<HTMLButtonElement>('button[aria-label="' + label + '"]');
      if (!toggle) throw new Error('Expected ' + label + '; real controls: ' + Array.from(element.querySelectorAll('button')).map(button => button.getAttribute('aria-label')).join(', '));
      toggle.click();
      const sample = (time: number) => {
        read(time);
        if (time - start < 1800) requestAnimationFrame(sample);
        else resolve(frames);
      };
      requestAnimationFrame(sample);
    }), toggle);
  }
  function assertFrames(frames: Frame[]) {
    const path = frames.at(-1)!.height - frames[0].height;
    expect(Math.abs(path)).toBeGreaterThan(20);
    expect(frames.some(frame => Math.abs(frame.height - frames[0].height) > 1 && Math.abs(frame.height - frames.at(-1)!.height) > 1), 'at least one measured intermediate height excludes an instantaneous snap').toBe(true);
    for (let i = 1; i < frames.length; i++) {
      const previous = frames[i - 1], frame = frames[i], delta = frame.height - previous.height;
      expect(Math.sign(path) * delta, 'height remains monotone').toBeGreaterThanOrEqual(-1);
      if (frame.time - previous.time <= 20) expect(Math.abs(delta), '60Hz per-frame displacement').toBeLessThanOrEqual(Math.abs(path) * 0.25 + 1);
      if (frame.nextTop !== null && previous.nextTop !== null) expect(Math.abs(frame.nextTop - previous.nextTop - delta), 'following card tracks actual height').toBeLessThanOrEqual(1);
      if (frame.controlsPager && previous.controlsPager && frame.pagerTop !== null && previous.pagerTop !== null) expect(Math.abs(frame.pagerTop - previous.pagerTop - delta), 'pager tracks highest column').toBeLessThanOrEqual(1);
    }
    expect(frames.at(-1)!.animations).toBe(0);
  }

  for (const surface of ['/tasks', '/dashboard']) {
    for (const key of ['own-tall-three-lines', 'friend-working']) {
      test(surface + ' own/shared height follows the column on hide and show: ' + key, async ({ browser }, info) => {
        await hideRevealFixture(fixtures);
        const context = await browser.newContext({ baseURL: FRONTEND_BASE, storageState: fixtures.storage, viewport: { width: 390, height: 1000 } });
        const page = await context.newPage();
        try {
          const item = fixtures.cases.find(value => value.key === key)!;
          await page.goto(surface);
          const originalCard = geometryCard(page, item);
          await new GeometryRateBudget(page).loaded(async () => await originalCard.isVisible());
          // Collapsing removes the heading; retain a stable locator on this real card.
          await originalCard.evaluate(element => element.setAttribute('data-motion-fixture', 'current'));
          const card = page.locator('[data-motion-fixture="current"]');
          await card.scrollIntoViewIfNeeded();
          await page.mouse.move(0, 0);
          await page.waitForTimeout(900);
          const natural = (await card.boundingBox())!.height;
          await expect(card.getByRole('button', { name: 'Collapse task card', exact: true })).toBeVisible();
          const hide = await collect(card, 'Collapse task card');
          await persistJsonEvidence(info, 'real-hide-frames', { body: JSON.stringify({ surface, key, hide }), contentType: 'application/json' });
          expect(Math.abs(hide.at(-1)!.height - 46), 'Collapse ends at the natural 46px shape').toBeLessThanOrEqual(0.02);
          await expect(card.getByRole('button', { name: 'Expand task card', exact: true })).toBeVisible();
          const show = await collect(card, 'Expand task card');
          await persistJsonEvidence(info, 'real-height-frames', { body: JSON.stringify({ surface, key, hide, show }), contentType: 'application/json' });
          expect(hide.every(frame => frame.nextTop !== null), 'one column provides a real following card').toBe(true);
          assertFrames(hide);
          assertFrames(show);
          expect(Math.abs(show.at(-1)!.height - natural)).toBeLessThanOrEqual(1);
          expect(await card.evaluate(element => (element as HTMLElement).style.height)).toBe('');
        } finally {
          fixtures.storage = await context.storageState();
          await context.close();
        }
      });
    }
  }

  test('dashboard bottom card of its tallest column opens without a pager snap', async ({ browser }, info) => {
    await hideRevealFixture(fixtures);
    // A seventh active item makes the real dashboard render its pagination.
    const result = await retryRateLimited(() => fixtures.owner.context.request.post(API_BASE + '/todos/api/v1/todos', {
      headers: { Authorization: 'Bearer ' + fixtures.owner.token, 'X-CSRF-Token': fixtures.owner.csrf },
      data: { title: 'Motion pagination overflow fixture', priority: 1, isPublic: false, sharedWithUserIds: [] },
    }));
    expect(result.ok()).toBe(true);
    const context = await browser.newContext({ baseURL: FRONTEND_BASE, storageState: fixtures.storage, viewport: { width: 768, height: 1000 } });
    const page = await context.newPage();
    try {
      await page.goto('/dashboard');
      await expect(page.locator('[data-task-card]').first()).toBeVisible();
      await expect(page.locator('nav[aria-label="Pagination"]')).toBeVisible();
      const expanders = page.getByRole('button', { name: 'Expand task card', exact: true });
      // Expanding removes this button; indexed locators would then skip cards and stall.
      for (let remaining = await expanders.count(); remaining > 0; remaining--) {
        await expanders.first().click();
        await expect(expanders).toHaveCount(remaining - 1);
      }
      await page.mouse.move(0, 0);
      await page.waitForTimeout(1000);
      const selector = await page.evaluate(() => {
        const columns = Array.from(document.querySelectorAll('[class~="relative"][class~="flex-col"][class~="flex-1"]')).filter(column => column.querySelector('[data-task-card]'));
        columns.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);
        const card = Array.from(columns[0].querySelectorAll('[data-task-card]')).at(-1)!;
        card.setAttribute('data-motion-bottom', '');
        return '[data-motion-bottom]';
      });
      const card = page.locator(selector);
      await card.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(650);
      const hide = await collect(card, 'Collapse task card');
      await persistJsonEvidence(info, 'bottom-card-hide', { body: JSON.stringify(hide), contentType: 'application/json' });
      const frames = await collect(card, 'Expand task card');
      await persistJsonEvidence(info, 'bottom-card-pager', { body: JSON.stringify(frames), contentType: 'application/json' });
      expect(frames.some(frame => frame.controlsPager && frame.pagerTop !== null)).toBe(true);
      assertFrames(frames);
    } finally { fixtures.storage = await context.storageState(); await context.close(); }
  });

  test('60 real tasks record animation FPS and long tasks', async ({ browser }, info) => {
    test.setTimeout(300_000);
    await hideRevealFixture(fixtures);
    for (let i = 0; i < 60; i++) {
      const result = await retryRateLimited(() => fixtures.owner.context.request.post(API_BASE + '/todos/api/v1/todos', {
        headers: { Authorization: 'Bearer ' + fixtures.owner.token, 'X-CSRF-Token': fixtures.owner.csrf },
        data: { title: 'Motion performance fixture ' + i, priority: 3, isPublic: false, sharedWithUserIds: [] },
      }));
      expect(result.ok(), 'real task fixture creation').toBe(true);
    }
    const context = await browser.newContext({ baseURL: FRONTEND_BASE, storageState: fixtures.storage, viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    try {
      await page.goto('/tasks');
      await expect(page.locator('[data-task-card]').first()).toBeVisible();
      for (let i = 0; i < 12 && await page.locator('[data-task-card]').count() < 60; i++) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(600);
      }
      expect(await page.locator('[data-task-card]').count()).toBeGreaterThanOrEqual(60);
      const card = page.locator('[data-task-card]').filter({ has: page.getByRole('button', { name: 'Collapse task card' }) }).last();
      await card.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(900);
      const metrics = await card.evaluate(element => new Promise<{
        fps: number; windowFps: number; frames: Array<{ time: number; height: number }>;
        motionFrames: Array<{ time: number; height: number }>; motionRafFrames: Array<{ time: number; height: number }>; longTasks: number[]; longTasksSupported: boolean;
      }>(resolve => {
        const frames: Array<{ time: number; height: number }> = [];
        const entries: Array<{ startTime: number; duration: number }> = [];
        const supported = PerformanceObserver.supportedEntryTypes.includes('longtask');
        const collect = (records: PerformanceEntry[]) => { for (const entry of records) entries.push({ startTime: entry.startTime, duration: entry.duration }); };
        const observer = supported ? new PerformanceObserver(list => collect(list.getEntries())) : null;
        observer?.observe({ type: 'longtask' });
        const start = performance.now();
        frames.push({ time: start, height: element.getBoundingClientRect().height });
        (element.querySelector('button[aria-label="Collapse task card"]') as HTMLButtonElement).click();
        const sample = (time: number) => {
          frames.push({ time, height: element.getBoundingClientRect().height });
          if (time - start < 800) requestAnimationFrame(sample);
          else {
            if (observer) collect(observer.takeRecords());
            observer?.disconnect();
            const firstChange = frames.findIndex(frame => Math.abs(frame.height - frames[0].height) > 0.1);
            const finalHeight = frames.at(-1)!.height;
            const lastMoving = frames.findLastIndex(frame => Math.abs(frame.height - finalHeight) > 0.1);
            const motionFrames = firstChange < 0 ? [] : frames.slice(Math.max(0, firstChange - 1), Math.min(frames.length, lastMoving + 2));
            // The synthetic pre-click height is not an RAF frame and cannot count toward FPS.
            const motionRafFrames = motionFrames.filter(frame => frame !== frames[0]);
            const rafFrames = frames.slice(1);
            const rate = (samples: Array<{ time: number }>) => samples.length > 1 ? (samples.length - 1) * 1000 / (samples.at(-1)!.time - samples[0].time) : 0;
            const motionStart = motionFrames[0]?.time ?? start;
            const motionEnd = motionFrames.at(-1)?.time ?? start;
            const longTasks = entries.filter(entry => entry.startTime < motionEnd && entry.startTime + entry.duration > motionStart).map(entry => entry.duration);
            resolve({ fps: rate(motionRafFrames), windowFps: rate(rafFrames),
              frames, motionFrames, motionRafFrames, longTasks, longTasksSupported: supported });
          }
        };
        requestAnimationFrame(sample);
      }));
      await persistJsonEvidence(info, 'animation-performance', { body: JSON.stringify(metrics), contentType: 'application/json' });
      expect(metrics.motionRafFrames.length, 'FPS counts only actual RAF frames on height movement, excluding settled idle and synthetic baseline frames').toBeGreaterThanOrEqual(3);
      expect(metrics.motionFrames.some(frame => Math.abs(frame.height - metrics.frames[0].height) > 1 && Math.abs(frame.height - metrics.frames.at(-1)!.height) > 1), 'Performance sampling observes an intermediate height').toBe(true);
      expect(Math.abs(metrics.frames.at(-1)!.height - 46)).toBeLessThanOrEqual(0.02);
      expect(metrics.fps).toBeGreaterThanOrEqual(55);
      if (metrics.longTasksSupported) expect(metrics.longTasks.filter(duration => duration > 50)).toEqual([]);
      else info.annotations.push({ type: 'unsupported metric', description: 'This engine does not expose longtask; no zero-long-task claim.' });
    } finally { fixtures.storage = await context.storageState(); await context.close(); }
  });
});
