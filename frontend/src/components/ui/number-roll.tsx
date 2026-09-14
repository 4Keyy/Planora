"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { DURATION_DELIBERATE, EASE_OUT_EXPO } from "@/lib/animations"
import { cn } from "@/lib/utils"

/**
 * A number that rolls to its new value, digit by digit.
 *
 * A counter that hard-swaps reads as a re-render: the eye registers "different",
 * not "changed". Rolling the digits makes the direction of change legible without
 * any label — a task completed and the count went *down*, visibly.
 *
 * Each digit is its own column and animates independently, so 199 → 200 moves the
 * three columns it has to and leaves nothing else twitching. Columns stagger from
 * the right, 30ms apart, because that is the order the carry actually propagates.
 *
 * Two details that are not optional:
 *
 * - **`tabular-nums`.** In a proportional face a `1` is narrower than a `7`, so a
 *   rolling counter changes width mid-animation and shoves its own label sideways.
 * - **`aria-live` on nothing.** The value is exposed once through the wrapper's
 *   text; the animated columns are `aria-hidden`, or a screen reader reads every
 *   intermediate digit of every roll.
 */

export interface NumberRollProps {
  value: number
  /** Roll direction is inferred, but a caller that knows can force it. */
  direction?: "up" | "down"
  className?: string
  /** Announce changes politely. Use on counters a user is waiting on, not on every badge. */
  announce?: boolean
}

/** One digit column. Keyed on the digit so a change mounts a new one and the old exits. */
function Digit({ digit, up, delay, reduce }: { digit: string; up: boolean; delay: number; reduce: boolean }) {
  if (reduce) return <span className="tabular-nums">{digit}</span>

  return (
    /**
     * `1ch` is exactly one digit wide here, because `tabular-nums` makes every
     * figure the same advance width — so the column needs no hidden copy of its own
     * digit to size itself. The copy also made the value appear three times in the
     * DOM, which turned a simple `getByText("5")` into an ambiguous match.
     */
    <span
      className="relative inline-block overflow-hidden tabular-nums"
      style={{ height: "1em", lineHeight: 1, width: "1ch" }}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={digit}
          initial={{ y: up ? "100%" : "-100%", opacity: 0 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={{ y: up ? "-100%" : "100%", opacity: 0 }}
          transition={{ duration: DURATION_DELIBERATE, ease: EASE_OUT_EXPO, delay }}
          className="absolute inset-0 block"
        >
          {digit}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

export function NumberRoll({ value, direction, className, announce }: NumberRollProps) {
  const reduce = useReducedMotion() ?? false
  const previous = useRef(value)
  // Rendered only after mount, so the first paint is the final value and the
  // counter does not roll up from nothing on every page load.
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const up = direction ? direction === "up" : value >= previous.current
  useEffect(() => {
    previous.current = value
  }, [value])

  const digits = String(value).split("")

  return (
    <span
      className={cn("inline-flex tabular-nums", className)}
      aria-live={announce ? "polite" : undefined}
    >
      {/* The value, once, for assistive technology. */}
      <span className="sr-only">{value}</span>
      <span aria-hidden="true" className="inline-flex">
        {digits.map((d, i) => (
          <Digit
            key={`${digits.length}-${i}`}
            digit={d}
            up={up}
            // Stagger from the right: that is the order a carry propagates.
            delay={mounted && !reduce ? ((digits.length - 1 - i) * 30) / 1000 : 0}
            reduce={reduce || !mounted}
          />
        ))}
      </span>
    </span>
  )
}
