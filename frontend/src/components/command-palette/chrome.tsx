"use client"

import { useEffect, useState, type MouseEvent, type ReactNode } from "react"
import { useReducedMotion } from "framer-motion"
import { ArrowLeft, Folder, SearchX, X } from "lucide-react"
import { motion } from "@/components/ui/motion"
import { Avatar } from "@/components/ui/avatar"
import { Kbd } from "@/components/ui/shortcuts-overlay"
import { SPRING_STANDARD } from "@/lib/animations"
import { ICON_MAP } from "@/lib/icon-map"
import { cn } from "@/lib/utils"
import { TONE_GLYPH, VIEW_GLYPH, tint } from "./rows"
import { SMART_VIEWS, type SmartView } from "./search"
import { TABS, type MatchCounts, type Scope, type Tab } from "./sections"

/**
 * The palette's frame: everything around the results that is not a result — the
 * hint in the empty field, the narrowing chip, the tabs, the view chips, the empty
 * and loading states, and the footer that teaches the keys.
 */

/** Keeps focus in the search field when a control around it is clicked. */
const keepFocus = (event: MouseEvent) => event.preventDefault()

// ─── Keys ───────────────────────────────────────────────────────────────────

/**
 * A key cap that goes down when its key does. The footer's caps are pressed by
 * the real keys, so the reader sees ↓ move under their finger and learns the
 * palette's vocabulary without reading it.
 */
export function Key({ children, pressed = false }: { children: ReactNode; pressed?: boolean }) {
  return (
    <kbd
      data-pressed={pressed ? "" : undefined}
      className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line bg-paper px-1.5 text-caption font-semibold tabular-nums text-ink-muted shadow-sm transition-[transform,background-color,color,box-shadow] duration-instant data-[pressed]:translate-y-px data-[pressed]:bg-line data-[pressed]:text-ink data-[pressed]:shadow-none"
    >
      {children}
    </kbd>
  )
}

// ─── The hint in the empty field ────────────────────────────────────────────

const HINTS: Array<{ word: string; key?: string }> = [
  { word: "tasks" },
  { word: "categories", key: "#" },
  { word: "people", key: "@" },
  { word: "commands", key: ">" },
]

const ROLL_EVERY_MS = 2600

/**
 * "Search tasks", and the last word rolls: categories `#`, people `@`, commands
 * `>`. A static placeholder can list what the palette searches; this one also
 * says how to search only one kind of thing, at the moment the field is empty and
 * the reader is deciding what to type. It rolls the way a counter does — the
 * column of words moves up one row — and the copy of the first word at the end
 * lets the loop close without running backwards. Still under reduced motion.
 */
export function RollingHint({ scopeLabel }: { scopeLabel?: string | null }) {
  const reduce = useReducedMotion() ?? false
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (reduce || scopeLabel) return
    // From the copy back to the first word is a jump, not a roll — the two look the
    // same. Normally the transition's end makes it; this covers a tab that was
    // hidden while it ran and never delivered `transitionend`.
    const timer = window.setInterval(() => setStep((current) => (current >= HINTS.length ? 0 : current + 1)), ROLL_EVERY_MS)
    return () => window.clearInterval(timer)
  }, [reduce, scopeLabel])

  if (scopeLabel) return <span className="truncate">Search in {scopeLabel}…</span>
  if (reduce) return <span className="truncate">Search tasks, categories, people and commands…</span>

  const rows = [...HINTS, HINTS[0]]
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span>Search</span>
      <span className="relative h-6 overflow-hidden sm:h-7">
        <span
          // Landing on the first word is the jump back, so it alone has no transition.
          className={cn("flex flex-col", step !== 0 && "transition-transform duration-slow ease-emphasized")}
          style={{ transform: `translateY(${(-step * 100) / rows.length}%)` }}
          onTransitionEnd={() => {
            if (step === HINTS.length) setStep(0)
          }}
        >
          {rows.map((hint, i) => (
            <span key={i} className="flex h-6 items-center gap-2 whitespace-nowrap sm:h-7">
              {hint.word}
              {hint.key ? <Kbd>{hint.key}</Kbd> : null}
            </span>
          ))}
        </span>
      </span>
    </span>
  )
}

// ─── The narrowing chip ─────────────────────────────────────────────────────

function ScopeGlyph({ scope, size }: { scope: Scope; size: "sm" | "md" }) {
  const box = size === "sm" ? "h-5 w-5" : "h-6 w-6"
  const icon = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"
  if (scope.kind === "person") {
    return (
      <span aria-hidden="true" className={cn("flex flex-shrink-0 overflow-hidden rounded-full", box)}>
        <Avatar src={scope.avatar} firstName={scope.label} size={size === "sm" ? 20 : 24} />
      </span>
    )
  }
  if (scope.kind === "category") {
    const Icon = scope.icon ? (ICON_MAP[scope.icon] ?? Folder) : Folder
    return (
      <span aria-hidden="true" className={cn("flex flex-shrink-0 items-center justify-center rounded-full", box, !scope.color && "bg-line text-ink-muted")} style={tint(scope.color)}>
        <Icon className={icon} />
      </span>
    )
  }
  const Icon = VIEW_GLYPH[scope.id]
  const tone = SMART_VIEWS.find((v) => v.id === scope.id)?.tone ?? "ink"
  return (
    <span aria-hidden="true" className={cn("flex flex-shrink-0 items-center justify-center rounded-full", box, TONE_GLYPH[tone])}>
      <Icon className={icon} />
    </span>
  )
}

/**
 * What the search is narrowed to, sitting in the field before the text — the way
 * a recipient sits in a "To:" line. Backspace in the empty field removes it, so
 * the mouse never has to; the ✕ is there for the pointer.
 */
export function ScopeChip({ scope, onRemove }: { scope: Scope; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-[45%] flex-shrink-0 animate-scale-in items-center gap-1.5 rounded-full border border-line bg-paper-sunken py-0.5 pl-0.5 pr-1 text-body-sm font-semibold text-ink">
      <ScopeGlyph scope={scope} size="sm" />
      <span className="truncate">{scope.label}</span>
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={keepFocus}
        onClick={onRemove}
        aria-label={`Stop narrowing to ${scope.label}`}
        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-ink-subtle transition-colors duration-fast hover:bg-ink/5 hover:text-ink"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </span>
  )
}

// ─── Tabs, or the way back out of a scope ───────────────────────────────────

/**
 * All · Tasks · Categories · People · Commands. The selected one is the same ink
 * drop the app bar uses for the current page, and it flows between tabs the same
 * way. While something is typed each tab says how many results it holds, so the
 * reader sees where the matches are before switching; typing `#`, `@` or `>`
 * moves the drop on its own.
 */
export function TabBar({ tab, counts, onSelect }: { tab: Tab; counts: MatchCounts | null; onSelect: (tab: Tab) => void }) {
  const reduce = useReducedMotion() ?? false
  return (
    // Full row height, so the tabs' 44px hit areas fit inside the strip and it never
    // grows a vertical scrollbar; the horizontal one (a phone) is hidden — the strip
    // is swiped, and a 4px bar under five words is noise.
    <div role="group" aria-label="Show" className="flex h-full min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {TABS.map((t) => {
        const selected = tab === t.id
        const count = t.id === "all" || !counts ? null : counts[t.id]
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={selected}
            aria-label={count === null ? t.label : `${t.label}, ${count} ${count === 1 ? "result" : "results"}`}
            onMouseDown={keepFocus}
            onClick={() => onSelect(t.id)}
            className={cn(
              "touch-target relative inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-full px-3 text-body-sm font-semibold transition-colors duration-fast",
              selected ? "text-paper" : count === 0 ? "text-ink-subtle hover:text-ink" : "text-ink-muted hover:bg-ink/5 hover:text-ink",
            )}
          >
            {selected ? (
              <motion.span
                layoutId="palette-tab"
                aria-hidden="true"
                className="absolute inset-0 rounded-full bg-ink shadow-sm"
                transition={reduce ? { duration: 0 } : SPRING_STANDARD}
              />
            ) : null}
            <span className="relative">{t.label}</span>
            {count !== null ? (
              <span className={cn("relative text-caption tabular-nums", selected ? "text-paper-muted" : undefined)}>{count}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/** Replaces the tabs while narrowed: what the scope holds, and the way back. */
export function ScopeBar({ scope, open, done, onBack }: { scope: Scope; open: number; done: number; onBack: () => void }) {
  const summary = scope.kind === "view"
    ? `${open} ${open === 1 ? "task" : "tasks"}`
    : `${open} open${done ? ` · ${done} done` : ""}`
  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        onMouseDown={keepFocus}
        onClick={onBack}
        className="touch-target inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-full px-3 text-body-sm font-semibold text-ink-muted transition-colors duration-fast hover:bg-ink/5 hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All results
      </button>
      <span aria-hidden="true" className="h-4 w-px flex-shrink-0 bg-line" />
      <ScopeGlyph scope={scope} size="sm" />
      <span className="truncate text-caption font-medium text-ink-muted">
        <span className="font-semibold text-ink">{scope.label}</span> · {summary}
      </span>
    </div>
  )
}

// ─── View chips ─────────────────────────────────────────────────────────────

/**
 * The open questions about today's work, answered before anything is typed:
 * "Overdue 3", "Due today 2". Only the ones with an answer are shown, so the row
 * is also a status line — an empty row means nothing is late or due.
 */
export function ViewChips({ views, onPick }: { views: Array<SmartView & { count: number }>; onPick: (view: SmartView) => void }) {
  const shown = views.filter((view) => view.count > 0)
  if (shown.length === 0) return null
  return (
    // One swipeable line on a phone, where three wrapped lines of chips would push the
    // first result below the keyboard; wrapped from `sm`, where every chip fits in view.
    <div role="group" aria-label="Views" className="-mx-2 flex gap-1.5 overflow-x-auto px-3 pb-1 pt-3 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-1 [&::-webkit-scrollbar]:hidden">
      {shown.map((view) => {
        const Icon = VIEW_GLYPH[view.id]
        return (
          <button
            key={view.id}
            type="button"
            aria-label={`${view.label}, ${view.count} ${view.count === 1 ? "task" : "tasks"}`}
            onMouseDown={keepFocus}
            onClick={() => onPick(view)}
            className="inline-flex h-7 flex-shrink-0 items-center gap-1.5 rounded-full border border-line bg-paper pl-1 pr-2.5 text-caption font-semibold text-ink-muted shadow-sm transition-[transform,border-color,color] duration-fast hover:-translate-y-px hover:border-line-strong hover:text-ink active:translate-y-0"
          >
            <span aria-hidden="true" className={cn("flex h-5 w-5 items-center justify-center rounded-full", TONE_GLYPH[view.tone])}>
              <Icon className="h-3 w-3" />
            </span>
            {view.label}
            <span className="tabular-nums text-ink">{view.count}</span>
          </button>
        )
      })}
    </div>
  )
}

// ─── States ─────────────────────────────────────────────────────────────────

export function EmptyState({ title, hint }: { title: string; hint: ReactNode }) {
  return (
    <div className="flex animate-fade-in flex-col items-center px-6 pb-3 pt-10 text-center">
      <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-paper-sunken text-ink-subtle">
        <SearchX className="h-5 w-5" />
      </span>
      <p className="mt-3 max-w-full truncate text-body-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 max-w-xs text-caption font-medium text-ink-muted">{hint}</p>
    </div>
  )
}

const SKELETON_WIDTHS = ["w-3/4", "w-1/2", "w-2/3", "w-2/5"]

/** The shape of "Up next" while the first read is in flight. */
export function SkeletonRows() {
  return (
    <div aria-hidden="true" className="px-1 pt-3">
      <div className="skeleton mx-3 mb-3 h-3 w-16 rounded-sm" />
      {SKELETON_WIDTHS.map((width) => (
        <div key={width} className="flex items-center gap-3 px-3 py-2">
          <div className="skeleton h-8 w-8 flex-shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className={cn("skeleton h-3 rounded-sm", width)} />
            <div className="skeleton h-2.5 w-1/4 rounded-sm" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Footer ─────────────────────────────────────────────────────────────────

export interface FooterProps {
  /** Keys pressed a moment ago: "up", "down", "enter", "mod", "tab", "esc". */
  pressed: readonly string[]
  isApple: boolean
  /** What Enter does to the highlighted row, or null with nothing highlighted. */
  primary: string | null
  /** The highlighted row can open in a new tab. */
  newTab: boolean
  /** The highlighted row can be narrowed into. */
  narrow: boolean
  /** `#` `@` `>` apply — not while the search is already narrowed. */
  filters: boolean
  /** What Escape does next. */
  escape: "clear" | "back" | "close"
}

/**
 * The keys for the row under the highlight, and nothing else: Enter's verb
 * changes with the row ("open", "narrow", "go", "create"), Tab appears only on a
 * row it can narrow into, and Escape says whether it will clear, step back or
 * close. Decorative for assistive tech — the shortcut map says all of it in words.
 */
export function Footer({ pressed, isApple, primary, newTab, narrow, filters, escape }: FooterProps) {
  const down = (key: string) => pressed.includes(key)
  return (
    <div aria-hidden="true" className="hidden h-10 flex-shrink-0 items-center gap-4 border-t border-line bg-paper-sunken px-4 text-caption font-medium text-ink-muted sm:flex">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex gap-1">
          <Key pressed={down("up")}>↑</Key>
          <Key pressed={down("down")}>↓</Key>
        </span>
        move
      </span>
      {primary ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex gap-1">
            <Key pressed={down("enter") && !down("mod")}>↵</Key>
            {narrow ? <Key pressed={down("tab")}>Tab</Key> : null}
          </span>
          {primary}
        </span>
      ) : null}
      {newTab ? (
        <span className="hidden items-center gap-1.5 md:inline-flex">
          <span className="inline-flex gap-1">
            <Key pressed={down("mod")}>{isApple ? "⌘" : "Ctrl"}</Key>
            <Key pressed={down("mod") && down("enter")}>↵</Key>
          </span>
          new tab
        </span>
      ) : null}
      {filters ? (
        <span className="ml-auto hidden items-center gap-1.5 md:inline-flex">
          <span className="inline-flex gap-1">
            <Key>#</Key>
            <Key>@</Key>
            <Key>&gt;</Key>
          </span>
          filter
        </span>
      ) : null}
      <span className={cn("ml-auto inline-flex items-center gap-1.5", filters && "md:ml-0")}>
        <Key pressed={down("esc")}>Esc</Key>
        {escape}
      </span>
    </div>
  )
}
