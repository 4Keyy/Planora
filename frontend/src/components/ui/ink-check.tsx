"use client"

import { motion, useReducedMotion } from "framer-motion"
import { DURATION_FAST, DURATION_INSTANT, EASE_OUT_EXPO } from "@/lib/animations"

/**
 * The completion mark, drawn rather than popped.
 *
 * A checkmark that fades or scales in announces "a state changed". A checkmark
 * whose stroke is *drawn*, over an ink fill that grows from the centre, announces
 * "you did that" — the motion traces the gesture a pen would make, so the feedback
 * is about the act rather than about the render.
 *
 * This is the one moment in the product that gets a four-step choreography, because
 * it is the one thing a task app is for:
 *
 *   1. the ink fill grows from the centre   `fast` 160  emphasized
 *   2. the stroke draws, 80ms behind it     `fast` 160  emphasized
 *
 * Under `prefers-reduced-motion` both land at their final value immediately: the
 * mark is still there, it simply does not travel to get there.
 */
export function InkCheck({ size = 20 }: { size?: number }) {
  const reduce = useReducedMotion() ?? false

  return (
    <span className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      {/* Ink fill — grows out of the centre, under the stroke.
          Explicitly `ink`, never `currentColor`. The host button turns its own text
          white once a task is complete, so `bg-current` painted white ink under a
          white stroke and the whole mark disappeared exactly when it mattered. */}
      <motion.span
        aria-hidden="true"
        className="absolute inset-[-6px] rounded-full"
        style={{ background: "var(--pl-ink)" }}
        initial={reduce ? { scale: 1 } : { scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ duration: reduce ? 0 : DURATION_FAST, ease: EASE_OUT_EXPO }}
      />
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        aria-hidden="true"
        className="relative"
        // The stroke reads on the ink, not in it.
        style={{ color: "var(--pl-paper)" }}
      >
        <motion.path
          d="M4.5 12.5 L9.5 17.5 L19.5 7"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{
            duration: reduce ? 0 : DURATION_FAST,
            ease: EASE_OUT_EXPO,
            // Behind the fill, so the stroke is drawn onto ink that is already there.
            delay: reduce ? 0 : DURATION_INSTANT * 0.8,
          }}
        />
      </svg>
    </span>
  )
}
