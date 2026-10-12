import { writeFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'

type RailFrame = {
  time: number
  left: number
  right: number
  center: number
  first: number
  last: number
  fill: number
  position: number
  value: number
  column: number
  scale: number
}

declare global {
  interface Window {
    seatRailFrames: RailFrame[]
    seatRailRaf: number
    seatRailRead: (time: number) => void
  }
}

async function showRail(rail: Locator) {
  // On phones the gauge and the rail cannot both fit on screen. Show the gauge
  // first so the actual first-sight sweep runs before scrolling to the control.
  await rail.locator('xpath=../../../..').locator(':scope > div').first().scrollIntoViewIfNeeded()
  await expect(rail).toHaveAttribute('aria-valuenow', '3', { timeout: 10_000 })
  await rail.scrollIntoViewIfNeeded()
}

async function record(page: Page) {
  await page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>('[role="slider"][aria-labelledby="ring-people"]')!
    window.seatRailFrames = []
    const sample = (time: number) => {
      const box = rail.getBoundingClientRect()
      const ring = rail.lastElementChild!.getBoundingClientRect()
      const fill = rail.children[2].getBoundingClientRect()
      const seats = rail.children[3]
      const start = seats.firstElementChild!.getBoundingClientRect()
      const end = seats.lastElementChild!.getBoundingClientRect()
      const first = start.left + start.width / 2
      const last = end.left + end.width / 2
      const center = ring.left + ring.width / 2
      window.seatRailFrames.push({ time, left: box.left, right: box.right, center, first, last,
        fill: fill.width / (last - first), position: (center - first) / (last - first),
        value: Number(rail.getAttribute('aria-valuenow')),
        column: Number((rail.lastElementChild as HTMLElement).style.transform.match(/translateX\(([-\d.]+)%\)/)?.[1] ?? 0) / 100,
        scale: Number((rail.children[2] as HTMLElement).style.transform.match(/scaleX\(([-\d.]+)\)/)?.[1] ?? 1) })
    }
    window.seatRailRead = sample
    const frame = (time: number) => {
      sample(time)
      window.seatRailRaf = requestAnimationFrame(frame)
    }
    window.seatRailRaf = requestAnimationFrame(frame)
  })
}

function verify(frames: RailFrame[], geometryTolerance: number) {
  expect(frames.length).toBeGreaterThan(5)
  for (const frame of frames) {
    expect(Number.isFinite(frame.center)).toBe(true)
    expect(frame.center).toBeGreaterThanOrEqual(frame.left)
    expect(frame.center).toBeLessThanOrEqual(frame.right)
    expect(frame.center).toBeGreaterThanOrEqual(frame.first - geometryTolerance)
    expect(frame.center).toBeLessThanOrEqual(frame.last + geometryTolerance)
    expect(frame.fill).toBeGreaterThanOrEqual(0)
    expect(frame.fill).toBeLessThanOrEqual(1.001)
    expect(frame.column).toBeGreaterThanOrEqual(0)
    expect(frame.column).toBeLessThanOrEqual(10)
    expect(Math.abs(frame.scale - frame.column / 10)).toBeLessThan(0.001)
  }
  const last = frames.at(-1)!
  // Subpixel residuals are visually settled; keep the 450ms deadline and a 1px limit.
  expect(Math.abs(last.column - last.value) * (last.last - last.first) / 10).toBeLessThan(1)
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`seat rail stays bounded through interruptions at ${viewport.width}px`, async ({ page, browserName }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('/', { waitUntil: 'networkidle' })
    const rail = page.getByRole('slider', { name: 'People who can see it' })
    await showRail(rail)
    await page.waitForTimeout(450)
    await record(page)
    const box = (await rail.boundingBox())!
    const y = box.y + box.height / 2
    for (let gesture = 0; gesture < 4; gesture++) {
      await page.mouse.move(box.x + box.width / 2, y)
      await page.mouse.down()
      for (let i = 0; i < 8; i++) await page.mouse.move(box.x + box.width * (i % 2 ? -0.5 : 1.5), y)
      if (gesture === 1) await rail.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse' })
      await page.mouse.up()
    }
    for (const seat of [10, 0, 8, 1, 9, 2, 7, 3]) {
      await page.mouse.click(box.x + box.width * (seat + 0.5) / 11, y)
      await page.waitForTimeout(100)
    }
    await rail.focus()
    await page.evaluate(async () => {
      const rail = document.querySelector<HTMLElement>('[role="slider"][aria-labelledby="ring-people"]')!
      for (let i = 0; i < 45; i++) {
        rail.dispatchEvent(new KeyboardEvent('keydown', { key: i % 2 ? 'Home' : 'End', bubbles: true }))
        await new Promise(resolve => setTimeout(resolve, 18))
      }
      for (const key of ['Home', ...Array<string>(20).fill('ArrowRight'), ...Array<string>(20).fill('ArrowLeft'), 'PageUp', 'PageDown', 'End', 'ArrowLeft']) {
        rail.dispatchEvent(new KeyboardEvent('keydown', { key, repeat: key.startsWith('Arrow'), bubbles: true }))
        await new Promise(resolve => setTimeout(resolve, 22))
      }
    })
    await expect(rail).toHaveAttribute('aria-valuenow', '9')
    await page.waitForTimeout(450)
    const frames = await page.evaluate(() => {
      cancelAnimationFrame(window.seatRailRaf)
      // A rAF observer can run before Framer renders that frame. Read the current
      // DOM again at the deadline instead of treating that earlier sample as final.
      window.seatRailRead(performance.now())
      return window.seatRailFrames
    })
    const framePath = testInfo.outputPath('seat-rail-frames.json')
    await writeFile(framePath, JSON.stringify(frames))
    await testInfo.attach('seat-rail-frames', { path: framePath, contentType: 'application/json' })
    // WebKit's rounded percentage geometry differs by up to 1.9px at 390px.
    // The numeric coordinate and fill above still agree exactly in every frame.
    verify(frames, browserName === 'webkit' ? 2 : 0.25)
  })
}

test('reduced motion puts the ring and fill on the selected seat immediately', async ({ page, browserName }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/', { waitUntil: 'networkidle' })
  const rail = page.getByRole('slider', { name: 'People who can see it' })
  await showRail(rail)
  await rail.focus()
  for (const key of ['End', 'Home']) {
    await page.keyboard.press(key)
    await expect(rail).toHaveAttribute('aria-valuenow', key === 'End' ? '10' : '0')
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(await rail.evaluate((el, key) => {
      const wrapper = el.lastElementChild!.getBoundingClientRect()
      const seats = el.children[3]
      const seat = (key === 'End' ? seats.lastElementChild! : seats.firstElementChild!).getBoundingClientRect()
      return Math.abs(wrapper.left + wrapper.width / 2 - seat.left - seat.width / 2)
    }, key)).toBeLessThan(browserName === 'webkit' ? 2 : 0.25)
    const fill = await rail.evaluate(el => el.children[2].getBoundingClientRect().width)
    if (key === 'End') expect(fill).toBeGreaterThan(0)
    else expect(fill).toBe(0)
  }
})
