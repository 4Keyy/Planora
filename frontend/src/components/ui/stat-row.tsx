"use client"

import { motion, useReducedMotion } from "framer-motion"
import type { LucideIcon } from "lucide-react"
import { NumberRoll } from "@/components/ui/number-roll"
import { DURATION_UI, EASE_OUT_EXPO } from "@/lib/animations"
import { cn } from "@/lib/utils"

/**
 * A row of live facts about the workspace, each one a filter you can press.
 *
 * The dashboard's hero band held a single sentence — "You have 11 tasks." — across
 * the full width of a 1440px screen. A total is the least useful thing that can be
 * said about a task list: it answers "how many" when the questions a person
 * actually arrives with are "what is late", "what is today" and "what are other
 * people waiting on me for".
 *
 * Each stat is a button, not a label, because the number is only half an answer —
 * pressing it should show you the tasks it counted.
 *
 * A tone of `alert` is reserved for genuinely late work. Nothing else here earns a
 * saturated colour: three coloured stats side by side is a dashboard that shouts
 * and therefore says nothing.
 */

export interface Stat {
  id: string
  label: string
  value: number
  icon: LucideIcon
  tone?: "neutral" | "alert"
  onSelect?: () => void
  /** Marks the stat as the current filter. */
  active?: boolean
}

export function StatRow({ stats, className }: { stats: Stat[]; className?: string }) {
  const reduce = useReducedMotion() ?? false

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {stats.map((s, i) => {
        const Icon = s.icon
        const alert = s.tone === "alert" && s.value > 0
        const interactive = Boolean(s.onSelect)
        const Element = interactive ? motion.button : motion.div

        return (
          <Element
            key={s.id}
            {...(interactive
              ? { type: "button" as const, onClick: s.onSelect, "aria-pressed": s.active }
              : {})}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO, delay: reduce ? 0 : i * 0.04 }}
            className={cn(
              "flex items-center gap-2.5 rounded-md border px-3.5 py-2 text-left transition-colors duration-fast",
              interactive && "touch-target cursor-pointer hover:bg-paper-sunken",
              s.active
                ? "border-ink bg-paper-sunken"
                : alert
                  ? "border-alert/25 bg-alert-surface"
                  : "border-line bg-paper",
            )}
          >
            <Icon
              className={cn("h-4 w-4 flex-shrink-0", alert ? "text-alert" : "text-ink-subtle")}
              aria-hidden="true"
            />
            <span className={cn("text-body-sm font-bold tabular-nums", alert ? "text-alert" : "text-ink")}>
              <NumberRoll value={s.value} />
            </span>
            <span className={cn("text-body-sm font-medium", alert ? "text-alert" : "text-ink-subtle")}>
              {s.label}
            </span>
          </Element>
        )
      })}
    </div>
  )
}
