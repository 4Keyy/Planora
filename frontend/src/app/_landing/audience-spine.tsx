"use client"

import { useEffect, useRef, useState } from "react"
import { useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion"
import { RedactionBadge } from "@/components/ui/redaction-badge"
import { deriveAudience, SHARING_CEILING } from "@/lib/landing-audience"

/**
 * The page's spine: one mark that follows the scroll.
 *
 * The landing page argues one thing — a task carries the list of people who can see it —
 * and the redaction arc is that argument as a drawing. Rather than let it appear once and
 * scroll away, it rides along: private in the hero, opening as the sharing section
 * explains reach, holding at the ceiling, closing again by the time the page is talking
 * about the session. One continuous statement instead of a sequence of effects.
 *
 * Three decisions that are not stylistic.
 *
 * **Scroll drives an INTEGER, not a fraction.** You can share a task with three people,
 * never with 3.7, so a continuously-interpolated arc would depict a state the product
 * cannot hold. The scroll position picks a whole viewer count and `RedactionBadge`
 * animates between counts on its own shipped 220ms `pathLength` transition — which reads
 * as continuous because consecutive steps overlap, while never drawing a lie.
 *
 * **React is not in the scroll path.** `useMotionValueEvent` writes to a ref and only
 * calls `setState` when the integer actually changes, so the whole page costs about a
 * dozen renders end to end rather than one per frame.
 *
 * **It is `position: fixed`, so it must never sit under a transform.** A transformed
 * ancestor creates a containing block and a fixed descendant silently anchors to it
 * instead of the viewport — the same mechanism that cost 16× the CLS on /tasks when a
 * route transition tried an 8px rise. It renders as a sibling of `<main>`, outside every
 * `Reveal`, exactly as `ColorBendsLayer` does.
 */

/**
 * Where the mark should be at a given scroll depth, as a viewer count.
 *
 * Deliberately a small table rather than a formula: the stops line up with what the page
 * is *saying* at that depth, and a formula would silently drift the moment a block moved.
 */
const STOPS: { until: number; viewers: number }[] = [
  { until: 0.12, viewers: 0 }, // hero — private
  { until: 0.22, viewers: 1 },
  { until: 0.3, viewers: 3 },
  { until: 0.4, viewers: SHARING_CEILING }, // the ceiling block
  { until: 0.52, viewers: 2 }, // the viewer's side
  { until: 0.68, viewers: 3 }, // the console
  { until: 0.8, viewers: 1 },
  { until: 1.01, viewers: 0 }, // security, refusals, close — private again
]

function viewersAt(progress: number): number {
  for (const stop of STOPS) if (progress < stop.until) return stop.viewers
  return 0
}

export function AudienceSpine() {
  const reduce = useReducedMotion() ?? false
  const { scrollYProgress } = useScroll()
  const [viewers, setViewers] = useState(0)
  const current = useRef(0)

  useMotionValueEvent(scrollYProgress, "change", (progress) => {
    const next = viewersAt(progress)
    // The whole point: one render per step, not one per frame.
    if (next === current.current) return
    current.current = next
    setViewers(next)
  })

  // Under reduced motion the mark is still correct and still informative — it just does
  // not animate between steps, which `RedactionBadge` handles via the global MotionConfig.
  // `MotionConfig` cannot reach a MotionValue we compute ourselves, so the subscription
  // above stays; it is cheap and it keeps the mark honest rather than frozen at zero.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return (
    <div
      // Desktop only: at 390px the page needs its gutters for the content, and a floating
      // mark in the thumb arc would sit on top of the controls it is describing.
      className="pointer-events-none fixed bottom-6 right-6 z-sticky hidden lg:block"
      aria-hidden="true"
    >
      <div className="flex items-center gap-3 rounded-full border border-line bg-paper/90 px-4 py-2.5 shadow-sm backdrop-blur-sm">
        <RedactionBadge
          audience={deriveAudience(viewers)}
          viewerCount={viewers}
          size="sm"
        />
        <span className="text-caption text-ink-subtle">
          {reduce ? "who can see it" : "follows the page"}
        </span>
      </div>
    </div>
  )
}
