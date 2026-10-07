"use client"

import type { ReactNode } from "react"
import { Folder, Search } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { Kbd } from "@/components/ui/shortcuts-overlay"
import { PriorityMeter } from "@/components/ui/priority-meter"
import { formatDateLong } from "@/lib/datetime"
import { ICON_MAP } from "@/lib/icon-map"
import { cn } from "@/lib/utils"
import { DUE_TONE, TONE_GLYPH, TaskGlyph, VIEW_GLYPH, audience, tint } from "./rows"
import { SMART_VIEWS, byUrgency, daysFromToday, describeDue, type PaletteTask } from "./search"
import { inScope, type PaletteItem, type Scope } from "./sections"

/**
 * The column beside the results: what the highlighted row actually is, before it
 * is opened. A task shows its details — so "which of the three 'Call the bank'
 * tasks is it" is answered without opening each one — and a category, a person
 * or a view shows the open tasks it would narrow the list to.
 */

const FACT_LABEL = "text-caption font-semibold uppercase tracking-wider text-ink-subtle"

/**
 * The category's colour, glowing behind the corner of the preview — the same glow
 * a task card takes on hover. One element that stays mounted while the highlight
 * moves from task to task, so the colour cross-fades instead of flashing.
 */
function Glow({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute -right-14 -top-16 h-44 w-44 rounded-full opacity-70 blur-3xl transition-colors duration-slow"
      style={{ backgroundColor: color ? `color-mix(in srgb, ${color} 40%, transparent)` : "transparent" }}
    />
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] items-baseline gap-2">
      <dt className={FACT_LABEL}>{label}</dt>
      <dd className="min-w-0 text-caption font-medium text-ink">{children}</dd>
    </div>
  )
}

function dueSentence(task: PaletteTask, now: Date): ReactNode {
  if (!task.dueDate) return <span className="text-ink-muted">No deadline</span>
  const days = daysFromToday(task.dueDate, now)
  const due = describeDue(task, now)
  const date = formatDateLong(task.dueDate)
  if (days === null || !due) return date
  const relative =
    days < 0 ? `${-days} ${days === -1 ? "day" : "days"} late`
    : days === 0 ? "today"
    : days === 1 ? "tomorrow"
    : `in ${days} days`
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>{date}</span>
      <span className={cn("rounded-full text-caption font-semibold", due.tone !== "muted" && "px-2 py-0.5", DUE_TONE[due.tone])}>{relative}</span>
    </span>
  )
}

function TaskPreview({ task, now, names }: { task: PaletteTask; now: Date; names: Map<string, string> }) {
  const who = audience(task, names)
  const workers = task.workers.map((w) => w.name).filter(Boolean)
  return (
    <div className="relative flex h-full flex-col">
      <Glow color={task.completed ? null : task.categoryColor} />
      <div className="relative flex items-center gap-2">
        <TaskGlyph task={task} className="h-7 w-7" />
        <span className="truncate text-caption font-semibold text-ink-muted">{task.categoryName ?? "No category"}</span>
      </div>
      <h3 className={cn("relative mt-3 line-clamp-3 text-body font-bold leading-snug tracking-tight", task.completed ? "text-ink-muted line-through decoration-line-strong" : "text-ink")}>
        {task.title}
      </h3>
      <p className="relative mt-1.5 line-clamp-4 text-caption font-medium leading-relaxed text-ink-muted">
        {task.description ?? "No details yet."}
      </p>

      <dl className="relative mt-4 space-y-2.5 border-t border-line pt-4">
        {task.completed ? (
          <Fact label="Done">{task.completedAt ? formatDateLong(task.completedAt) : "Yes"}</Fact>
        ) : (
          <Fact label="Due">{dueSentence(task, now)}</Fact>
        )}
        <Fact label="Priority"><PriorityMeter value={task.priority} size="sm" /></Fact>
        <Fact label="People">
          {who ? <span className="text-accent">{who.charAt(0).toUpperCase() + who.slice(1)}</span> : <span className="text-ink-muted">Only you</span>}
        </Fact>
        {workers.length > 0 ? <Fact label="Working">{workers.join(", ")}</Fact> : null}
        {task.openSubtasks > 0 ? <Fact label="Steps">{task.openSubtasks} open</Fact> : null}
      </dl>
    </div>
  )
}

function TaskSample({ tasks, empty }: { tasks: PaletteTask[]; empty: string }) {
  if (tasks.length === 0) return <p className="relative mt-3 text-caption font-medium text-ink-muted">{empty}</p>
  return (
    <ul className="relative mt-3 space-y-2">
      {tasks.map((task) => (
        <li key={task.id} className="flex items-center gap-2 text-caption font-medium text-ink">
          <span aria-hidden="true" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-ink-subtle" style={task.categoryColor ? { backgroundColor: task.categoryColor } : undefined} />
          <span className="truncate">{task.title}</span>
        </li>
      ))}
    </ul>
  )
}

function ScopeGlyph({ scope, email }: { scope: Scope; email?: string | null }) {
  if (scope.kind === "person") {
    return (
      <span aria-hidden="true" className="flex h-11 w-11 overflow-hidden rounded-full">
        <Avatar src={scope.avatar} firstName={scope.label} email={email} size={44} />
      </span>
    )
  }
  if (scope.kind === "category") {
    const Icon = scope.icon ? (ICON_MAP[scope.icon] ?? Folder) : Folder
    return (
      <span aria-hidden="true" className={cn("flex h-11 w-11 items-center justify-center rounded-lg", !scope.color && "border border-line bg-paper text-ink-muted")} style={tint(scope.color)}>
        <Icon className="h-5 w-5" />
      </span>
    )
  }
  const Icon = VIEW_GLYPH[scope.id]
  const tone = SMART_VIEWS.find((v) => v.id === scope.id)?.tone ?? "ink"
  return (
    <span aria-hidden="true" className={cn("flex h-11 w-11 items-center justify-center rounded-lg", TONE_GLYPH[tone])}>
      <Icon className="h-5 w-5" />
    </span>
  )
}

/** A category, a person or a view: what narrowing to it would show. */
function ScopePreview({ scope, description, email, tasks, now }: {
  scope: Scope
  description?: string | null
  email?: string | null
  tasks: PaletteTask[]
  now: Date
}) {
  const open = tasks.filter((t) => !t.completed && inScope(t, scope, now)).sort(byUrgency)
  return (
    <div className="relative flex h-full flex-col">
      <Glow color={scope.kind === "category" ? scope.color : null} />
      <div className="relative">
        <ScopeGlyph scope={scope} email={email} />
      </div>
      <h3 className="relative mt-3 text-body font-bold tracking-tight text-ink">{scope.label}</h3>
      <p className="relative mt-1 text-caption font-medium text-ink-muted">
        {open.length} open {open.length === 1 ? "task" : "tasks"}
        {description ? ` · ${description}` : ""}
      </p>
      <TaskSample tasks={open.slice(0, 5)} empty="Nothing open here." />
      {open.length > 5 ? (
        <p className="relative mt-2 text-caption font-medium text-ink-subtle">and {open.length - 5} more</p>
      ) : null}
    </div>
  )
}

export function Preview({ item, scope, tasks, now, names }: {
  item: PaletteItem | null
  /** What the search is narrowed to: described when nothing in it is highlighted. */
  scope: Scope | null
  tasks: PaletteTask[]
  now: Date
  names: Map<string, string>
}) {
  if (!item) {
    if (scope) return <ScopePreview scope={scope} tasks={tasks} now={now} />
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <Search className="h-6 w-6 text-ink-subtle" aria-hidden="true" />
        <p className="mt-2 text-caption font-medium text-ink-muted">Nothing highlighted</p>
      </div>
    )
  }

  if (item.task) return <TaskPreview task={item.task} now={now} names={names} />

  if (item.action.type === "scope") {
    return (
      <ScopePreview
        scope={item.action.scope}
        description={item.category?.description}
        email={item.person?.email}
        tasks={tasks}
        now={now}
      />
    )
  }

  const Icon = item.icon
  return (
    <div className="flex h-full flex-col">
      {Icon ? (
        <span aria-hidden="true" className={cn("flex h-11 w-11 items-center justify-center rounded-lg", item.kind === "create" ? "bg-ink text-paper" : "border border-line bg-paper text-ink")}>
          <Icon className="h-5 w-5" />
        </span>
      ) : null}
      <h3 className="mt-3 text-body font-bold tracking-tight text-ink">{item.label}</h3>
      {item.hint ? <p className="mt-1 text-caption font-medium text-ink-muted">{item.hint}</p> : null}
      {item.shortcut ? (
        <p className="mt-auto flex items-center gap-1.5 pt-5 text-caption font-medium text-ink-muted">
          <Kbd>{item.shortcut}</Kbd> does this from any screen
        </p>
      ) : null}
    </div>
  )
}
