"use client"

import { useMemo } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { DURATION_SLOW, EASE_OUT_EXPO } from "@/lib/animations"
import { UI_LOCALE } from "@/lib/datetime"
import { cn } from "@/lib/utils"

/**
 * Seven days of completions, as bars.
 *
 * The dashboard's weekly block used to say one number — "3 Completed" — in a space
 * that could hold a week's shape. A single total answers "how many"; the bars
 * answer "when", which is the question a person actually has about their own week:
 * whether they are working steadily or clearing everything on a Sunday night.
 *
 * The bars are built from the real completion timestamps of the tasks already
 * loaded for the ring, so this costs no extra request and cannot disagree with the
 * number beside it.
 */

export interface WeekBarsProps {
  /** ISO timestamps of things completed. Anything older than seven days is ignored. */
  completions: (string | null | undefined)[]
  className?: string
}

/** Midnight local time, so "today" means the user's today rather than UTC's. */
function startOfDay(d: Date): Date {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  return copy
}

export function WeekBars({ completions, className }: WeekBarsProps) {
  const reduce = useReducedMotion() ?? false

  const days = useMemo(() => {
    const today = startOfDay(new Date())
    // Seven buckets ending today, so the rightmost bar is always "now".
    const buckets = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(today)
      date.setDate(today.getDate() - (6 - i))
      return { date, count: 0 }
    })

    for (const iso of completions) {
      if (!iso) continue
      const when = new Date(iso)
      if (Number.isNaN(when.getTime())) continue
      const day = startOfDay(when)
      const bucket = buckets.find((b) => b.date.getTime() === day.getTime())
      if (bucket) bucket.count++
    }
    return buckets
  }, [completions])

  const peak = Math.max(1, ...days.map((d) => d.count))
  const total = days.reduce((n, d) => n + d.count, 0)

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {/*
       * One accessible sentence for the whole chart. Seven separately-labelled bars
       * would make a screen-reader user tab through a week of numbers to learn
       * something a sighted user takes in at a glance.
       */}
      <span className="sr-only">
        {total === 0
          ? "Nothing completed in the last seven days."
          : `${total} completed in the last seven days: ` +
            days
              .map((d) => `${d.date.toLocaleDateString(UI_LOCALE, { weekday: "short" })} ${d.count}`)
              .join(", ")}
      </span>

      <div aria-hidden="true" className="flex items-end gap-1" style={{ height: 34 }}>
        {days.map((d, i) => {
          const isToday = i === days.length - 1
          // An empty day still draws a 2px seat, so the week reads as seven days
          // rather than as however many had activity.
          const height = d.count === 0 ? 2 : Math.max(4, Math.round((d.count / peak) * 34))
          return (
            <motion.span
              key={d.date.toISOString()}
              className={cn(
                "min-w-0 flex-1 origin-bottom rounded-sm",
                d.count === 0 ? "bg-line" : isToday ? "bg-ink" : "bg-ink-subtle",
              )}
              style={{ height }}
              initial={reduce ? false : { scaleY: 0 }}
              animate={{ scaleY: 1 }}
              // Left to right, the direction the week ran.
              transition={{ duration: DURATION_SLOW, ease: EASE_OUT_EXPO, delay: reduce ? 0 : i * 0.04 }}
            />
          )
        })}
      </div>

      <div aria-hidden="true" className="flex gap-1">
        {days.map((d, i) => (
          <span
            key={d.date.toISOString()}
            className={cn(
              "flex-1 text-center text-caption font-semibold",
              i === days.length - 1 ? "text-ink" : "text-ink-subtle",
            )}
          >
            {d.date.toLocaleDateString(UI_LOCALE, { weekday: "narrow" })}
          </span>
        ))}
      </div>
    </div>
  )
}
