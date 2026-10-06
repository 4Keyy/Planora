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
  /**
   * Where the value sits inside the reserved width, which decides where the spare room
   * goes when the value is shorter than `minDigits`.
   *
   * - `end` (the default) for a number at the right edge of a row, or in a column of
   *   numbers: the units stay aligned and the spare room is on the left, against space.
   * - `start` for a number read right after its label ("Keys 3"): the spare room goes
   *   after it, where the next group's own gap absorbs it.
   * - `center` for a number between two things, or at the centre of something — a
   *   count inside a ring, a count between a dot and its word — so the spare room is
   *   split and neither side reads as a hole.
   *
   * A single digit right-aligned in a two-digit box looked like a mis-typed "_3", with
   * nothing on its left, wherever the number was not already at a right edge.
   */
  align?: "start" | "center" | "end"
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
     * The column is sized by the digit, never told a width. It used to be pinned to
     * `1ch` on the belief that `tabular-nums` makes every figure exactly that wide. It
     * does not: `ch` is the advance of the font's DEFAULT zero, and in Plus Jakarta Sans
     * that zero is proportional — 7.00px at 14px bold, against 8.41px for the tabular
     * figures actually drawn. With `overflow: hidden` on a box 17% too narrow, the right
     * edge of every digit in the product was shaved off, in every badge and counter. The
     * grid cell now takes the tabular advance itself, which is the same for every digit,
     * so the width is still stable while a digit rolls.
     *
     * The clip is vertical only. The roll needs the column to hide the digit sliding in
     * and out above and below; it never needed to clip sideways, and a bold glyph's ink
     * may overhang its advance. `clip-path` rather than `overflow` because it also clips
     * the outgoing digit that `popLayout` lifts out as `position: absolute` — `relative`
     * makes this column its containing block, so it lands where it was.
     */
    <span data-digit="" className="relative inline-grid tabular-nums [clip-path:inset(0_-0.25em)]">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={digit}
          initial={{ y: up ? "100%" : "-100%", opacity: 0 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={{ y: up ? "-100%" : "100%", opacity: 0 }}
          transition={{ duration: DURATION_DELIBERATE, ease: EASE_OUT_EXPO, delay }}
          className="block [grid-area:1/1]"
        >
          {digit}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

const ALIGN: Record<NonNullable<NumberRollProps["align"]>, string> = {
  start: "justify-self-start",
  center: "justify-self-center",
  end: "justify-self-end",
}

export function NumberRoll({ value, direction, className, announce, minDigits, align = "end" }: NumberRollProps) {
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
   * The reservation is drawn, not computed. A `minWidth` in `ch` repeats the column
   * bug one level up — it reserves the width of proportional zeros, so the box was
   * still 17% short of two real digits and 7 → 24 still nudged its neighbours.
   *
   * Instead an invisible run of `minDigits` zeros, in the same font and the same
   * tabular figures, shares one grid cell with the digits, and the cell takes the wider
   * of the two. It is a pseudo-element on purpose: CSS-generated text is not in the
   * DOM, so it is never read aloud and never matches a `getByText`. No zero-padding —
   * only the space. The value is right-aligned inside it by default, which is where a
   * number belongs when its neighbours are numbers; `align` moves it (see the prop).
   */
  const reserve = minDigits && minDigits > digits.length ? "0".repeat(minDigits) : undefined

  return (
    <span
      className={cn("inline-flex tabular-nums", className)}
      aria-live={announce ? "polite" : undefined}
    >
      {/* The value, once, for assistive technology. */}
      <span className="sr-only">{value}</span>
      <span
        aria-hidden="true"
        data-reserve={reserve}
        className={cn(
          "inline-grid",
          reserve && "before:invisible before:content-[attr(data-reserve)] before:[grid-area:1/1]"
        )}
      >
        <span className={cn("inline-flex [grid-area:1/1]", ALIGN[align])}>
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
    </span>
  )
}
