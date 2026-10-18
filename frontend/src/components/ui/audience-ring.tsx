"use client"

import { useState, type ReactNode } from "react"
import { useReducedMotion } from "framer-motion"
import { motion } from "@/components/ui/motion"
import { redactionArc, type Audience } from "@/components/ui/redaction-badge"
import { DURATION_DELIBERATE, DURATION_UI, EASE_OUT_EXPO } from "@/lib/animations"
import { cn } from "@/lib/utils"

/**
 * The audience mark, at the size of an argument rather than a badge.
 *
 * It draws from `redactionArc` — the function `RedactionBadge` draws from — so the ring on
 * the landing page and the 18px mark on every task in the app cannot disagree about how
 * wide a cut three viewers make. A copy of that maths would be correct today and wrong the
 * first time someone tuned the badge, and the landing page would quietly start describing
 * a product that no longer exists.
 *
 * What differs is only what a large drawing needs: a thinner stroke relative to the
 * circle (the badge's 3/24 would be a 20px band at this size), a slot in the middle for
 * whoever "you" is on that surface, and an optional first draw.
 *
 * The first draw is `DURATION_DELIBERATE` because this is the progress-ring case the
 * design system reserves it for — a quantity being reported, not a press being answered.
 * Every change after that is `DURATION_UI`, the badge's own timing. Under reduced motion
 * the ring is simply correct from the first frame; `MotionConfig` does not reach
 * `pathLength`, so the branch is explicit.
 */
export function AudienceRing({
  audience,
  viewerCount,
  size = 160,
  stroke = 6,
  drawIn = false,
  children,
  className,
}: {
  audience: Audience
  viewerCount?: number
  /** Rendered size in px. Layout is reserved at exactly this, whatever the ring shows. */
  size?: number
  /** Stroke width in viewBox units (the viewBox is 100). */
  stroke?: number
  /** Draw the ring in from nothing on first mount. */
  drawIn?: boolean
  /** The centre: usually "you". Private with no centre gets the badge's filled dot. */
  children?: ReactNode
  className?: string
}) {
  const reduce = useReducedMotion() ?? false
  // The slow first draw happens once; after it every change moves at the badge's pace.
  const [drawn, setDrawn] = useState(false)
  const { dash, gap } = redactionArc(audience, viewerCount)
  const r = 50 - stroke / 2 - 1

  return (
    <div
      aria-hidden="true"
      className={cn("relative inline-grid flex-shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} fill="none" className="absolute inset-0">
        {/* Twelve o'clock, like the badge: an SVG circle starts at three. */}
        <g transform="rotate(-90 50 50)">
          <circle cx="50" cy="50" r={r} strokeWidth={stroke} className="stroke-line" />
          <motion.circle
            cx="50"
            cy="50"
            r={r}
            strokeWidth={stroke}
            // Butt caps: the cut is a cut, and round caps would close a narrow one.
            strokeLinecap="butt"
            className="stroke-ink"
            initial={drawIn && !reduce ? { pathLength: 0, pathOffset: gap / 2 } : false}
            animate={{ pathLength: dash, pathOffset: gap / 2 }}
            onAnimationComplete={() => setDrawn(true)}
            transition={{
              duration: drawIn && !reduce && !drawn ? DURATION_DELIBERATE : DURATION_UI,
              ease: EASE_OUT_EXPO,
            }}
          />
        </g>
        {audience === "private" && !children && (
          <circle cx="50" cy="50" r={12} className="fill-ink" />
        )}
      </svg>
      {children && <div className="relative">{children}</div>}
    </div>
  )
}
