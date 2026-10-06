"use client"

import { useCallback, useEffect, useState, type AnimationEvent } from "react"
import { tokens } from "@/lib/design-tokens"

/**
 * Keeps a floating surface mounted through its exit animation, and leaves both of its
 * animations to CSS (`DROPDOWN_MOTION` in `components/ui/surfaces.ts`).
 *
 * The surfaces used to animate with framer-motion, and every one of them ended with a
 * tic. framer-motion 11 hands `opacity` to the Web Animations API and, when that
 * animation finishes, cancels it before it writes the final value back to the style —
 * the write waits for the next frame. Recorded frame by frame, an opening dropdown sat
 * at its starting `opacity: 0` for one frame after the animation ended, and a closing one
 * was back at full opacity for one frame before it unmounted (the "it shows up for a
 * millisecond after closing" in the filter dialog). The spring under them added a third:
 * it overshot to 100.18% and settled in two waves, and each crossing of 1 changed how the
 * text was rasterised.
 *
 * A CSS animation has no hand-off. Its last keyframe is the resting style, the exit's
 * `forwards` fill holds the folded state until the node is gone, and the surface keeps
 * its layer (`will-change`) from the first frame to the last, so the moment the motion
 * stops nothing on screen changes.
 *
 * Render the surface while `mounted`, spread `presenceProps` onto the element that runs
 * the animation, and give it the enter/exit animation for `data-state="open"` and
 * `data-state="closed"`. The exit's own `animationend` unmounts it; the timer only
 * catches the case where no animation runs at all (jsdom, `display: none`, an
 * interrupted animation), so a surface can never be left behind invisible.
 */

/** How long after the exit should have ended the fallback gives up waiting for it. */
const FALLBACK_MARGIN_MS = tokens.motion.duration.instant

export type PresenceState = "open" | "closed"

export interface ExitPresence {
  /** Render the surface while this is true: `open`, or still folding away. */
  mounted: boolean
  /** Spread onto the animated element. */
  presenceProps: {
    "data-state": PresenceState
    onAnimationEnd: (event: AnimationEvent<HTMLElement>) => void
  }
}

export function useExitPresence(open: boolean, exitMs: number = tokens.motion.duration.fast): ExitPresence {
  const [present, setPresent] = useState(open)

  useEffect(() => {
    if (open) {
      setPresent(true)
      return
    }
    if (!present) return
    const fallback = window.setTimeout(() => setPresent(false), exitMs + FALLBACK_MARGIN_MS)
    return () => window.clearTimeout(fallback)
  }, [open, present, exitMs])

  const onAnimationEnd = useCallback((event: AnimationEvent<HTMLElement>) => {
    // A child's animation bubbles up through here too; only the surface's own exit counts.
    if (event.target !== event.currentTarget) return
    if (event.currentTarget.dataset.state === "closed") setPresent(false)
  }, [])

  return {
    mounted: open || present,
    presenceProps: { "data-state": open ? "open" : "closed", onAnimationEnd },
  }
}
