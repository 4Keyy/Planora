"use client"

import * as React from "react"
import { NumberRoll } from "@/components/ui/number-roll"
import { cn } from "@/lib/utils"

/**
 * Priority as a five-segment meter in one ink colour.
 *
 * Hue cannot carry this scale. Measured in OKLab with the Viénot–Brettel–Mollon
 * dichromat matrices, the old five-colour palette put `veryLow` and `low` 0.049
 * apart under deuteranopia and `high` and `urgent` 0.070 apart — indistinguishable.
 * Even with normal vision `high` (orange) and `urgent` (red) sat closer together
 * than `veryLow` and `low`, so the five hues read as unordered labels rather than
 * a scale. A grey ramp was no better: its lightest step measured 2.54:1.
 *
 * Filled length is monotonic, survives every kind of colour blindness, survives
 * greyscale printing, and frees the product's one saturated colour for what it
 * should mean — overdue.
 *
 * ## When it changes under a key
 *
 * With `animate`, a new level is shown as a change rather than a redraw: the segments
 * between the old level and the new one fill (or empty) one after another, outward from
 * the old end, each with a short upward tick, and the `n/5` rolls — the product's motion
 * for "a quantity changed, and by how much". `pulse` ticks the filled segments without a
 * change, for a key that asked for the level the task already has: the press is answered
 * rather than met with silence. Transform and colour only; under reduced motion the
 * global rule reduces both to a step.
 */

const LEVELS = 5
/** Between one segment and the next in a cascade. Five segments land inside `fast` + 160ms. */
const STEP_MS = 40

export type PriorityMeterProps = {
  /** 1-5. Values outside the range are clamped. */
  value: number
  /** Show the `4/5` numeral beside the meter. */
  showValue?: boolean
  size?: "sm" | "md"
  className?: string
  /** Cascade the segments and roll the numeral when the value changes. */
  animate?: boolean
  /** Changing this ticks the filled segments without a value change. */
  pulse?: number
}

const LABELS = ["Very low", "Low", "Medium", "High", "Urgent"] as const

interface Track {
  level: number
  /** The level the last change started from; equal to `level` for a pulse. */
  from: number
  /** Bumped by every change and every pulse, so a tick replays. */
  seq: number
  pulse: number | undefined
}

export function PriorityMeter({
  value,
  showValue = true,
  size = "md",
  className,
  animate = false,
  pulse,
}: PriorityMeterProps) {
  const level = Math.min(LEVELS, Math.max(1, Math.round(value)))
  const label = LABELS[level - 1]

  // Derived from props during render (React's documented pattern for "the previous value"):
  // the cascade must know where it starts in the same render that draws its end.
  const [track, setTrack] = React.useState<Track>({ level, from: level, seq: 0, pulse })
  if (track.level !== level || track.pulse !== pulse) {
    setTrack({
      level,
      from: track.level !== level ? track.level : level,
      seq: track.seq + 1,
      pulse,
    })
  }

  const moving = animate && track.seq > 0
  const low = Math.min(track.from, level)
  const high = Math.max(track.from, level)
  const rising = level > track.from

  /** Where this segment sits in the cascade, or null if this change leaves it alone. */
  const stepOf = (i: number): number | null => {
    if (!moving) return null
    if (track.from === level) return i < level ? i : null // a pulse: every filled one, in order
    if (i < low || i >= high) return null
    return rising ? i - low : high - 1 - i
  }

  return (
    <span
      className={cn("inline-flex items-center gap-2", className)}
      role="img"
      aria-label={`Priority ${level} of ${LEVELS} — ${label}`}
    >
      <span aria-hidden="true" className="inline-flex items-end gap-[2px]">
        {Array.from({ length: LEVELS }, (_, i) => {
          const step = stepOf(i)
          const delay = step === null ? undefined : `${step * STEP_MS}ms`
          return (
            <span
              key={i}
              style={delay ? { transitionDelay: delay, animationDelay: delay } : undefined}
              className={cn(
                "block w-[3px] origin-bottom rounded-[1px] transition-colors duration-fast",
                size === "sm" ? "h-2" : "h-2.5",
                i < level ? "bg-ink-subtle" : "bg-line",
                // Two identical keyframes, alternated per change: switching the animation's
                // name restarts it on the same node. Remounting the segment instead would
                // restart the tick but drop the colour transition the cascade is made of.
                step !== null && (track.seq % 2 ? "animate-meter-tick" : "animate-meter-tock"),
                step !== null && "[animation-fill-mode:both]",
              )}
            />
          )
        })}
      </span>
      {showValue && (
        <span aria-hidden="true" className="inline-flex text-caption font-semibold tabular-nums text-ink-muted">
          {animate ? <NumberRoll value={level} /> : level}/{LEVELS}
        </span>
      )}
    </span>
  )
}
