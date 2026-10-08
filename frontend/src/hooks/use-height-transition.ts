"use client"

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react"

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

export interface HeightTransitionOptions {
  /** ms. */
  duration: number
  /** A CSS easing. */
  easing: string
  /** Reduced motion: the height changes in one step, as it always used to. */
  disabled?: boolean
}

/**
 * A framer-motion spring as a CSS easing: the curve sampled into `linear()`, and the time it
 * takes to settle (within 0.2% of the distance). It lets a Web Animation move on exactly the
 * spring the rest of the product moves on — `SPRING_LAYOUT`, critically damped, starts from
 * rest and lands without passing its target — where a cubic-bezier can only approximate it.
 * Browsers without `linear()` get the closest bezier.
 */
export function springEasing(spring: { stiffness: number; damping: number; mass?: number }): { duration: number; easing: string } {
  const mass = spring.mass ?? 1
  const w0 = Math.sqrt(spring.stiffness / mass)
  const zeta = spring.damping / (2 * Math.sqrt(spring.stiffness * mass))
  const at = (t: number): number => {
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta)
      return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t))
    }
    if (zeta === 1) return 1 - (1 + w0 * t) * Math.exp(-w0 * t)
    const wd = w0 * Math.sqrt(zeta * zeta - 1)
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cosh(wd * t) + ((zeta * w0) / wd) * Math.sinh(wd * t))
  }
  // Settled once it stays within 0.2% for good; searched in 10ms steps up to two seconds.
  let settle = 2
  for (let t = 2; t > 0; t -= 0.01) {
    if (Math.abs(1 - at(t)) > 0.002) break
    settle = t
  }
  const duration = Math.round(settle * 1000)
  const supported = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("animation-timing-function", "linear(0, 1)")
  if (!supported) return { duration, easing: "cubic-bezier(0.4, 0, 0.2, 1)" }
  const steps = 32
  const points = Array.from({ length: steps + 1 }, (_, i) => (i === steps ? 1 : Math.round(at((settle * i) / steps) * 10000) / 10000))
  return { duration, easing: `linear(${points.join(", ")})` }
}

/** The element's height as layout sees it — its own box, not a transformed ancestor's scale. */
const boxHeight = (element: HTMLElement) => parseFloat(getComputedStyle(element).height) || element.offsetHeight

/**
 * Glides an element's height to fit new content whenever `key` changes.
 *
 * A card that changes shape — a task hidden down to one row, or opened back out — used to
 * jump to its new height in a single frame. Everything below it jumped with it: the cards
 * under it in its column, the grid's own height, and the pager under the grid, which is
 * not part of any animation and so could only snap. Animating the height itself, rather
 * than scaling the card or gliding each neighbour, makes all of them one motion: the page
 * below simply reflows each frame, so whatever sits under the card — a card, a pager, the
 * end of the page — follows it exactly, on the same curve, with nothing to coordinate.
 *
 * It is a FLIP on `height` through the Web Animations API: React commits the new content,
 * and before the frame is painted the element is animated from the height it had to the
 * height it now has. No React render runs during the glide, and the animation leaves
 * nothing behind — the element is back on `height: auto` the moment it finishes.
 *
 * The height it had comes from a ResizeObserver, which reports after every layout, so at
 * a change it still holds the last painted height. A change that lands while a glide is
 * still running starts from wherever that glide had got to.
 *
 * Height is not a compositor property: each frame lays the page out again. That is the
 * point — it is how everything below moves in step — and it is cheap at this scale: one
 * element, a third of a second, with nothing else re-rendering.
 */
export function useHeightTransition(
  ref: RefObject<HTMLElement | null>,
  key: unknown,
  { duration, easing, disabled = false }: HeightTransitionOptions,
): void {
  const observed = useRef<number | null>(null)
  const running = useRef<Animation | null>(null)
  const seenKey = useRef(key)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    observed.current = boxHeight(element)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const size = entries[entries.length - 1]?.borderBoxSize?.[0]?.blockSize
      observed.current = size ?? boxHeight(element)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  useEffect(() => () => running.current?.cancel(), [])

  useIsomorphicLayoutEffect(() => {
    if (Object.is(seenKey.current, key)) return
    seenKey.current = key
    const element = ref.current
    if (!element || typeof element.animate !== "function") return

    const from = running.current ? boxHeight(element) : observed.current
    running.current?.cancel()
    running.current = null
    if (disabled || from === null) return

    const to = boxHeight(element)
    if (Math.abs(to - from) < 0.5) return

    const animation = element.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration, easing })
    running.current = animation
    const settle = () => {
      if (running.current === animation) running.current = null
    }
    animation.addEventListener("finish", settle)
    animation.addEventListener("cancel", settle)
  }, [key, ref, duration, easing, disabled])
}
