import * as React from "react"
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
 */

const LEVELS = 5

export type PriorityMeterProps = {
  /** 1-5. Values outside the range are clamped. */
  value: number
  /** Show the `4/5` numeral beside the meter. */
  showValue?: boolean
  size?: "sm" | "md"
  className?: string
}

const LABELS = ["Very low", "Low", "Medium", "High", "Urgent"] as const

export function PriorityMeter({ value, showValue = true, size = "md", className }: PriorityMeterProps) {
  const level = Math.min(LEVELS, Math.max(1, Math.round(value)))
  const label = LABELS[level - 1]

  return (
    <span
      className={cn("inline-flex items-center gap-2", className)}
      role="img"
      aria-label={`Priority ${level} of ${LEVELS} — ${label}`}
    >
      <span aria-hidden="true" className="inline-flex items-end gap-[2px]">
        {Array.from({ length: LEVELS }, (_, i) => (
          <span
            key={i}
            className={cn(
              "block w-[3px] rounded-[1px] transition-colors duration-fast",
              size === "sm" ? "h-2" : "h-2.5",
              i < level ? "bg-ink-subtle" : "bg-line",
            )}
          />
        ))}
      </span>
      {showValue && (
        <span aria-hidden="true" className="text-caption font-semibold tabular-nums text-ink-subtle">
          {level}/{LEVELS}
        </span>
      )}
    </span>
  )
}
