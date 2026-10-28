"use client"

import { useCallback, useRef } from "react"
import { animate, useMotionValue, useTransform, type AnimationPlaybackControls, type ValueAnimationTransition } from "framer-motion"
import type { OriginRect } from "@/lib/shared-origin"

/**
 * A surface that grows out of the control that opened it and folds back into it — the command
 * palette out of the search button, a category sheet out of its card or the New category button.
 *
 * Both used to scale uniformly from the control's centre with a floor of 0.55, which only works
 * when the control is about half the surface's size. A 98×44 search button or a 191×44 button
 * against a panel four to eight times wider ended the close as a box half the panel's size centred
 * on the control — mostly above the screen and under the app bar — and read as flying away.
 *
 * Here the surface starts and ends as the control's own rectangle: x and y are scaled apart, the
 * corner radius is given per axis so the corners stay round (the control's at one end, the
 * surface's at the other), and the content is counter-scaled to its natural size, so nothing is
 * drawn stretched — it is uncovered as the surface grows and fades in once there is room for it,
 * and fades first on the way back. One progress value drives every part, so a close interrupted
 * by a reopening turns round where it is. Without a control the surface drops in (`dropMorph`).
 */

export interface Morph {
  /** Grows out of a control and folds back into it, rather than dropping in. */
  grow: boolean
  x: number
  y: number
  sx: number
  sy: number
  /** Corner radius at the start, in screen pixels. */
  radius: number
  /** Corner radius at rest, in screen pixels. */
  restRadius: number
  /** The control's rect, kept for a close whose control has gone. */
  origin: OriginRect | null
}

/** Opened without a control: from `y` px above (or below), at `scale`, its corners at rest. */
export const dropMorph = (restRadius: number, y: number, scale: number): Morph => ({
  grow: false, x: 0, y, sx: scale, sy: scale, radius: restRadius, restRadius, origin: null,
})

/** The surface's start as `origin`'s own rectangle, centre on centre, with `radius` corners. */
export function morphFrom(origin: OriginRect, target: OriginRect, radius: number, restRadius: number): Morph {
  return {
    grow: true,
    x: Math.round(origin.left + origin.width / 2 - (target.left + target.width / 2)),
    y: Math.round(origin.top + origin.height / 2 - (target.top + target.height / 2)),
    sx: origin.width / target.width,
    sy: origin.height / target.height,
    radius: Math.max(0, Math.min(radius, origin.height / 2, origin.width / 2)),
    restRadius,
    origin,
  }
}

/** An element's own corner radius in px, or NaN when it cannot be read. */
export function cornerRadius(element: Element | null | undefined): number {
  if (!element?.isConnected || typeof getComputedStyle === "undefined") return NaN
  return parseFloat(getComputedStyle(element).borderTopLeftRadius)
}

/**
 * The surface's rect and corner radius at rest, read with its inline transform and radius lifted
 * for the one measurement (motion may not have written the previous frame yet).
 */
export function measureAtRest(surface: HTMLElement): { rect: OriginRect | null; radius: number } {
  const { transform, borderRadius } = surface.style
  surface.style.transform = "none"
  surface.style.borderRadius = ""
  const r = surface.getBoundingClientRect()
  const radius = cornerRadius(surface)
  surface.style.transform = transform
  surface.style.borderRadius = borderRadius
  return {
    rect: r.width > 0 && r.height > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null,
    radius: Number.isFinite(radius) ? radius : 0,
  }
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const mix = (from: number, to: number, t: number) => from + (to - from) * t

/** Where on its way the surface is: 0 at the control (or dropped), 1 at rest. */
export function morphAt(p: number, m: Morph) {
  const t = clamp01(p)
  const sx = mix(m.sx, 1, t)
  const sy = mix(m.sy, 1, t)
  const r = mix(m.radius, m.restRadius, t)
  return {
    x: mix(m.x, 0, t),
    y: mix(m.y, 0, t),
    sx,
    sy,
    radius: `${r / sx}px / ${r / sy}px`,
    // Grown, the surface is the control itself early on and gone as it lands; dropped, it fades.
    opacity: m.grow ? clamp01(p / 0.16) : t,
    contentScaleX: m.grow ? 1 / sx : 1,
    contentScaleY: m.grow ? 1 / sy : 1,
    contentOpacity: m.grow ? clamp01((p - 0.42) / 0.33) : 1,
  }
}

export function useOriginMorph(initial: Morph) {
  const progress = useMotionValue(0)
  const morph = useMotionValue<Morph>(initial)
  const running = useRef<AnimationPlaybackControls | null>(null)

  const at = () => morphAt(progress.get(), morph.get())
  const x = useTransform(() => at().x)
  const y = useTransform(() => at().y)
  const scaleX = useTransform(() => at().sx)
  const scaleY = useTransform(() => at().sy)
  const borderRadius = useTransform(() => at().radius)
  const opacity = useTransform(() => at().opacity)
  const contentScaleX = useTransform(() => at().contentScaleX)
  const contentScaleY = useTransform(() => at().contentScaleY)
  const contentOpacity = useTransform(() => at().contentOpacity)

  /** Runs the progress to 1 (open) or 0 (closed) from wherever it is. */
  const play = useCallback((to: 0 | 1, transition: ValueAnimationTransition<number>) => {
    running.current?.stop()
    running.current = animate(progress, to, transition)
    return running.current
  }, [progress])

  const stop = useCallback(() => {
    running.current?.stop()
  }, [])

  return {
    morph,
    play,
    stop,
    surfaceStyle: { x, y, scaleX, scaleY, borderRadius, opacity },
    contentStyle: { scaleX: contentScaleX, scaleY: contentScaleY, opacity: contentOpacity },
  }
}
