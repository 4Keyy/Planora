"use client"

import { useReducedMotion } from "framer-motion"
import { motion } from "@/components/ui/motion"
import type { LucideIcon } from "lucide-react"
import { useEnter } from "@/components/animated/entrance"
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

export function StatRow({ stats, className, entranceAt = 0, ready = true }: {
  stats: Stat[]
  className?: string
  /** On a page's timeline: when the first stat arrives. The rest follow a chip's beat apart. */
  entranceAt?: number
  /** False until the numbers are known: the chips wait for them rather than arrive reading 0. */
  ready?: boolean
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {stats.map((s, i) => (
        <StatChip key={s.id} stat={s} index={i} entranceAt={entranceAt} ready={ready} />
      ))}
    </div>
  )
}

function StatChip({ stat: s, index, entranceAt, ready }: { stat: Stat; index: number; entranceAt: number; ready: boolean }) {
  const reduce = useReducedMotion() ?? false
  // On a page's timeline the chip arrives with the page; anywhere else it animates itself.
  const entrance = useEnter("chip", { at: entranceAt, index, ready })
  const Icon = s.icon
  const alert = s.tone === "alert" && s.value > 0
  const interactive = Boolean(s.onSelect)
  const Element = interactive ? motion.button : motion.div
  const own = entrance.className === undefined
  return (
    <Element
      {...(interactive
        ? { type: "button" as const, onClick: s.onSelect, "aria-pressed": s.active }
        : {})}
      initial={reduce || !own ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO, delay: reduce ? 0 : index * 0.04 }}
      style={entrance.style}
      className={cn(
        "flex items-center gap-2.5 rounded-md border px-3.5 py-2 text-left transition-colors duration-fast",
        entrance.className,
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
        {/* Remounted when the numbers are first known, so the chip arrives reading its real
            value instead of rolling up from the 0 it held while it waited. */}
        <NumberRoll key={ready ? "known" : "loading"} value={s.value} />
      </span>
      <span className={cn("text-body-sm font-medium", alert ? "text-alert" : "text-ink-subtle")}>
        {s.label}
      </span>
    </Element>
  )
}
