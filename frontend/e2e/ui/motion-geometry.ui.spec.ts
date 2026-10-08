import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { assertGeometry, beginRailLayoutObservation, endRailLayoutObservation, createGeometryFixtures, geometryCard, hideRevealFixture, measureCard, navigateGeometrySurface, GeometryRateBudget, waitForGeometryTasks, type GeometryFixtures, type GeometryMeasurement } from './_card-geometry';
import { FRONTEND_BASE } from './_helpers';
import {
  registerVerifiedUser,
  requireFrontendReachable,
  submitLoginForm,
  UI_PASSWORD,
  type UiUser,
} from './_helpers';

/**
 * Contracts the owner set on 2026-10-05 that only a real layout engine can check:
 *
 * - the droplet bar condenses in ONE motion — no one-frame snap after its spring has
 *   started (the "Planora" name used to be removed after its exit, a layout change
 *   framer-motion never measured, and the capsule jumped ~70px at the end);
 * - "New task" opens without lighting its title up, and typing lands in the title;
 * - a task card's circle sits exactly on the card's vertical centre, and its eye sits
 *   as far from the bottom edge as from the left one.
 *
 * jsdom has no layout, so the unit tests only guard the structure; these measure it.
 */

const TITLES = [
  'Buy milk',
  'Gym',
  'Call the bank',
  'Water the plants',
  'Read chapter 4',
  'Book dentist appointment',
  'Renew passport',
  'Fix the leaking kitchen tap before the weekend so it stops dripping all night long',
  'Prepare the quarterly report for the board meeting and send the draft to finance',
];

async function signIn(page: Page, user: UiUser) {
  await submitLoginForm(page, user.email, UI_PASSWORD);
  await expect(page).toHaveURL(/\/(dashboard|tasks)(\/|$|\?)/, { timeout: 20_000 });
}

// One registration and one sign-in for the whole file: the Auth API allows three registrations
// and five sign-ins a minute per address, and every test here only reads the signed-in pages.
test.describe.serial('motion and geometry contracts (browser, post-login)', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    await requireFrontendReachable();
    const user: UiUser = await registerVerifiedUser('geometry');
    page = await browser.newPage();
    await signIn(page, user);
    await page.goto('/tasks');
    const openPanel = page.getByRole('button', { name: /open create task panel/i });
    const title = page.getByPlaceholder('What needs to be done?');
    for (const text of TITLES) {
      await openPanel.click();
      await title.fill(text);
      await page.keyboard.press('Control+Enter');
      // /tasks closes the panel once the task is created (handleCreate -> setIsCreateOpen(false)).
      await expect(openPanel).toBeVisible({ timeout: 10_000 });
    }
    await expect(page.locator('[data-task-card]')).toHaveCount(TITLES.length, { timeout: 10_000 });
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('New task opens without focusing its title, and typing lands in it', async () => {
    await page.goto('/tasks');
    await page.getByRole('button', { name: /open create task panel/i }).click();
    const title = page.getByPlaceholder('What needs to be done?');
    await page.waitForTimeout(500);
    await expect(title).not.toBeFocused();

    // "F" is also the filter shortcut on this page; while the panel is open it is a letter.
    await page.keyboard.type('Fix');
    await expect(title).toBeFocused();
    await expect(title).toHaveValue('Fix');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // The field is never boxed by the global outline: its left rule carries the focus.
    const outline = await title.evaluate((el) => getComputedStyle(el).outlineColor);
    expect(outline).toBe('rgba(0, 0, 0, 0)');
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 900 },
  ]) {
    test(`a card's circle is on its centre and its eye in its corner at ${viewport.width}px`, async () => {
      await page.setViewportSize(viewport);
      await page.goto('/tasks');
      await expect(page.locator('[data-task-card]').first()).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(800);

      const cards = page.locator('[data-task-card]');
      // The last staggered card can still have a tiny entrance scale at 800ms.
      // Wait for the actual 32px semantic border-box before measuring its 44px hit.
      await expect.poll(() => cards.evaluateAll(nodes => nodes.every(card => {
        const button = card.querySelector('button[aria-label="Mark as complete"], button[aria-label="Take it – start working"], button[aria-label="Mark as incomplete"]');
        if (!button) return false;
        const rect = button.getBoundingClientRect();
        return Math.abs(rect.width - 32) < 0.0001 && Math.abs(rect.height - 32) < 0.0001;
      })), { timeout: 10_000, message: 'Every staggered entrance spring has settled' }).toBe(true);
      expect(await cards.count()).toBeGreaterThanOrEqual(TITLES.length);
      for (const card of await cards.all()) {
        assertGeometry(await measureCard(card), false, `existing titles at ${viewport.width}px`);
      }
    });
  }

  test('the droplet condenses in one motion, with no late one-frame snap', async ({}, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto('/tasks');
    await expect(page.locator('[data-task-card]').first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(800);

    const widths = await page.evaluate(async () => {
      window.scrollTo({ top: 0, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 600));
      const capsule = document.querySelector('div.fixed > header') as HTMLElement;
      const samples: Array<{ width: number; time: number; transform: string; layoutWidth: number }> = [];
      let running = true;
      // Read after all RAF writers have rendered this frame. Otherwise Framer's callback
      // can run after the reader, and variable frame intervals produce false velocity spikes.
      const tick = () => {
        setTimeout(() => {
          samples.push({ width: capsule.getBoundingClientRect().width, time: performance.now(), transform: getComputedStyle(capsule).transform, layoutWidth: capsule.offsetWidth });
          if (running) requestAnimationFrame(tick);
        }, 0);
      };
      requestAnimationFrame(tick);
      for (let i = 0; i < 12; i++) {
        window.scrollBy({ top: 24, behavior: 'instant' });
        await new Promise((r) => requestAnimationFrame(r));
      }
      await new Promise((r) => setTimeout(r, 1100));
      running = false;
      return samples;
    });

    const framePath = testInfo.outputPath('droplet-frames.json');
    await writeFile(framePath, JSON.stringify(widths, null, 2));
    await testInfo.attach('droplet-frames.json', { path: framePath, contentType: 'application/json' });

    // Normalize displacement to a 60Hz frame using actual RAF timestamps. A delayed
    // browser frame must not turn two legitimate spring frames into a synthetic snap.
    const steps = widths.slice(1).map((sample, i) =>
      Math.abs(sample.width - widths[i].width) * (1000 / 60) / (sample.time - widths[i].time)
    ).filter((d, i, all) => d > 0.05 || all.slice(0, i).some((x) => x > 0.05));
    expect(steps.length, 'the capsule condensed').toBeGreaterThan(3);
    const series = steps.map((s) => s.toFixed(1)).join(' ');
    // One spring is a single bell: its fastest frame comes early (~70ms in), not ~13 frames in
    // as the old snap did, where the snap itself was the largest frame of the whole motion.
    const peak = steps.indexOf(Math.max(...steps));
    expect(peak, `peak at frame ${peak} of ${series}`).toBeLessThanOrEqual(8);
    // And no frame jumps against the one before it: the old snap was 70.6px after 11.7px. A
    // spring ramping up grows by well under 1.6x a frame; a near-still frame may be followed
    // by at most 6px (the settle reversing).
    for (let i = 2; i < steps.length; i++) {
      const limit = steps[i - 1] > 3 ? steps[i - 1] * 1.6 + 2 : 6;
      expect(steps[i], `frame ${i} of ${series}`).toBeLessThanOrEqual(limit);
    }
  });
});

// Actual page filters: dashboard has active cards only; /tasks also has the completed preview;
// completed archive has completed cards only. All possible states on each surface are asserted.
test.describe.serial('card rail state, viewport and DPR matrix (real services)', () => {
  let fixtures: GeometryFixtures;
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000); // Two actual Auth fixtures can each encounter a real cooldown.
    await requireFrontendReachable();
    fixtures = await createGeometryFixtures(browser);
  });
  test.afterAll(async () => {
    await fixtures?.owner.context.close();
    await fixtures?.friend.context.close();
  });

  for (const dpr of [1, 1.25, 1.5, 2]) {
    for (const width of [390, 768, 1280, 1600]) {
      test(`rail matrix ${width}px at DPR ${dpr}`, async ({ browser }, testInfo) => {
        // Six surface mounts may each need one real 60s Gateway cooldown, in addition
        // to the measurement work. This scope changes no production rate limiter.
        test.setTimeout(480_000);
        await hideRevealFixture(fixtures);
        const context = await browser.newContext({
          baseURL: FRONTEND_BASE, viewport: { width, height: 1000 }, deviceScaleFactor: dpr,
          storageState: fixtures.storage,
        });
        const matrixPage = await context.newPage();
        const rateBudget = new GeometryRateBudget(matrixPage);
        const measurements: Array<{ surface: string; render: string; fixture: string; phase: string; rect: GeometryMeasurement }> = [];
        const settledHeights = new Map<string, number>();
        const layoutShifts: Array<{ surface: string; render: string; fixture: string; score: number; shifts: unknown[] }> = [];
        const notApplicable = [
          { surface: '/dashboard', state: 'completed', reason: 'The dashboard requests Todo/InProgress with isCompleted=false.' },
          { surface: '/tasks/completed', state: 'active/in-progress/revealed-active', reason: 'The archive requests isCompleted=true.' },
        ];
        try {
          await matrixPage.goto('/tasks');
          await waitForGeometryTasks(matrixPage, rateBudget);
          await expect(matrixPage.getByRole('button', { name: 'Expand task card' })).toHaveCount(1, { timeout: 20_000 });
          await matrixPage.getByRole('button', { name: 'Expand task card' }).click();
          const revealed = fixtures.cases.find(item => item.key === 'revealed')!;
          await expect(geometryCard(matrixPage, revealed)).toBeVisible();

          for (const render of ['first', 'repeat']) {
            for (const surface of ['/tasks', '/dashboard', '/tasks/completed'] as const) {
              await navigateGeometrySurface(matrixPage, surface, fixtures.cases, rateBudget);
              const cases = fixtures.cases.filter(item => surface === '/dashboard' ? !item.completed : surface === '/tasks/completed' ? item.completed : true);
              for (const item of cases) await expect(geometryCard(matrixPage, item)).toBeVisible({ timeout: 20_000 });
              await matrixPage.evaluate(() => document.fonts.ready);
              await matrixPage.waitForTimeout(900);
              if (!process.env.CI && width === 1280 && dpr === 1 && render === 'first' && surface !== '/dashboard') {
                await matrixPage.screenshot({ path: testInfo.outputPath(surface === '/tasks' ? 'tasks-rail.png' : 'completed-rail.png'), fullPage: true });
              }
              // Record every settled card before assertions, so RED evidence includes tall
              // and completed heights as well as the first failing short control rail.
              for (const item of cases) {
                measurements.push({ surface, render, fixture: item.key, phase: 'entrance-settled', rect: await measureCard(geometryCard(matrixPage, item)) });
              }
              for (const item of cases) {
                const card = geometryCard(matrixPage, item);
                await card.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
                await matrixPage.mouse.move(0, 0);
                await matrixPage.waitForTimeout(650);
                // Programmatic scrolling deliberately morphs the fixed bar. Observe only
                // settled control gestures, after that independent motion has finished.
                await beginRailLayoutObservation(matrixPage);
                const baseline = await measureCard(card);
                const collect = async (phase: string) => {
                  const rect = await measureCard(card);
                  measurements.push({ surface, render, fixture: item.key, phase, rect });
                  assertGeometry(rect, item.completed, `${surface}/${render}/${item.key}/${phase}`);
                  expect(Math.abs(rect.height - baseline.height), 'Hover must not change card height').toBeLessThanOrEqual(0.02);
                  return rect;
                };
                measurements.push({ surface, render, fixture: item.key, phase: 'settled', rect: baseline });
                assertGeometry(baseline, item.completed, `${surface}/${render}/${item.key}/settled`);
                const heightKey = `${surface}/${item.key}`;
                if (render === 'first') settledHeights.set(heightKey, baseline.height);
                else expect(Math.abs(baseline.height - settledHeights.get(heightKey)!), 'Repeated mounts retain the same settled height').toBeLessThanOrEqual(0.02);
                if (item.key === 'own-short') expect(Math.abs(baseline.height - 188), 'The necessary short-card height is minimal').toBeLessThanOrEqual(0.02);
                if (item.tall) {
                  await expect(card.getByText(/Expected /)).toBeVisible();
                  expect(baseline.height).toBeGreaterThan(188);
                }
                if (item.unread) await expect(card.locator('..').getByRole('status', { name: /types/ })).toBeVisible();
                const bounds = (await card.boundingBox())!;
                // Locator.hover scrolls with the page's smooth-scroll CSS; sample the settled
                // native pointer gesture without starting another scroll animation.
                await matrixPage.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
                await matrixPage.waitForTimeout(250);
                await collect('card-hover');
                const control = card.locator('button[aria-label="Mark as complete"], button[aria-label="Take it – start working"], button[aria-label="Mark as incomplete"]');
                const controlBounds = (await control.boundingBox())!;
                await matrixPage.mouse.move(controlBounds.x + controlBounds.width / 2, controlBounds.y + controlBounds.height / 2);
                // Sample through the spring's peak as well as its resting scale. A 191px card
                // with a scaling semantic hit target still fails at the spring's overshoot.
                const until = Date.now() + 350;
                let peakCircleHeight = baseline.circleHeight;
                do {
                  await matrixPage.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
                  const hovered = await collect('completion-hover');
                  expect(hovered.completionHovered, 'The pointer stays over the stationary semantic button').toBe(true);
                  peakCircleHeight = Math.max(peakCircleHeight, hovered.circleHeight);
                } while (Date.now() < until);
                // The visible circle retains its 1.06 spring, including its small overshoot;
                // only the semantic button/hit area remains stationary.
                expect(peakCircleHeight / baseline.circleHeight, 'Existing circle hover scale is preserved').toBeGreaterThan(1.05);
                expect(peakCircleHeight / baseline.circleHeight, 'Circle spring remains bounded').toBeLessThan(1.08);
                if (!item.completed) {
                  const eyeBounds = (await card.getByRole('button', { name: 'Collapse task card' }).boundingBox())!;
                  await matrixPage.mouse.move(eyeBounds.x + eyeBounds.width / 2, eyeBounds.y + eyeBounds.height / 2);
                  await collect('eye-hover');
                }
                const report = await endRailLayoutObservation(matrixPage);
                layoutShifts.push({ surface, render, fixture: item.key, ...report });
                expect(report.score, `${surface}/${render}/${item.key}: settled control hovers cause no layout shifts`).toBe(0);
              }
            }
          }
        } finally {
          const evidencePath = testInfo.outputPath('card-geometry.json');
          await writeFile(evidencePath, JSON.stringify({ width, dpr, browserVersion: browser.version(), measurements, layoutShifts, rateLimits: rateBudget.events, rateWaitsMs: rateBudget.waits, notApplicable }, null, 2));
          await testInfo.attach('card-geometry.json', { path: evidencePath, contentType: 'application/json' });
          // Keep this fixture's own rotated refresh cookie in memory for the next DPR context.
          fixtures.storage = await context.storageState();
          await context.close();
        }
      });
    }
  }
});
