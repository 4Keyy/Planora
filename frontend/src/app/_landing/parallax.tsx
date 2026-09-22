"use client"

import { useRef, type ReactNode } from "react"
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from "framer-motion"
import { DURATION_UI, EASE_OUT_EXPO } from "@/lib/animations"

/**
 * A scroll-linked drift, for a section's own heading.
 *
 * Why this is safe against the CLS invariant this route carries (0.0000–0.0014):
 * **`transform` and `opacity` cannot produce a layout shift.** They composite. So a
 * scroll-linked transform is free against CLS by construction — which is what makes rich
 * choreography affordable here at all, and worth stating because the repository's motion
 * history is mostly about transforms that *did* cost something.
 *
 * What they cost instead is containing blocks, and that is the real constraint. A
 * transform on an ancestor of a `position: fixed` or `position: sticky` node re-parents
 * it silently: no error, no warning. This route has a sticky nav (`landing-nav.tsx`) and
 * a fixed undo bar, so the rules are
 *
 *   - never wrap the nav, and
 *   - never wrap anything holding a fixed control that is NOT portalled.
 *
 * `UndoBar` portals to `document.body`, so the console is fine. The nav is rendered
 * outside every wrapper on the page. This component is therefore only ever applied to
 * headings and prose.
 *
 * `MotionConfig reducedMotion="user"` does not reach a MotionValue we compute ourselves,
 * so the reduced-motion branch is explicit: the transform is simply not subscribed.
 *
 * ## It also fades in, and that is not decoration
 *
 * A section heading that is opacity-1 at first paint is an LCP candidate, and during
 * progressive load a below-the-fold heading is briefly inside the viewport — long enough
 * to be recorded with a load-time timestamp. Dropping the fade when this replaced the old
 * `Reveal` wrapper moved LCP from the hero at ~350ms to a section `h2` at ~1770ms on
 * three viewports, consistently, across five runs.
 *
 * Fading in is what these sections were always meant to do — they are revealed on scroll —
 * so the fix is the design intent rather than a metric trick: at load these headings are
 * genuinely not visible, and LCP counting them was the artifact.
 */
export function Parallax({
  children,
  /** Total travel in px across the section's pass through the viewport. Small on purpose. */
  distance = 24,
  className,
}: {
  children: ReactNode
  distance?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion() ?? false

  // "start end" → the section's top meets the viewport's bottom; "end start" → its bottom
  // meets the viewport's top. So progress runs 0→1 across the whole pass, not just while
  // the section is centred.
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  })

  // Springing the mapped value rather than the raw one keeps the motion from tracking a
  // trackpad's jitter one-to-one, which reads as nervousness rather than depth.
  const raw = useTransform(scrollYProgress, [0, 1], [distance, -distance])
  const y = useSpring(raw, { stiffness: 120, damping: 30, mass: 0.4 })

  if (reduce) {
    return (
      <div ref={ref} className={className}>
        {children}
      </div>
    )
  }

  return (
    <div ref={ref} className={className}>
      <motion.div
        style={{ y }}
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO }}
      >
        {children}
      </motion.div>
    </div>
  )
}
