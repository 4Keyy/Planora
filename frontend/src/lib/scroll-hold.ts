/**
 * Keeps the page still while something on it changes height, and moves the view only where it
 * has to — gently, and by one hand.
 *
 * ## What went wrong
 *
 * Hiding a card while scrolled down pulled the whole page up under the reader, abruptly, in two
 * ways at once (measured frame by frame, 2026-10-12):
 *
 * - **Scroll anchoring.** Chrome keeps an element in view still by scrolling the page whenever
 *   something above it changes size. When that anchor sat below the hidden card in its column, the
 *   page was dragged up by the card's whole height on the card's own spring, which is fastest at
 *   the start — 62px in one frame, 204px at a quarter of the CPU, 255px on a phone. When the anchor
 *   sat in another column nothing moved at all: the same press behaved two ways.
 * - **Clamping.** A page that ends up shorter than the scroll position is clamped at once, and a
 *   single read of a height after the card's content changed — before its glide had pinned the
 *   old height back — was enough: a one-frame jump at the very start.
 *
 * ## What happens instead
 *
 * While a hold is open, scroll anchoring is off and the document is held at least as tall as the
 * bottom of the view (`body` `min-height`), so the browser moves nothing by itself. The view is
 * then moved by one hand, on a critically damped follower — it starts from rest, never jumps and
 * lands without passing its mark — towards the one place it has to be:
 *
 * - where the reader was, if the page is still long enough for it;
 * - the new bottom of the page, if the page became shorter than that;
 * - where a hold asked it to go (`to`) — the top of a list that was just paged;
 * - and, in any case, far enough to keep in view what a hold asks to `show` — the row a card
 *   folded into, or the control the keyboard was handed.
 *
 * The follower trails the glides that move the page, so the view settles a beat after the card
 * does, the way the page lifts when the New task plate closes. The reader's own input — a wheel,
 * a touch, a key, a press, or any scroll the follower did not make — hands the page back at once.
 * Reduced motion holds nothing: the browser's own one-step behaviour is the honest one there.
 *
 * `primeScrollHold()` must run before anything reads layout after the change. It writes the hold
 * from the last scroll position seen, which needs no layout, so the clamp never gets its frame;
 * `useHeightTransition` calls it from an insertion effect, ahead of every layout read of the
 * commit that changes a card's shape.
 */

/** rad/s. Critically damped: settles about half a second after its target stops moving. */
const FOLLOW_OMEGA = 13
/** The reader's own input. Any of these hands the page back. */
const USER_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const
/** Air between the floating bar, or the bottom of the screen, and what is kept in view. */
const SHOW_MARGIN_PX = 12

export interface ScrollHoldOptions {
  /**
   * What must stay in view while the hold is open, asked every frame: the row a card is folding
   * into, the control focus was handed to. It is brought to the nearest edge, never centred.
   */
  show?: () => Element | null
  /** Where the view should glide to, in document px, instead of staying where the reader was. */
  to?: number
}

interface Hold {
  show: (() => Element | null) | null
}

interface Session {
  /** Where the reader is: where they were when the hold began, or where a hold sent them. */
  origin: number
  y: number
  v: number
  last: number
  frame: number
  /** The scroll position the follower last wrote: anything else moving the page is the reader. */
  written: number
  /** Where the follower was headed in the last frame. */
  goal: number
  /** `--bar-clearance` in px. Measured in the first frame: it is a `calc()` over `env()`. */
  clearance: number | null
  snapshot: { anchor: string; behavior: string; minHeight: string }
}

const holds = new Set<Hold>()
let session: Session | null = null
let lastScrollY = 0
let tracking = 0

const prefersReducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

const onScroll = () => {
  lastScrollY = window.scrollY
}

/**
 * Remember the scroll position as it changes, so a hold can be written without reading layout —
 * in Chrome even `window.scrollY` lays the page out first. Reference-counted: call it while
 * something that can open holds is mounted.
 */
export function trackScrollPosition(): () => void {
  if (typeof window === "undefined") return () => {}
  if (tracking++ === 0) {
    lastScrollY = window.scrollY
    window.addEventListener("scroll", onScroll, { passive: true })
  }
  let released = false
  return () => {
    if (released) return
    released = true
    if (--tracking === 0) window.removeEventListener("scroll", onScroll)
  }
}

/** The bottom of the page's own content — what the document's height would be without the hold. */
function naturalHeight(): number {
  let bottom = 0
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement)) continue
    const style = getComputedStyle(child)
    if (style.display === "none" || style.position === "fixed" || style.position === "absolute") continue
    bottom = Math.max(bottom, child.getBoundingClientRect().bottom + window.scrollY + (parseFloat(style.marginBottom) || 0))
  }
  return bottom + (parseFloat(getComputedStyle(document.body).paddingBottom) || 0)
}

/**
 * The floating bar's room at the top (`--bar-clearance`, a `calc()` over `env()`), resolved by
 * laying a probe out against it. Reads layout: call it from an event, never mid-commit.
 */
export function barClearance(): number {
  if (typeof document === "undefined") return 0
  return measureClearance()
}

function measureClearance(): number {
  const probe = document.createElement("div")
  probe.setAttribute("aria-hidden", "true")
  probe.style.cssText =
    "position:fixed;top:0;left:0;width:0;height:var(--bar-clearance,0px);visibility:hidden;pointer-events:none"
  document.body.appendChild(probe)
  const height = probe.getBoundingClientRect().height
  probe.remove()
  return Number.isFinite(height) ? height : 0
}

function target(s: Session): number {
  const view = window.innerHeight
  const max = Math.max(0, naturalHeight() - view)
  let goal = Math.min(s.origin, max)
  const clearance = (s.clearance ??= measureClearance())
  for (const hold of holds) {
    const element = hold.show?.()
    if (!element?.isConnected) continue
    const box = element.getBoundingClientRect()
    const top = box.top + window.scrollY
    const bottom = box.bottom + window.scrollY
    if (top < goal + clearance + SHOW_MARGIN_PX) {
      goal = top - clearance - SHOW_MARGIN_PX
    } else if (bottom > goal + view - SHOW_MARGIN_PX) {
      // The nearest edge, but never so far that its top leaves the view.
      goal = Math.min(bottom - view + SHOW_MARGIN_PX, top - clearance - SHOW_MARGIN_PX)
    }
  }
  return Math.max(0, Math.min(goal, max))
}

function end(): void {
  const s = session
  if (!s) return
  session = null
  cancelAnimationFrame(s.frame)
  for (const type of USER_EVENTS) window.removeEventListener(type, end, true)
  const html = document.documentElement
  html.style.overflowAnchor = s.snapshot.anchor
  html.style.scrollBehavior = s.snapshot.behavior
  document.body.style.minHeight = s.snapshot.minHeight
  lastScrollY = window.scrollY
}

function step(now: number): void {
  const s = session
  if (!s) return
  // Someone else moved the page — a scrollbar drag, find-in-page, a focus — and it is theirs now.
  if (Math.abs(window.scrollY - s.written) > 1) {
    end()
    return
  }
  // A stalled frame moves the view on by two frames at most, as a stalled glide does.
  const dt = Math.min(2 / 60, Math.max(0, (now - s.last) / 1000))
  s.last = now
  const goal = target(s)
  s.goal = goal
  const offset = s.y - goal
  const accel = -FOLLOW_OMEGA * FOLLOW_OMEGA * offset - 2 * FOLLOW_OMEGA * s.v
  s.v += accel * dt
  s.y += s.v * dt
  // Critically damped already lands without passing; this guards a goal that moved toward us.
  if ((s.y - goal) * offset < 0) {
    s.y = goal
    s.v = 0
  }
  // The hold follows the view, so the page's end is free to shrink up to the bottom of the view.
  document.body.style.minHeight = `${Math.ceil(s.y + window.innerHeight)}px`
  if (Math.abs(window.scrollY - s.y) >= 0.5) window.scrollTo(0, s.y)
  s.written = window.scrollY

  const settled = Math.abs(s.y - goal) < 0.5 && Math.abs(s.v) < 4
  if (holds.size === 0 && settled) {
    // Land exactly on the mark: the last write may sit up to half a pixel short of it.
    if (Math.abs(window.scrollY - goal) >= 0.5) window.scrollTo(0, goal)
    end()
    return
  }
  s.frame = requestAnimationFrame(step)
}

/**
 * Writes the hold before anything reads layout: anchoring off, the document as tall as the view's
 * bottom. Safe to call while a hold is already open, and cheap when nothing follows it — the hold
 * lets go on the next frame if nothing asked to keep it.
 */
export function primeScrollHold(): void {
  if (typeof window === "undefined" || typeof requestAnimationFrame !== "function") return
  if (session || prefersReducedMotion()) return
  const html = document.documentElement
  const body = document.body
  const snapshot = { anchor: html.style.overflowAnchor, behavior: html.style.scrollBehavior, minHeight: body.style.minHeight }
  const y = tracking > 0 ? lastScrollY : window.scrollY
  html.style.overflowAnchor = "none"
  html.style.scrollBehavior = "auto"
  body.style.minHeight = `${Math.ceil(y + window.innerHeight)}px`
  session = { origin: y, y, v: 0, last: performance.now(), frame: 0, written: y, goal: y, clearance: null, snapshot }
  for (const type of USER_EVENTS) window.addEventListener(type, end, { capture: true, passive: true })
  session.frame = requestAnimationFrame(step)
}

/**
 * Opens a hold for as long as something changes height. The returned function closes it; the view
 * finishes its glide and the page is handed back once every hold is closed.
 */
export function holdScroll({ show, to }: ScrollHoldOptions = {}): () => void {
  if (typeof window === "undefined" || typeof requestAnimationFrame !== "function" || prefersReducedMotion()) return () => {}
  primeScrollHold()
  if (session && to !== undefined) session.origin = Math.max(0, to)
  const hold: Hold = { show: show ?? null }
  holds.add(hold)
  return () => {
    if (!holds.delete(hold)) return
    // What it showed is where the reader is now: the view stays there rather than going back.
    if (hold.show && session) session.origin = session.goal
  }
}

/** Whether a hold is moving the page now. */
export function isScrollHeld(): boolean {
  return session !== null
}

/** Test seam. */
export function resetScrollHoldForTests(): void {
  holds.clear()
  end()
  if (tracking > 0 && typeof window !== "undefined") window.removeEventListener("scroll", onScroll)
  tracking = 0
  lastScrollY = 0
}
