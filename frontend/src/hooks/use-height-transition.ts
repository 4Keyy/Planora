"use client"

import { useEffect, useInsertionEffect, useLayoutEffect, useRef, type RefObject } from "react"
import { holdScroll, primeScrollHold, trackScrollPosition } from "@/lib/scroll-hold"

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect
const useIsomorphicInsertionEffect = typeof window === "undefined" ? useEffect : useInsertionEffect

export interface SpringParams {
  stiffness: number
  damping: number
  mass?: number
}

/** A spring as a timed curve: the CSS easing for a Web Animation, and its maths for retargeting. */
export interface SpringCurve {
  /** ms until it settles within 0.2% of the distance. */
  duration: number
  /** `linear()` sampled from the spring, or the nearest bezier where `linear()` is unsupported. */
  easing: string
  /** Progress (0 → 1) at `t` seconds. */
  at: (t: number) => number
  /** d(progress)/dt at `t` seconds, in distances per second. */
  velocity: (t: number) => number
}

const supportsLinear = () =>
  typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("animation-timing-function", "linear(0, 1)")

/**
 * A framer-motion spring, sampled — so a Web Animation moves on exactly the spring the rest of the
 * product moves on (`SPRING_LAYOUT`: critically damped, lands without passing its target), where a
 * cubic-bezier can only approximate it. Browsers without `linear()` get the closest bezier.
 *
 * `v0` is the speed it already has toward its target, in distances per second: a glide that turns
 * mid-flight starts at the speed the old one had, rather than from rest.
 */
export function springCurve(spring: SpringParams, v0 = 0): SpringCurve {
  const mass = spring.mass ?? 1
  const w = Math.sqrt(spring.stiffness / mass)
  const zeta = spring.damping / (2 * Math.sqrt(spring.stiffness * mass))
  // u(t): what is left of the distance; u(0) = 1, u'(0) = -v0.
  let u: (t: number) => number
  let du: (t: number) => number
  if (Math.abs(zeta - 1) < 1e-6) {
    const b = w - v0
    u = (t) => (1 + b * t) * Math.exp(-w * t)
    du = (t) => (b - w * (1 + b * t)) * Math.exp(-w * t)
  } else if (zeta < 1) {
    const wd = w * Math.sqrt(1 - zeta * zeta)
    const b = (zeta * w - v0) / wd
    u = (t) => Math.exp(-zeta * w * t) * (Math.cos(wd * t) + b * Math.sin(wd * t))
    du = (t) =>
      Math.exp(-zeta * w * t) *
      (-zeta * w * (Math.cos(wd * t) + b * Math.sin(wd * t)) + wd * (b * Math.cos(wd * t) - Math.sin(wd * t)))
  } else {
    const wd = w * Math.sqrt(zeta * zeta - 1)
    const b = (zeta * w - v0) / wd
    u = (t) => Math.exp(-zeta * w * t) * (Math.cosh(wd * t) + b * Math.sinh(wd * t))
    du = (t) =>
      Math.exp(-zeta * w * t) *
      (-zeta * w * (Math.cosh(wd * t) + b * Math.sinh(wd * t)) + wd * (Math.sinh(wd * t) + b * Math.cosh(wd * t)))
  }
  // Settled once it stays within 0.2% for good; searched in 10ms steps back from three seconds.
  let settle = 3
  for (let t = 3; t > 0; t -= 0.01) {
    if (Math.abs(u(t)) > 0.002) break
    settle = t
  }
  const duration = Math.max(1, Math.round(settle * 1000))
  // The animation runs for the whole milliseconds, so that is where the curve ends.
  const end = duration / 1000
  const at = (t: number) => (t >= end ? 1 : 1 - u(t))
  const velocity = (t: number) => (t >= end ? 0 : -du(t))
  if (!supportsLinear()) return { duration, easing: "cubic-bezier(0.4, 0, 0.2, 1)", at, velocity }
  const steps = 40
  const points = Array.from({ length: steps + 1 }, (_, i) =>
    i === steps ? 1 : Math.round(at((end * i) / steps) * 10000) / 10000,
  )
  return { duration, easing: `linear(${points.join(", ")})`, at, velocity }
}

/** A spring as a CSS easing and its settle time, for callers that only need the curve. */
export function springEasing(spring: SpringParams): { duration: number; easing: string } {
  const { duration, easing } = springCurve(spring)
  return { duration, easing }
}

/** The curve from rest is the same every time; sampling it once per spring is enough. */
const restCurves = new WeakMap<SpringParams, SpringCurve>()
const fromRest = (spring: SpringParams) => {
  let curve = restCurves.get(spring)
  if (!curve) restCurves.set(spring, (curve = springCurve(spring)))
  return curve
}

/** Borders and padding round the content child, so `content + frame` is the element's height. */
function frameOf(element: HTMLElement): number {
  const s = getComputedStyle(element)
  return (
    (parseFloat(s.borderTopWidth) || 0) +
    (parseFloat(s.borderBottomWidth) || 0) +
    (parseFloat(s.paddingTop) || 0) +
    (parseFloat(s.paddingBottom) || 0)
  )
}

/** The most a glide moves on in one frame: two frames at 60Hz, however long the frame took. */
const MAX_STEP_MS = 2000 / 60

/** Clips only below the element's edge: shadows, badges and lifts round the other three sides stay. */
const CLIP_BELOW = "inset(-64px -64px 0px -64px)"

/** Whether the browser would draw a focus ring here — focus the keyboard gave, not a click's. */
function focusVisible(element: Element): boolean {
  try {
    return element.matches(":focus-visible")
  } catch {
    return false
  }
}

export interface HeightTransitionOptions {
  /**
   * The element's one in-flow child. The element is always as tall as this child plus its own
   * border and padding; a glide only decides how it gets there.
   */
  content: RefObject<HTMLElement | null>
  /** The spring every glide moves on — `SPRING_LAYOUT` for cards and grids. */
  spring: SpringParams
  /**
   * What the element is showing, when it can change all at once: a card hidden or opened, a grid
   * dealt a new page. The commit that changes it holds the page before anything in it reads
   * layout, which is what keeps a card folding at the bottom of the page from clamping the scroll
   * position in its first frame.
   */
  shape?: unknown
  /** Reduced motion: the height changes in one step, as it always used to. */
  disabled?: boolean
  /**
   * A card: while it folds, its top stays in view, and so does a control the keyboard was handed
   * inside it. A grid leaves the view where the reader put it.
   */
  keepInView?: boolean
  /**
   * Clip what grows past the element's bottom edge while it glides — a grid whose new cards are
   * taller than the height it is still gliding from would otherwise draw over the pager.
   */
  clipBelow?: boolean
}

interface Flight {
  animation: Animation
  from: number
  to: number
  curve: SpringCurve
  release: () => void
}

/**
 * Glides an element's height to fit its content whenever the content changes height.
 *
 * A card that changes shape — a task hidden down to one row, or opened back out — used to
 * jump to its new height in a single frame. Everything below it jumped with it: the cards
 * under it in its column, the grid's own height, and the pager under the grid, which is
 * not part of any animation and so could only snap. Animating the height itself, rather
 * than scaling the card or gliding each neighbour, makes all of them one motion: the page
 * below simply reflows each frame, so whatever sits under the card — a card, a pager, the
 * end of the page — follows it exactly, on the same curve, with nothing to coordinate.
 *
 * It is a FLIP on `height` through the Web Animations API, run from a layout effect after every
 * commit: React commits the new content, the content's own height is read (the content is never
 * constrained by the element, so no pin has to come off to measure it), and before the frame is
 * painted the element is animated from the height it showed to the height it now needs. No React
 * render runs during the glide, and nothing is left behind — the element is back on `height: auto`
 * the moment it lands.
 *
 * - **Any change, not only a change of shape.** A hidden task opened before its description and
 *   dates had arrived glided to the height of what it had, then snapped 135px taller when the rest
 *   came (measured, 2026-10-12). Now the late content is one more glide.
 * - **A change mid-glide is a turn, not a restart.** The new glide starts from the height the old
 *   one had reached, at the speed it was moving, on the same spring. A change that arrives outside
 *   a commit while a glide runs (a font, an image) is followed the same way through a
 *   ResizeObserver; one that arrives while the element is at rest is simply laid out.
 * - **Before framer-motion looks.** The glide is pinned in the layout effect, ahead of the
 *   microtask in which framer-motion measures the cards around it for their `layout` animations,
 *   so they see no jump to animate and simply ride the reflow.
 * - **The page holds still** (`lib/scroll-hold.ts`) for as long as anything glides, and the view
 *   moves, gently, only when it must.
 * - A change that comes with a change of width — a window resizing, a grid re-dealing its
 *   columns — is a reflow, not an event, and is left to happen at once.
 *
 * Height is not a compositor property: each frame lays the page out again. That is the
 * point — it is how everything below moves in step — and it is cheap at this scale: one
 * element, under half a second, with nothing else re-rendering.
 */
export function useHeightTransition(
  ref: RefObject<HTMLElement | null>,
  { content, spring, shape, disabled = false, keepInView = false, clipBelow = false }: HeightTransitionOptions,
): void {
  const measured = useRef<{ height: number; width: number } | null>(null)
  const flight = useRef<Flight | null>(null)
  const primedShape = useRef(shape)
  const glidedShape = useRef(shape)
  const options = useRef({ spring, disabled, keepInView, clipBelow })
  options.current = { spring, disabled, keepInView, clipBelow }

  useEffect(() => trackScrollPosition(), [])
  useEffect(() => () => flight.current?.animation.cancel(), [])

  /** Where a running glide is now, and how fast it is moving, in px and px/s. */
  const now = (): { height: number; speed: number } | null => {
    const f = flight.current
    if (!f) return null
    const t = Math.min(f.curve.duration, Math.max(0, Number(f.animation.currentTime ?? 0))) / 1000
    return { height: f.from + (f.to - f.from) * f.curve.at(t), speed: (f.to - f.from) * f.curve.velocity(t) }
  }

  const glide = (element: HTMLElement, from: number, to: number, speed: number) => {
    const previous = flight.current
    const distance = to - from
    if (Math.abs(distance) < 0.5) {
      flight.current = null
      previous?.animation.cancel()
      return
    }
    const { spring: s, keepInView: keep, clipBelow: clip } = options.current
    // Only speed toward the new target is carried, and never more than the spring's own natural
    // frequency: past it a critically damped spring would overshoot, and a card does not bounce.
    const omega = Math.sqrt(s.stiffness / (s.mass ?? 1))
    const v0 = Math.min(omega, Math.max(0, speed / distance))
    const curve = v0 > 0 ? springCurve(s, v0) : fromRest(s)
    const shrinking = distance < 0
    // The new hold opens before the old glide's is closed, so the page is never let go between.
    const release = holdScroll({
      show: keep
        ? () => {
            const active = document.activeElement
            if (active instanceof HTMLElement && element.contains(active) && focusVisible(active)) return active
            return shrinking ? element : null
          }
        : undefined,
    })
    const frame = (height: number): Keyframe => (clip ? { height: `${height}px`, clipPath: CLIP_BELOW } : { height: `${height}px` })
    const animation = element.animate([frame(from), frame(to)], { duration: curve.duration, easing: curve.easing })
    const current: Flight = { animation, from, to, curve, release }
    flight.current = current
    previous?.animation.cancel()
    // A glide never skips. Height is laid out on the main thread, and the commit that starts a
    // glide — and the effects that run after it — can hold that thread for several frames: the
    // first frame drawn jumped 66px, and 239px on a phone at a quarter of the speed, because the
    // animation's clock had run on through the stall (measured, 2026-10-12). So the clock is the
    // frames that are drawn: the animation is held paused and moved on each frame, by at most
    // two frames' worth however long that frame took, and ends when its time is up.
    if (typeof requestAnimationFrame === "function") {
      animation.pause()
      let elapsed = 0
      let last = 0
      const tick = (time: number) => {
        if (flight.current !== current) return
        if (last) elapsed += Math.min(time - last, MAX_STEP_MS)
        last = time
        if (elapsed >= curve.duration) {
          // At its height: the element goes back to `height: auto`, which is this height.
          animation.cancel()
          return
        }
        animation.currentTime = elapsed
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }
    const settle = () => {
      if (flight.current === current) flight.current = null
      release()
    }
    animation.addEventListener("finish", settle)
    animation.addEventListener("cancel", settle)
  }

  // A change of shape holds the page before any layout effect of this commit reads layout.
  useIsomorphicInsertionEffect(() => {
    if (Object.is(primedShape.current, shape)) return
    primedShape.current = shape
    // The element is the one already on screen — a shape changes on an update, never on mount.
    if (!disabled && typeof ref.current?.animate === "function") primeScrollHold()
  })

  // Every commit: from the height the element shows to the height its content now needs.
  useIsomorphicLayoutEffect(() => {
    const element = ref.current
    const child = content.current
    if (!element || !child) return
    const natural = child.offsetHeight + frameOf(element)
    const width = child.offsetWidth
    const previous = measured.current
    measured.current = { height: natural, width }
    const reshaped = !Object.is(glidedShape.current, shape)
    glidedShape.current = shape
    if (!previous || typeof element.animate !== "function") return
    if (disabled) {
      flight.current?.animation.cancel()
      return
    }
    const moving = now()
    if (moving) {
      if (Math.abs(natural - (flight.current?.to ?? natural)) >= 0.5) glide(element, moving.height, natural, moving.speed)
      return
    }
    if (Math.abs(natural - previous.height) < 0.5) return
    // Laid out at a new width — a window resizing, columns re-dealt — or never laid out at all.
    if (!reshaped && (previous.width === 0 || Math.abs(width - previous.width) > 0.5)) return
    glide(element, previous.height, natural, 0)
  })

  // Outside a commit — a font, an image — a running glide turns to the content's new height.
  useEffect(() => {
    const element = ref.current
    const child = content.current
    if (!element || !child || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => {
      const natural = child.offsetHeight + frameOf(element)
      measured.current = { height: natural, width: child.offsetWidth }
      const target = flight.current?.to
      if (target === undefined || options.current.disabled || Math.abs(natural - target) < 0.5) return
      const moving = now()
      if (moving) glide(element, moving.height, natural, moving.speed)
    })
    observer.observe(child)
    return () => observer.disconnect()
    // `now` and `glide` read refs only; the observer lives as long as the element and its content.
  }, [ref, content])
}
