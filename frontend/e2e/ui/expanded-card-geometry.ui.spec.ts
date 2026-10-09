import { expect, test, type Locator, type Page } from '@playwright/test';
import { persistJsonEvidence,
  assertGeometry, beginRailLayoutObservation, createExpandedGeometryFixtures, endRailLayoutObservation,
  expandedGeometryCard, GeometryRateBudget, hideRevealFixture, measureCard,
  type ExpandedGeometryCase, type ExpandedGeometryFixtures, type GeometryMeasurement,
} from './_card-geometry';
import { FRONTEND_BASE, requireFrontendReachable } from './_helpers';

type Surface = '/tasks' | '/dashboard' | '/tasks/completed';
type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type ContentMeasurement = {
  card: Rect; titleRects: Rect[]; descriptionRects: Rect[]; chipRows: number; dueRows: number;
  overflow: string[]; collisions: string[]; mobileDelete: Rect | null;
};
type CollapsedMeasurement = { height: number; hitWidth: number; hitHeight: number; overflow: boolean; titleCount: number; completionCount: number };
type CardMeasurement = {
  surface: Surface; mount: string; pageNumber: number; fixture: string; phase: string;
  mode: 'rail' | 'completed' | 'collapsed'; rail: GeometryMeasurement | null;
  content: ContentMeasurement | null; collapsed: CollapsedMeasurement | null;
};
type GridMeasurement = {
  surface: Surface; mount: string; pageNumber: number; width: number;
  grids: Array<{ columns: Array<{ height: number; cards: number }>; heightDifference: number }>;
  overlaps: Array<{ first: number; second: number; area: number }>; horizontalOverflow: number;
};

async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(900);
}

async function mountedCases(page: Page, cases: ExpandedGeometryCase[]) {
  const counts = await Promise.all(cases.map(item => expandedGeometryCard(page, item).count()));
  return cases.filter((_, index) => counts[index] === 1);
}

async function loadTaskWindow(page: Page, cases: ExpandedGeometryCase[], budget: GeometryRateBudget) {
  const active = cases.filter(item => !item.completed);
  const completedCount = cases.filter(item => item.completed).length;
  await budget.loaded(async () => (await mountedCases(page, active)).length > 0
    && await page.getByRole('button', { name: new RegExp(`^Completed\\s+${completedCount}$`) }).isVisible());
  // Tasks progressively mounts batches; missing DOM cards do not mean they are absent from the API.
  for (let batch = 0; batch < active.length; batch++) {
    const current = await mountedCases(page, active);
    if (current.length === active.length) break;
    await page.evaluate(() => {
      const sentinel = document.querySelector<HTMLElement>('div[aria-hidden="true"].h-6.w-full');
      if (sentinel) sentinel.scrollIntoView({ block: 'center', behavior: 'instant' });
      else window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    });
    await budget.loaded(async () => (await mountedCases(page, active)).length > current.length);
  }
  expect((await mountedCases(page, active)).map(item => item.key).sort(), 'All active fixtures mount after real scrolling').toEqual(active.map(item => item.key).sort());
}

async function navigate(page: Page, surface: Surface, cases: ExpandedGeometryCase[], budget: GeometryRateBudget) {
  await budget.wait();
  const destination = surface === '/tasks/completed' ? '/tasks' : surface;
  if (new URL(page.url()).pathname !== destination) {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    if (page.viewportSize()!.width < 640) {
      await page.getByRole('button', { name: 'Open menu', exact: true }).click();
      await page.getByTestId('navbar-mobile').locator(`a[href="${destination}"]`).click();
    } else {
      await page.getByTestId('navbar-desktop').locator(`a[href="${destination}"]`).click();
    }
    await expect.poll(() => new URL(page.url()).pathname).toBe(destination);
  }
  if (destination === '/tasks') {
    await loadTaskWindow(page, cases, budget);
    const completedCount = cases.filter(item => item.completed).length;
    const completed = page.getByRole('button', { name: new RegExp(`^Completed\\s+${completedCount}$`) });
    await expect(completed).toBeVisible();
    if (await completed.getAttribute('aria-expanded') !== 'true') await completed.click();
    if (surface === '/tasks/completed') {
      await page.getByRole('link', { name: 'Open the archive', exact: true }).click();
      await expect(page).toHaveURL(/\/tasks\/completed$/);
    }
  }
  const expected = cases.filter(item => surface === '/dashboard' ? !item.completed : surface === '/tasks/completed' ? item.completed : true);
  await budget.loaded(async () => {
    const mounted = await mountedCases(page, expected);
    return surface === '/dashboard' ? mounted.length > 0 : mounted.length === expected.length;
  });
  await settled(page);
}

async function measureContent(card: Locator): Promise<ContentMeasurement> {
  return card.evaluate(element => {
    const rect = (item: Element): Rect => {
      const box = item.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    };
    const bounds = rect(element);
    const body = element.querySelector<HTMLElement>('.flex-1.min-w-0')!;
    const textRects = (text: Element | null): Rect[] => {
      if (!text) return [];
      const bounds = text.getBoundingClientRect();
      const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
      const boxes: Rect[] = [];
      while (walker.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        for (const box of Array.from(range.getClientRects())) {
          // Range includes lines clipped by line-clamp; measure only the rendered lines.
          if (box.width && box.top < bounds.bottom - 0.1 && box.bottom > bounds.top + 0.1) {
            boxes.push({ left: box.left, top: Math.max(box.top, bounds.top), right: box.right,
              bottom: Math.min(box.bottom, bounds.bottom), width: box.width,
              height: Math.min(box.bottom, bounds.bottom) - Math.max(box.top, bounds.top) });
          }
        }
      }
      return boxes;
    };
    const titleRects = textRects(body.querySelector('h3'));
    const descriptionRects = textRects(body.querySelector('p'));
    const rows = Array.from(body.querySelectorAll<HTMLElement>('.flex-wrap'));
    const chips = rows.flatMap((row, rowIndex) => Array.from(row.children).map((child, childIndex) => ({
      label: `metadata-${rowIndex}-${childIndex}`, box: rect(child),
    }))).filter(item => item.box.width > 0 && item.box.height > 0);
    const firstRow = rows[0];
    const centers: number[] = [];
    for (const child of Array.from(firstRow?.children ?? [])) {
      const box = child.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const center = box.top + box.height / 2;
      if (!centers.some(existing => Math.abs(existing - center) < 2)) centers.push(center);
    }
    const mobileButton = element.querySelector<HTMLButtonElement>('button[aria-label^="Delete task:"]');
    const mobileDelete = mobileButton && mobileButton.getBoundingClientRect().width ? rect(mobileButton) : null;
    const eye = element.querySelector<HTMLButtonElement>('button[aria-label="Collapse task card"]');
    const boxes = [
      ...titleRects.map((box, index) => ({ label: 'title-' + index, box })),
      ...descriptionRects.map((box, index) => ({ label: 'description-' + index, box })),
      ...chips,
      ...(eye ? [{ label: 'eye', box: rect(eye) }] : []),
      ...(mobileDelete ? [{ label: 'mobile-delete', box: mobileDelete }] : []),
    ];
    const overflow = boxes.filter(({ box }) => box.left < bounds.left - 0.02 || box.right > bounds.right + 0.02
      || box.top < bounds.top - 0.02 || box.bottom > bounds.bottom + 0.02).map(item => item.label);
    const intersects = (a: Rect, b: Rect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.02
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.02;
    const collisions: string[] = [];
    for (const title of titleRects) {
      for (const item of chips) if (intersects(title, item.box)) collisions.push('title/' + item.label);
      if (eye && intersects(title, rect(eye))) collisions.push('title/eye');
      if (mobileDelete && intersects(title, mobileDelete)) collisions.push('title/mobile-delete');
    }
    if (mobileDelete) {
      for (const item of chips) if (intersects(mobileDelete, item.box)) collisions.push('mobile-delete/' + item.label);
      if (eye && intersects(mobileDelete, rect(eye))) collisions.push('mobile-delete/eye');
    }
    return { card: bounds, titleRects, descriptionRects, chipRows: centers.length,
      dueRows: rows.filter(row => row.classList.contains('mt-3')).length, overflow, collisions, mobileDelete };
  });
}

async function measureCollapsed(card: Locator): Promise<CollapsedMeasurement> {
  return card.evaluate(element => {
    const expand = element.querySelector<HTMLButtonElement>('button[aria-label="Expand task card"]')!;
    const card = element.getBoundingClientRect();
    const button = expand.getBoundingClientRect();
    const style = getComputedStyle(expand);
    const pseudo = getComputedStyle(expand, '::after');
    const matrix = new DOMMatrixReadOnly(pseudo.transform);
    const scaleX = button.width / expand.offsetWidth, scaleY = button.height / expand.offsetHeight;
    const hitWidth = parseFloat(pseudo.width) * scaleX, hitHeight = parseFloat(pseudo.height) * scaleY;
    const left = button.left + (parseFloat(style.borderLeftWidth) + parseFloat(pseudo.left) + matrix.e) * scaleX;
    const top = button.top + (parseFloat(style.borderTopWidth) + parseFloat(pseudo.top) + matrix.f) * scaleY;
    return { height: card.height, hitWidth, hitHeight,
      overflow: left < card.left - 0.02 || left + hitWidth > card.right + 0.02 || top < card.top - 0.02 || top + hitHeight > card.bottom + 0.02,
      titleCount: element.querySelectorAll('h3').length,
      completionCount: element.querySelectorAll('[data-completion-circle]').length };
  });
}

async function measureGrids(page: Page, surface: Surface, mount: string, pageNumber: number): Promise<GridMeasurement> {
  const result = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-task-card]'))
      .filter(card => card.getBoundingClientRect().width > 0);
    const rectangles = cards.map(card => card.getBoundingClientRect());
    const overlaps: Array<{ first: number; second: number; area: number }> = [];
    for (let first = 0; first < rectangles.length; first++) {
      for (let second = first + 1; second < rectangles.length; second++) {
        const a = rectangles[first], b = rectangles[second];
        const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (width > 0.02 && height > 0.02) overlaps.push({ first, second, area: width * height });
      }
    }
    const roots = new Set<Element>();
    for (const card of cards) {
      const column = card.closest('[class~="relative"][class~="flex-col"][class~="flex-1"]');
      if (!column?.parentElement) throw new Error('Expected a real task masonry column');
      roots.add(column.parentElement);
    }
    const grids = Array.from(roots).map(root => {
      const columns = Array.from(root.children).map(column => ({
        height: column.getBoundingClientRect().height, cards: column.querySelectorAll('[data-task-card]').length,
      }));
      const heights = columns.map(column => column.height);
      return { columns, heightDifference: Math.max(...heights) - Math.min(...heights) };
    });
    return { grids, overlaps, horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth };
  });
  expect(result.overlaps, `${surface}/${mount}/page-${pageNumber}: real cards do not overlap`).toEqual([]);
  expect(result.horizontalOverflow, 'The task surface has no horizontal overflow').toBeLessThanOrEqual(1);
  return { surface, mount, pageNumber, width: page.viewportSize()!.width, ...result };
}

let fixtures: ExpandedGeometryFixtures;
test.describe('expanded real-service card geometry', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(360_000);
    await requireFrontendReachable();
    fixtures = await createExpandedGeometryFixtures(browser);
  });
  test.afterAll(async () => {
    await fixtures?.owner.context.close();
    await fixtures?.friend.context.close();
  });

  for (const dpr of [1, 2]) {
    for (const width of [390, 768, 1280, 1600]) {
      test(`expanded states ${width}px at DPR ${dpr}`, async ({ browser }, info) => {
        test.setTimeout(660_000);
        await hideRevealFixture(fixtures);
        const context = await browser.newContext({ baseURL: FRONTEND_BASE, viewport: { width, height: 1000 }, deviceScaleFactor: dpr, storageState: fixtures.storage });
        const page = await context.newPage();
        const budget = new GeometryRateBudget(page);
        const measurements: CardMeasurement[] = [];
        const grids: GridMeasurement[] = [];
        const layoutShifts: Array<{ surface: Surface; mount: string; fixture: string; score: number | null; shifts: unknown[] }> = [];
        const baselineHeights = new Map<string, number>();
        let clsSupported = false;
        try {
          await page.goto('/tasks');
          clsSupported = await page.evaluate(() => PerformanceObserver.supportedEntryTypes.includes('layout-shift'));
          if (!clsSupported) info.annotations.push({ type: 'unsupported metric', description: 'This browser does not expose layout-shift; no zero-CLS claim.' });

          const collect = async (surface: Surface, mount: string, pageNumber: number, item: ExpandedGeometryCase, phase: string) => {
            const card = expandedGeometryCard(page, item);
            await expect(card).toHaveCount(1);
            if (item.hidden) {
              const collapsed = await measureCollapsed(card);
              expect(collapsed.hitWidth).toBeGreaterThanOrEqual(44 - 0.001);
              expect(collapsed.hitHeight).toBeGreaterThanOrEqual(44 - 0.001);
              expect(Math.abs(collapsed.height - 46), 'Hidden shape retains its natural 46px height').toBeLessThanOrEqual(0.02);
              expect(collapsed.overflow, 'Hidden expand hit target stays inside the card').toBe(false);
              expect(collapsed.titleCount, 'Hidden API data does not expose a task title').toBe(0);
              expect(collapsed.completionCount, 'Collapsed shape has no completion circle').toBe(0);
              const value: CardMeasurement = { surface, mount, pageNumber, fixture: item.key, phase, mode: 'collapsed', rail: null, content: null, collapsed };
              measurements.push(value);
              return collapsed.height;
            }
            const rail = await measureCard(card);
            const content = await measureContent(card);
            measurements.push({ surface, mount, pageNumber, fixture: item.key, phase, mode: item.completed ? 'completed' : 'rail', rail, content, collapsed: null });
            assertGeometry(rail, item.completed, `${surface}/${mount}/${item.key}/${phase}`);
            expect(content.overflow, 'Title, description, chips, eye and mobile delete stay inside the card').toEqual([]);
            expect(content.collisions, 'Visible title/chips/eye/mobile delete do not overlap').toEqual([]);
            expect(content.titleRects.length).toBeGreaterThan(0);
            if (!item.completed) {
              expect(rail.height).toBeGreaterThanOrEqual(160 - 0.02);
              const eye = card.getByRole('button', { name: 'Collapse task card', exact: true });
              expect(await eye.evaluate(element => element.closest('.flex-wrap') === null
                && !!element.parentElement?.querySelector('[data-completion-circle]')), 'Eye always shares the completion rail').toBe(true);
            }
            if (item.expectedTitleLines) expect(rail.titleLines, `${item.key} renders the requested title line count`).toBe(item.expectedTitleLines);
            if (item.description) expect(content.descriptionRects.length).toBeGreaterThan(0);
            if (item.dueDate) expect(content.dueRows).toBeGreaterThan(0);
            if (item.expectedDelay) {
              await expect(card.getByText(/^Expected /)).toBeVisible();
              await expect(card.getByText(/^\d.* delay$/)).toBeVisible();
            }
            if (item.wrappedChips) expect(content.chipRows, 'Long shared metadata actually wraps').toBeGreaterThanOrEqual(2);
            if (item.overdue) {
              await expect(card.getByText('Overdue', { exact: true })).toBeVisible();
              await expect(card.getByRole('img', { name: /^Priority 5 of 5/ })).toBeVisible();
            }
            if (item.inProgress) await expect(card.getByRole('button', { name: 'Mark as complete', exact: true })).toBeVisible();
            if (item.key === 'own-short') expect(Math.abs(rail.height - 160), 'Minimum short rail stays at the necessary 160px').toBeLessThanOrEqual(0.02);
            return rail.height;
          };

          const exercise = async (surface: Surface, mount: string, pageNumber: number, item: ExpandedGeometryCase) => {
            const card = expandedGeometryCard(page, item);
            await card.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
            await page.mouse.move(0, 0);
            await page.waitForTimeout(650);
            if (clsSupported) await beginRailLayoutObservation(page);
            const height = await collect(surface, mount, pageNumber, item, 'settled');
            const key = surface + '/' + item.key;
            if (mount === 'first') baselineHeights.set(key, height);
            else expect(Math.abs(height - baselineHeights.get(key)!), 'Repeated mounts preserve settled natural height').toBeLessThanOrEqual(0.02);
            const cardBox = (await card.boundingBox())!;
            await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
            await page.waitForTimeout(250);
            expect(Math.abs((await collect(surface, mount, pageNumber, item, 'card-hover')) - height)).toBeLessThanOrEqual(0.02);
            const names = item.hidden ? ['Expand task card'] : item.completed ? ['Mark as incomplete'] : [
              await card.getByRole('button', { name: 'Take it – start working', exact: true }).count() ? 'Take it – start working' : 'Mark as complete', 'Collapse task card',
            ];
            for (const name of names) {
              const control = card.getByRole('button', { name, exact: true });
              const box = (await control.boundingBox())!;
              await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
              await page.waitForTimeout(250);
              expect(Math.abs((await collect(surface, mount, pageNumber, item, name + '-hover')) - height), 'Control hover cannot change height or rail mode').toBeLessThanOrEqual(0.02);
            }
            const observation = clsSupported ? await endRailLayoutObservation(page) : { score: null, shifts: [] };
            layoutShifts.push({ surface, mount, fixture: item.key, ...observation });
            if (clsSupported) expect(observation.score, 'Settled control gestures cause zero CLS').toBe(0);
          };

          for (const mount of ['first', 'repeat']) {
            for (const surface of ['/tasks', '/dashboard', '/tasks/completed'] as const) {
              await navigate(page, surface, fixtures.cases, budget);
              const expected = fixtures.cases.filter(item => surface === '/dashboard' ? !item.completed : surface === '/tasks/completed' ? item.completed : true);
              const visited = new Set<string>();
              for (let pageNumber = 1; pageNumber <= expected.length; pageNumber++) {
                await settled(page);
                const current = await mountedCases(page, expected);
                expect(current.length, 'Current real page contains at least one fixture').toBeGreaterThan(0);
                grids.push(await measureGrids(page, surface, mount, pageNumber));
                for (const item of current) {
                  expect(visited.has(item.key), 'Pagination does not repeat fixture cards').toBe(false);
                  await exercise(surface, mount, pageNumber, item);
                  visited.add(item.key);
                }
                if (surface !== '/dashboard') break;
                const next = page.getByRole('navigation', { name: 'Pagination', exact: true }).getByRole('button', { name: 'Next page', exact: true });
                if (await next.count() === 0 || await next.isDisabled()) break;
                const previous = current.map(item => item.key).sort().join('|');
                await budget.wait();
                await next.click();
                await budget.loaded(async () => {
                  const active = await page.getByRole('navigation', { name: 'Pagination', exact: true }).locator('button[aria-current="page"]').getAttribute('aria-label');
                  const mounted = await mountedCases(page, expected);
                  return active === 'Page ' + (pageNumber + 1) && mounted.length > 0
                    && mounted.map(item => item.key).sort().join('|') !== previous;
                });
              }
              expect([...visited].sort(), `${surface}/${mount}: all eligible fixtures are measured across real pages`).toEqual(expected.map(item => item.key).sort());
            }
          }

          await navigate(page, '/tasks', fixtures.cases, budget);
          for (const resized of [390, 768, 1280, 1600, 1280, 768, 390, width]) {
            await page.setViewportSize({ width: resized, height: 1000 });
            await settled(page);
            grids.push(await measureGrids(page, '/tasks', 'resize-' + resized, 1));
            for (const item of fixtures.cases) {
              const height = await collect('/tasks', 'resize-' + resized, 1, item, 'resize-settled');
              if (resized === width) expect(Math.abs(height - baselineHeights.get('/tasks/' + item.key)!), 'Round-trip resize retains the same natural height').toBeLessThanOrEqual(0.02);
            }
          }
        } finally {
          await persistJsonEvidence(info, 'expanded-card-geometry.json', {
            body: JSON.stringify({ width, dpr, browser: browser.version(), cases: fixtures.cases.map(item => item.key), measurements,
              grids, layoutShifts, clsSupported, rateLimits: budget.events, rateWaitsMs: budget.waits,
              notApplicable: [
                { surface: '/dashboard', state: 'completed', reason: 'Dashboard requests active tasks only' },
                { surface: '/tasks/completed', state: 'active/hidden', reason: 'Archive requests completed tasks only' },
                { state: 'hidden', metric: 'completion rail', reason: 'Collapsed cards expose only an expand control' },
              ] }, null, 2), contentType: 'application/json',
          });
          // Rotated fixture cookies remain in memory only, never in the JSON artifact.
          fixtures.storage = await context.storageState();
          await context.close();
        }
      });
    }
  }
});
