"use client"

import { useState } from "react"
import { PriorityMeter } from "@/components/ui/priority-meter"
import { FIELD_LABEL_CLASS } from "@/components/ui/field"
import { cn } from "@/lib/utils"

const LEVELS = [1, 2, 3, 4, 5]
const HOLDS = [
  "A priority, as a length rather than a colour",
  "A due date, or a range when you do not know the day yet",
  "A category you own, in a colour you chose",
  "Subtasks, exactly two levels deep and no further",
  "A branch: the timeline where people reply about it",
]

/**
 * Block 5 — priority as magnitude.
 *
 * Rule 5 of the design system, running in front of the visitor: priority is never
 * encoded by hue alone. Five priority hues collapsed under deuteranopia — the OKLab
 * distance between the two lowest measured 0.049, below the just-noticeable threshold.
 * Filled length survives greyscale and every form of colour blindness, and the meter
 * speaks its own value, so the magnitude is never carried by sight alone.
 */
export function PriorityDemo() {
  const [value, setValue] = useState(3)

  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
      <div className="rounded-lg border border-line bg-paper-raised p-6 shadow-sm sm:p-7">
        <p className={FIELD_LABEL_CLASS}>Priority</p>

        <div className="mt-4 flex min-h-control items-center">
          <PriorityMeter value={value} size="md" />
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => setValue(level)}
              aria-pressed={value === level}
              aria-label={`Set priority ${level} of 5`}
              className={cn(
                "inline-flex h-control w-control items-center justify-center rounded-md border",
                "text-body-sm font-bold tabular-nums transition-colors duration-fast",
                value === level
                  ? "border-ink bg-ink text-paper"
                  : "border-line-strong bg-paper text-ink-muted hover:bg-paper-sunken hover:text-ink"
              )}
            >
              {level}
            </button>
          ))}
        </div>

        <p className="mt-5 text-body-sm text-ink-subtle">
          Five bars, one ink. Turn your screen to greyscale and the reading does not change.
        </p>
      </div>

      <div>
        <p className="text-body text-ink-muted">Everything a task holds:</p>
        <ul className="mt-4 flex flex-col gap-3">
          {HOLDS.map((hold) => (
            <li key={hold} className="flex items-start gap-3 text-body-sm text-ink-muted">
              <span
                aria-hidden="true"
                className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-ink-faint"
              />
              {hold}
            </li>
          ))}
        </ul>
        <p className="mt-5 text-body-sm text-ink-subtle">
          No recurrence, no reminders, no attachments. Those are decisions, not gaps — block eight
          lists the rest of them.
        </p>
      </div>
    </div>
  )
}
