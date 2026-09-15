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
  /**
   * Reserve room for this many digits, so the counter's box does not change width
   * when the value gains one.
   *
   * This is a layout guarantee, not a formatting one — the number is **not**
   * zero-padded, it is only given the space. A counter that starts at `0` while
   * data loads and settles on `24` grows by a digit, and on a phone that single
   * digit was enough to push the tasks header past its wrap point: the whole
   * title row reflowed to two lines and every element below it jumped 54px, for
   * a measured CLS of 0.119 on a 390px screen.
   *
   * The rule it encodes is worth stating plainly: **layout must be decided by the
   * viewport, never by the data.** Anything sized to its current value will
   * eventually resize to a different one, and the moment it does is exactly the
   * moment the user is reading.
   */
  minDigits?: number
}

/** One digit column. Keyed on the digit so a change mounts a new one and the old exits. */
function Digit({ digit, up, delay, reduce }: { digit: string; up: boolean; delay: number; reduce: boolean }) {
  if (reduce) return <span className="tabular-nums">{digit}</span>

  return (
    /**
     * An inline GRID, one cell, with both the outgoing and incoming digit stacked in
     * it. That is what makes the column size itself: the cell takes the digit's own
     * width and, crucially, the surrounding line box's height.
     *
     * The first attempt forced `height: 1em; line-height: 1`, which is shorter than
     * the line box of the text around it — so dropping a roller into a pill moved
     * that pill 3px and put a layout shift on every screen with a counter. A
     * hidden copy of the digit sized it correctly but made the value appear three
     * times in the DOM, turning `getByText("5")` into an ambiguous match.
     *
     * `1ch` keeps the width stable while a digit changes: with `tabular-nums` every
     * figure has that exact advance width.
     */
    <span
      className="inline-grid overflow-hidden tabular-nums"
      style={{ width: "1ch", gridTemplateAreas: '"d"' }}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={digit}
          initial={{ y: up ? "100%" : "-100%", opacity: 0 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={{ y: up ? "-100%" : "100%", opacity: 0 }}
          transition={{ duration: DURATION_DELIBERATE, ease: EASE_OUT_EXPO, delay }}
          style={{ gridArea: "d" }}
          className="block text-center"
        >
          {digit}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

export function NumberRoll({ value, direction, className, announce, minDigits }: NumberRollProps) {
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

  /**
   * Reserved width, in `ch`. With `tabular-nums` every figure has exactly that
   * advance, so `minWidth` here is the width of `minDigits` digits — no more, and
   * no zero-padding. The value stays right-aligned inside it, which is where a
   * number belongs when its neighbours are numbers.
   */
  const reserved = minDigits && minDigits > digits.length ? { minWidth: `${minDigits}ch` } : undefined

  return (
    <span
      className={cn("inline-flex tabular-nums", className)}
      aria-live={announce ? "polite" : undefined}
    >
      {/* The value, once, for assistive technology. */}
      <span className="sr-only">{value}</span>
      <span aria-hidden="true" className="inline-flex justify-end" style={reserved}>
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
