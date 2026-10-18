import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { finishFrames, installMotionFrames, markAction, saveEvidence, startFrames, type FrameEvidence } from './_motion-frames';

const FRONTEND = process.env.E2E_FRONTEND_URL ?? 'http://127.0.0.1:3300';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const category = { id: '22222222-2222-4222-8222-222222222222', name: 'Work', icon: 'Briefcase' };
const task = {
  id: '33333333-3333-4333-8333-333333333333', userId: USER_ID, title: 'Dialog motion fixture',
  status: 'InProgress', priority: '3', isPublic: false, isCompleted: false, tags: [],
  createdAt: '2026-10-01T12:00:00Z', openSubtaskCount: 2,
};

/** Disposable browser-only identity; every API request is intercepted, with no real session. */
async function mockApi(context: BrowserContext) {
  const claims = { sub: USER_ID, email: 'motion@example.test', firstName: 'Motion', lastName: 'Fixture',
    email_verified: true, exp: Math.floor(Date.now() / 1000) + 3600 };
  const token = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.fixture`;
  await context.addCookies([{ name: 'XSRF-TOKEN', value: 'dialog-motion-fixture', url: FRONTEND }]);
  await context.route(/\/(?:auth|todos|categories|collaboration|messaging)\/api\/|\/friendships|\/realtime\//, async route => {
    const request = route.request();
    const url = new URL(request.url());
    let body: unknown = {};
    if (url.pathname.endsWith('/refresh')) body = { accessToken: token };
    else if (url.pathname.endsWith('/validate-token')) body = { isValid: true };
    else if (url.pathname.includes('/categories/api/')) body = [category];
    else if (url.pathname === '/todos/api/v1/todos') {
      const items = url.searchParams.get('isCompleted') === 'true' ? [] : [task];
      body = { items, totalCount: items.length, pageNumber: 1, pageSize: 200, totalPages: 1, hasNextPage: false, hasPreviousPage: false };
    } else if (url.pathname.includes('/friendships')) body = [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: {
      'Access-Control-Allow-Origin': new URL(FRONTEND).origin, 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    } });
  });
}

function assertFade(evidence: FrameEvidence, opening: boolean, reduce: boolean) {
  const frames = evidence.frames.filter(frame => frame.time >= (evidence.actionTime ?? 0));
  const visible = frames.filter(frame => frame.dialog !== null);
  expect(visible.length, 'The recorder observes the moving dialog').toBeGreaterThan(2);
  const opacity = visible.map(frame => frame.dialog!.opacity);
  for (let i = 1; i < opacity.length; i++) {
    expect(opening ? opacity[i] - opacity[i - 1] : opacity[i - 1] - opacity[i], 'Opacity never flashes backwards').toBeGreaterThanOrEqual(-0.00001);
  }
  if (opening) {
    expect(opacity.at(-1)).toBe(1);
    expect(opacity.some(value => value > 0 && value < 1), 'Entrance paints intermediate opacity').toBe(true);
  } else {
    expect(frames.at(-1)?.dialog).toBeNull();
    const firstAbsent = frames.findIndex(frame => frame.dialog === null);
    expect(frames.slice(firstAbsent).every(frame => frame.dialog === null), 'A closed dialog never flashes back into the DOM').toBe(true);
  }
  if (reduce) expect(visible.every(frame => Math.abs(frame.dialog!.scale - 1) < 0.00001)).toBe(true);
}

async function record(page: Page, info: TestInfo, name: string, action: () => Promise<unknown>, opening: boolean, reduce: boolean) {
  await startFrames(page);
  await markAction(page);
  await action();
  const evidence = await finishFrames(page);
  await saveEvidence(info, name, evidence);
  await page.screenshot({ path: info.outputPath(`${name}.png`) });
  assertFade(evidence, opening, reduce);
}

for (const reduce of [false, true]) {
  test.describe(`controlled dialogs (reduced motion: ${reduce})`, () => {
    test.beforeEach(async ({ context, page }) => {
      await page.emulateMedia({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
      await page.setViewportSize({ width: 1280, height: 900 });
      await mockApi(context);
      await installMotionFrames(context);
    });

    for (const path of ['/tasks', '/tasks/completed']) {
      test(`category filter opens and closes on ${path}`, async ({ page }, info) => {
        await page.goto(FRONTEND + path);
        const trigger = page.getByRole('button', { name: 'Choose categories' });
        await expect(trigger).toBeVisible();
        await record(page, info, 'filter-open', () => trigger.click(), true, reduce);
        await record(page, info, 'filter-close', () => page.keyboard.press('Escape'), false, reduce);
        await expect(trigger).toBeFocused();
      });
    }

    test('ConfirmDialog opens and closes without a flash', async ({ page }, info) => {
      await page.goto(FRONTEND + '/tasks');
      const trigger = page.getByRole('button', { name: 'Mark as complete', exact: true });
      await expect(trigger).toBeVisible();
      await record(page, info, 'confirm-open', () => trigger.click(), true, reduce);
      await expect(page.getByRole('dialog')).toHaveAccessibleName('Some subtasks are still open');
      await record(page, info, 'confirm-close', () => page.getByRole('button', { name: 'Keep working' }).click(), false, reduce);
      await expect(trigger).toBeFocused();
    });
  });
}
