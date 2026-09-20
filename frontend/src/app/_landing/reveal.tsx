"use client"

import { motion, useReducedMotion } from "framer-motion"
import type { ReactNode } from "react"
import { DURATION_UI, EASE_OUT_EXPO } from "@/lib/animations"

/**
 * A block arriving, per design-system § 9.9: 8px in reading order, `base` 220 on
 * `emphasized`, capped so the last block never looks like it is loading rather than
 * arriving.
 *
 * Two things this deliberately is NOT.
 *
 * It is not a route transition. A `y` on `app/template.tsx` was built, measured and
 * reverted: CLS on /tasks@390 went 0.0037 → 0.0600, because of the frame the
 * transform's containing block disappears under a `position: fixed` descendant
 * (design-system § 9.11). That decision is closed and this does not reopen it —
 * each block animates itself, and the only fixed control on this page (`UndoBar`)
 * portals to `document.body`, so it is never a descendant of an animated node.
 *
 * It is not wrapped around the sticky nav either. A transform on an ancestor creates
 * a containing block and breaks `position: sticky` — the same trap that forced the
 * profile route's root to carry no entrance transform.
 */
export function Reveal({
  children,
  step = 0,
  className,
}: {
  children: ReactNode
  /** Position in reading order. Capped at 8 — past that the delay outlasts the reader. */
  step?: number
  className?: string
}) {
  const reduce = useReducedMotion() ?? false
  const delay = reduce ? 0 : Math.min(step, 8) * 0.04

  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO, delay }}
    >
      {children}
    </motion.div>
  )
}
