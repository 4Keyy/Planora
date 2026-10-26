import { expect, test, type Locator } from '@playwright/test';
import { persistJsonEvidence, assertGeometry, beginRailLayoutObservation, endRailLayoutObservation, measureCard } from './_card-geometry';
import { requireFrontendReachable } from './_helpers';

test.beforeAll(async () => { await requireFrontendReachable(); });

for (const dpr of [1, 2]) {
  for (const width of [390, 768, 1280, 1600]) {
    test('public shipped cards keep the eye aligned at ' + width + 'px DPR ' + dpr, async ({ browser }, info) => {
      test.setTimeout(480_000);
      const context = await browser.newContext({ baseURL: process.env.E2E_FRONTEND_URL ?? 'http://127.0.0.1:3000', viewport: { width, height: 1000 }, deviceScaleFactor: dpr });
      const page = await context.newPage();
      const measurements: unknown[] = [];
      try {
        for (const mount of ['first', 'repeat']) {
          await page.goto('/');
          const cards = page.locator('[data-task-card]').filter({ has: page.getByRole('button', { name: 'Collapse task card', exact: true }) });
          // Session restore may await a 10s request and its CSRF retry before installing the sandbox,
          // and in CI every page load shares one IP: once the auth limiter (10 a minute) answers 429
          // with Retry-After 60, "Your list" arrives only after that minute.
          await expect(cards).toHaveCount(6, { timeout: 75_000 });
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(800);
          for (const card of await cards.all()) {
            await card.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
            await page.mouse.move(0, 0);
            await page.waitForTimeout(650);
            await expect.poll(() => card.evaluate(element => {
              const rect = element.getBoundingClientRect();
              return Math.abs(rect.height / parseFloat(getComputedStyle(element).height) - 1);
            }), { message: 'entrance scale settles before measuring 44px targets' }).toBeLessThanOrEqual(0.000001);
            const baseline = await measureCard(card);
            assertGeometry(baseline, false, mount + '/settled');
            expect(baseline.height).toBeGreaterThanOrEqual(148 - 0.02);
            expect(await card.getByRole('button', { name: 'Collapse task card' }).evaluate(element => element.closest('.flex-wrap') === null)).toBe(true);
            const supported = await page.evaluate(() => PerformanceObserver.supportedEntryTypes.includes('layout-shift'));
            if (supported) await beginRailLayoutObservation(page);
            for (const name of ['Mark as complete', 'Collapse task card']) {
              const control = card.getByRole('button', { name, exact: true });
              const rect = (await control.boundingBox())!;
              await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
              await page.waitForTimeout(250);
              const current = await measureCard(card);
              assertGeometry(current, false, mount + '/' + name);
              expect(Math.abs(current.height - baseline.height)).toBeLessThanOrEqual(0.02);
              measurements.push({ mount, control: name, title: await card.locator('h3').innerText(), ...current });
            }
            if (supported) expect((await endRailLayoutObservation(page)).score).toBe(0);
            else info.annotations.push({ type: 'unsupported metric', description: 'This engine does not expose layout-shift; no zero-CLS claim.' });
          }
        }
        // Resize through every breakpoint and back without moving the eye into the body.
        for (const resized of [390, 768, 1280, 1600, width]) {
          await page.setViewportSize({ width: resized, height: 1000 });
          await page.waitForTimeout(750);
          for (const card of await page.locator('[data-task-card]').filter({ has: page.getByRole('button', { name: 'Collapse task card', exact: true }) }).all()) {
            assertGeometry(await measureCard(card), false, 'resize/' + resized);
          }
        }
        const evidenceCard = page.locator('[data-task-card]').filter({ has: page.getByRole('heading', { name: 'Renew the household insurance policy', exact: true }) });
        await evidenceCard.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.mouse.move(0, 0);
        await page.waitForTimeout(650);
        // A viewport capture avoids waiting on floating-point element stability at high DPR.
        await page.screenshot({ path: info.outputPath('compact-card.png'), animations: 'disabled', timeout: 10_000 });
      } finally {
        const transforms = await page.locator('[data-task-card]').evaluateAll(elements => elements.map(element => {
          const ancestors = [];
          for (let current: Element | null = element; current; current = current.parentElement) {
            const style = getComputedStyle(current), rect = current.getBoundingClientRect();
            if (current === element || style.transform !== 'none') ancestors.push({ tag: current.tagName, transform: style.transform, cssHeight: style.height, rectHeight: rect.height, boxSizing: style.boxSizing });
          }
          return { title: element.querySelector('h3')?.textContent, ancestors };
        }));
        await persistJsonEvidence(info, 'compact-geometry', { body: JSON.stringify({ width, dpr, browser: browser.version(), measurements, transforms }), contentType: 'application/json' });
        await context.close();
      }
    });
  }
}

type Frame = { time: number; height: number; animations: number; animationDetails: Array<{ currentTime: number | null; playState: string; properties: string[] }> };
async function sampleToggle(card: Locator, label: string): Promise<Frame[]> {
  return card.evaluate((element, name) => new Promise<Frame[]>(resolve => {
    const frames: Frame[] = [];
    const start = performance.now();
    const read = (time: number): Frame => {
      const animations = element.getAnimations();
      return { time, height: element.getBoundingClientRect().height, animations: animations.length,
        animationDetails: animations.map(animation => ({
          currentTime: animation.currentTime === null ? null : Number(animation.currentTime), playState: animation.playState,
          properties: animation.effect instanceof KeyframeEffect ? [...new Set(animation.effect.getKeyframes().flatMap(key =>
            Object.keys(key).filter(name => !['offset', 'computedOffset', 'easing', 'composite'].includes(name))))] : [],
        })) };
    };
    const sample = (time: number) => {
      frames.push(read(time - start));
      const tail = frames.slice(-12);
      const landed = tail.length === 12 && tail.every(frame => frame.animations === 0 && Math.abs(frame.height - tail[0].height) <= 0.02);
      // The new clock counts drawn frames; 900ms of wall time cannot certify completion.
      // Keep recording until it lands, bounded so a stuck animation still fails the same guard.
      if ((time - start < 900 || !landed) && time - start < 8000) requestAnimationFrame(sample);
      else resolve(frames);
    };
    frames.push(read(0));
    (element.querySelector('button[aria-label="' + name + '"]') as HTMLButtonElement).click();
    requestAnimationFrame(sample);
  }), label);
}
function assertGlide(frames: Frame[]) {
  const start = frames[0].height, end = frames.at(-1)!.height;
  const distance = Math.abs(end - start), direction = Math.sign(end - start);
  expect(distance).toBeGreaterThan(20);
  expect(frames.some(frame => Math.abs(frame.height - start) > 1 && Math.abs(frame.height - end) > 1), 'at least one measured intermediate height excludes an instantaneous snap').toBe(true);
  for (let i = 1; i < frames.length; i++) {
    const delta = frames[i].height - frames[i - 1].height;
    expect(direction * delta).toBeGreaterThanOrEqual(-1);
    // The per-frame bound is meaningful only around 60Hz; record slower frames without inventing a pass.
    if (frames[i].time - frames[i - 1].time <= 20) expect(Math.abs(delta)).toBeLessThanOrEqual(distance * 0.25 + 1);
  }
  expect(frames.at(-1)!.animations).toBe(0);
  const tail = frames.slice(-12);
  expect(tail, 'Recording reaches twelve settled frames before its 8s cap').toHaveLength(12);
  expect(tail.every(frame => frame.animations === 0 && Math.abs(frame.height - tail[0].height) <= 0.02), 'An unfinished glide cannot pass at the recording cap').toBe(true);
}
for (const who of ["Victoria's list", 'Your list']) {
  test('public real-height hide/show glide: ' + who, async ({ page }, info) => {
    await page.goto('/');
    const region = page.getByRole('region', { name: who, exact: true });
    await region.scrollIntoViewIfNeeded();
    const card = region.locator('[data-task-card]');
    await expect(card).toBeVisible();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(800);
    const natural = (await card.boundingBox())!.height;
    let hide: Frame[] = [], show: Frame[] = [];
    try {
      hide = await sampleToggle(card, 'Collapse task card');
      assertGlide(hide);
      show = await sampleToggle(card, 'Expand task card');
      assertGlide(show);
      expect(Math.abs(show.at(-1)!.height - natural)).toBeLessThanOrEqual(1);
      expect(await card.evaluate(element => (element as HTMLElement).style.height)).toBe('');
    } finally {
      await persistJsonEvidence(info, 'height-frames', { body: JSON.stringify({ who, hide, show }), contentType: 'application/json' });
    }
  });
}
test('public hide/show restores focus after rapid toggles', async ({ page }) => {
  await page.goto('/');
  const region = page.getByRole('region', { name: 'Your list', exact: true });
  await region.scrollIntoViewIfNeeded();
  const card = region.locator('[data-task-card]');
  await page.waitForTimeout(800);
  const height = (await card.boundingBox())!.height;
  await card.getByRole('button', { name: 'Collapse task card', exact: true }).click();
  await card.getByRole('button', { name: 'Expand task card', exact: true }).click();
  await page.waitForTimeout(1000);
  expect(Math.abs((await card.boundingBox())!.height - height)).toBeLessThanOrEqual(1);
  await expect(card.getByRole('button', { name: 'Collapse task card', exact: true })).toBeFocused();
  expect(await card.evaluate(element => element.getAnimations().length)).toBe(0);
});

test('public reduced motion changes height without an intermediate shape', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const region = page.getByRole('region', { name: 'Your list', exact: true });
  const card = region.locator('[data-task-card]');
  await expect(card.getByRole('button', { name: 'Collapse task card' })).toBeVisible();
  await page.waitForTimeout(800);
  await region.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(300);
  const frames = await sampleToggle(card, 'Collapse task card');
  await persistJsonEvidence(info, 'reduced-motion-frames', { body: JSON.stringify(frames), contentType: 'application/json' });
  expect(frames[0].height).toBeGreaterThanOrEqual(148 - 0.02);
  expect(Math.abs(frames.at(-1)!.height - 46)).toBeLessThanOrEqual(0.02);
  expect(frames.at(-1)!.animations).toBe(0);
  expect(await card.evaluate(element => (element as HTMLElement).style.height)).toBe('');
  // One step, no intermediate height: the 160 -> 70 -> 46px transient this once had to allow for is
  // gone since style changes apply at once under reduced motion (d1ee368).
  expect(frames.slice(1).every(frame => Math.abs(frame.height - frames.at(-1)!.height) <= 1)).toBe(true);
});
