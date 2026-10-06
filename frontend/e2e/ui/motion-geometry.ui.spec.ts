import { expect, test, type Page } from '@playwright/test';
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

      const cards = await page.locator('[data-task-card]').evaluateAll((nodes) =>
        nodes.map((card) => {
          const c = card.getBoundingClientRect();
          const check = card.querySelector('button[aria-label="Mark as complete"], button[aria-label="Take it – start working"]');
          const eye = card.querySelector('button[aria-label="Collapse task card"]');
          if (!check || !eye) return null;
          const b = check.getBoundingClientRect();
          const e = eye.getBoundingClientRect();
          return {
            offCentre: b.top + b.height / 2 - (c.top + c.height / 2),
            eyeBottom: c.bottom - e.bottom,
            eyeLeft: e.left - c.left,
            gap: e.top - b.bottom,
          };
        }),
      );
      const open = cards.filter((c): c is NonNullable<typeof c> => c !== null);
      expect(open.length).toBeGreaterThanOrEqual(TITLES.length);
      for (const card of open) {
        expect(Math.abs(card.offCentre)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(card.eyeBottom - card.eyeLeft)).toBeLessThanOrEqual(0.5);
        // The two 44px hit areas never overlap.
        expect(card.gap).toBeGreaterThanOrEqual(14);
      }
    });
  }

  test('the droplet condenses in one motion, with no late one-frame snap', async () => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto('/tasks');
    await expect(page.locator('[data-task-card]').first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(800);

    const widths = await page.evaluate(async () => {
      window.scrollTo({ top: 0, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 600));
      const capsule = document.querySelector('div.fixed > header') as HTMLElement;
      const samples: number[] = [];
      let running = true;
      const tick = () => {
        samples.push(capsule.getBoundingClientRect().width);
        if (running) requestAnimationFrame(tick);
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

    const steps = widths.slice(1).map((w, i) => Math.abs(w - widths[i])).filter((d, i, all) => d > 0.05 || all.slice(0, i).some((x) => x > 0.05));
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
