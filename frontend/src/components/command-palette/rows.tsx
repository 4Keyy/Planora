"use client"

import type { CSSProperties, ReactNode } from "react"
import {
  AlarmClock,
  CalendarClock,
  CalendarRange,
  Check,
  Circle,
  CornerDownLeft,
  Flame,
  Folder,
  Play,
  UsersRound,
  type LucideIcon,
} from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { Kbd } from "@/components/ui/shortcuts-overlay"
import { ICON_MAP } from "@/lib/icon-map"
import { cn } from "@/lib/utils"
import { describeDue, toRanges, type DueTone, type PaletteTask, type ViewId } from "./search"
import type { PaletteItem } from "./sections"

// ─── Highlight ──────────────────────────────────────────────────────────────

/**
 * The text with the letters the query matched marked — the reader sees why a
 * result is there, which is what makes a fuzzy match feel deliberate rather
 * than random.
 */
export function Highlight({ text, indices }: { text: string; indices?: number[] }) {
  if (!indices || indices.length === 0) return <>{text}</>
  const parts: ReactNode[] = []
  let at = 0
  for (const [start, end] of toRanges(indices.filter((i) => i < text.length))) {
    if (start > at) parts.push(text.slice(at, start))
    parts.push(
      <mark key={start} className="rounded-[3px] bg-warn/20 px-px text-ink">
        {text.slice(start, end)}
      </mark>,
    )
    at = end
  }
  if (at < text.length) parts.push(text.slice(at))
  return <>{parts}</>
}

// ─── Glyphs ─────────────────────────────────────────────────────────────────

/** The category's colour is the user's data, so it arrives inline. */
export function tint(color: string | null | undefined): CSSProperties | undefined {
  return color ? { backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color } : undefined
}

export const VIEW_GLYPH: Record<ViewId, LucideIcon> = {
  overdue: AlarmClock,
  today: CalendarClock,
  week: CalendarRange,
  progress: Play,
  shared: UsersRound,
  urgent: Flame,
}

export const TONE_GLYPH: Record<string, string> = {
  alert: "bg-alert-surface text-alert",
  warn: "bg-warn-surface text-warn",
  accent: "bg-accent-surface text-accent",
  ink: "bg-paper-sunken text-ink",
}

export const DUE_TONE: Record<DueTone, string> = {
  alert: "bg-alert-surface text-alert",
  warn: "bg-warn-surface text-warn",
  muted: "text-ink-muted",
}

const SQUIRCLE = "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md"

export function TaskGlyph({ task, className }: { task: PaletteTask; className?: string }) {
  if (task.completed) {
    return (
      <span aria-hidden="true" className={cn(SQUIRCLE, "bg-positive-surface text-positive", className)}>
        <Check className="h-4 w-4" strokeWidth={2.75} />
      </span>
    )
  }
  const Icon = task.categoryIcon ? (ICON_MAP[task.categoryIcon] ?? Folder) : null
  if (Icon && task.categoryColor) {
    return (
      <span aria-hidden="true" className={cn(SQUIRCLE, className)} style={tint(task.categoryColor)}>
        <Icon className="h-4 w-4" />
      </span>
    )
  }
  return (
    <span aria-hidden="true" className={cn(SQUIRCLE, "bg-paper-sunken text-ink-subtle", className)}>
      <Circle className="h-4 w-4" strokeWidth={2.25} />
    </span>
  )
}

function ItemGlyph({ item }: { item: PaletteItem }) {
  if (item.kind === "task" && item.task) return <TaskGlyph task={item.task} />
  if (item.kind === "category" && item.category) {
    const Icon = item.category.icon ? (ICON_MAP[item.category.icon] ?? Folder) : Folder
    return (
      <span aria-hidden="true" className={cn(SQUIRCLE, !item.category.color && "bg-paper-sunken text-ink-muted")} style={tint(item.category.color)}>
        <Icon className="h-4 w-4" />
      </span>
    )
  }
  if (item.kind === "person" && item.person) {
    return (
      <span aria-hidden="true" className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full">
        <Avatar src={item.person.avatar} firstName={item.person.name} email={item.person.email} size={32} />
      </span>
    )
  }
  if (item.kind === "view" && item.view) {
    const Icon = VIEW_GLYPH[item.view.id]
    return (
      <span aria-hidden="true" className={cn(SQUIRCLE, TONE_GLYPH[item.view.tone])}>
        <Icon className="h-4 w-4" />
      </span>
    )
  }
  const Icon = item.icon ?? Circle
  return (
    <span aria-hidden="true" className={cn(SQUIRCLE, item.kind === "create" ? "bg-ink text-paper" : "bg-paper-sunken text-ink-muted")}>
      <Icon className="h-4 w-4" strokeWidth={2.25} />
    </span>
  )
}

// ─── Secondary line ─────────────────────────────────────────────────────────

/** Who a task concerns, in a few words: "from Ada", "with Ada and Ben", "all friends". */
export function audience(task: PaletteTask, names: Map<string, string>): string | null {
  if (!task.mine) return task.ownerName ? `from ${task.ownerName}` : "shared with you"
  if (task.sharedWithAll) return "all friends"
  if (task.sharedWith.length === 0) return null
  const known = task.sharedWith.map((id) => names.get(id)).filter((n): n is string => Boolean(n))
  if (known.length === 0) return `with ${task.sharedWith.length} ${task.sharedWith.length === 1 ? "friend" : "friends"}`
  if (known.length === 1 && task.sharedWith.length === 1) return `with ${known[0]}`
  const rest = task.sharedWith.length - 1
  return `with ${known[0]} +${rest}`
}

function taskLine(task: PaletteTask, names: Map<string, string>, hideCategory: boolean): ReactNode {
  const parts: ReactNode[] = []
  if (task.categoryName && !hideCategory) {
    parts.push(
      <span key="cat" className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ink-subtle" style={task.categoryColor ? { backgroundColor: task.categoryColor } : undefined} />
        {task.categoryName}
      </span>,
    )
  }
  const who = audience(task, names)
  if (who) parts.push(<span key="who" className={cn(!task.mine || task.sharedWithAll || task.sharedWith.length ? "text-accent" : undefined)}>{who}</span>)
  if (!task.completed && task.inProgress) parts.push(<span key="prog">in progress</span>)
  if (!task.completed && task.openSubtasks > 0) {
    parts.push(<span key="steps">{task.openSubtasks} {task.openSubtasks === 1 ? "step" : "steps"} open</span>)
  }
  if (task.completed) parts.push(<span key="done">done</span>)
  if (parts.length === 0) return null
  return parts.flatMap((part, i) => (i === 0 ? [part] : [<span key={`sep-${i}`} aria-hidden="true" className="text-line-strong">·</span>, part]))
}

// ─── Row ────────────────────────────────────────────────────────────────────

export interface RowProps {
  item: PaletteItem
  active: boolean
  now: Date
  names: Map<string, string>
  /** The gliding highlight, rendered by the caller so it can carry a shared layout id. */
  highlight?: ReactNode
  /** Inside a category's scope every row would repeat its name. */
  hideCategory?: boolean
}

export function RowContent({ item, active, now, names, highlight, hideCategory = false }: RowProps) {
  const task = item.task
  const due = task ? describeDue(task, now) : null

  let secondary: ReactNode = item.hint ?? null
  if (task) secondary = taskLine(task, names, hideCategory)
  else if (item.category) secondary = `${item.category.open} open ${item.category.open === 1 ? "task" : "tasks"}`
  else if (item.person) secondary = item.person.shared ? `${item.person.shared} shared ${item.person.shared === 1 ? "task" : "tasks"}` : item.person.email
  else if (item.view) secondary = item.view.hint

  const narrows = item.action.type === "scope"

  return (
    <>
      {highlight}
      {/* Positioned without a z-index: painted after the highlight, so above it. */}
      <span className="relative flex min-w-0 flex-1 items-center gap-3">
        <ItemGlyph item={item} />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-body-sm font-semibold",
              task?.completed ? "text-ink-muted line-through decoration-line-strong" : "text-ink",
            )}
          >
            <Highlight text={item.label} indices={item.indices} />
          </span>
          {secondary ? (
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-caption font-medium text-ink-muted">
              {secondary}
            </span>
          ) : null}
        </span>
      </span>

      <span className="relative flex flex-shrink-0 items-center gap-2">
        {due ? (
          <span className={cn("rounded-full px-2 py-0.5 text-caption font-semibold tabular-nums", DUE_TONE[due.tone])}>
            {due.label}
          </span>
        ) : null}
        {item.view ? (
          <span className={cn("min-w-6 rounded-full px-2 py-0.5 text-center text-caption font-semibold tabular-nums", item.view.count ? TONE_GLYPH[item.view.tone] : "text-ink-subtle")}>
            {item.view.count}
          </span>
        ) : null}
        {item.shortcut ? (
          <span aria-hidden="true" className="hidden sm:inline-flex">
            <Kbd>{item.shortcut}</Kbd>
          </span>
        ) : null}
        {active ? (
          narrows ? (
            <span aria-hidden="true" className="hidden items-center gap-1 text-caption font-semibold text-ink-muted sm:inline-flex">
              <Kbd>Tab</Kbd>
            </span>
          ) : (
            <CornerDownLeft aria-hidden="true" className="hidden h-3.5 w-3.5 text-ink-subtle sm:block" />
          )
        ) : null}
      </span>
    </>
  )
}
