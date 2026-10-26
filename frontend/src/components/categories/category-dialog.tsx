"use client"

import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence, useReducedMotion } from "framer-motion"
import { ArrowRight, Folder, Inbox, ListTodo, Plus, RotateCw, Trash2, X } from "lucide-react"
import { motion } from "@/components/ui/motion"
import { Button } from "@/components/ui/button"
import { Overlay } from "@/components/ui/overlay"
import { AutosaveIndicator } from "@/components/ui/autosave-indicator"
import { FIELD_LABEL_CLASS } from "@/components/ui/field"
import { ColourField, DEFAULT_CATEGORY_COLOR, IconField, SwapIcon, isHexColor } from "@/components/categories/category-look"
import { RowContent } from "@/components/command-palette/rows"
import { byUrgency, toPaletteTask, type PaletteTask } from "@/components/command-palette/search"
import type { PaletteItem } from "@/components/command-palette/sections"
import { SkeletonRows } from "@/components/command-palette/chrome"
import { useAutosave } from "@/hooks/use-autosave"
import { useFriends } from "@/hooks/use-friends"
import { api } from "@/lib/api"
import { DURATION_FAST, DURATION_UI, EASE_OUT_EXPO, SPRING_STANDARD, TAP_PRESS } from "@/lib/animations"
import { ICON_MAP } from "@/lib/icon-map"
import { isTextEntry } from "@/lib/text-entry"
import { useAuthStore } from "@/store/auth"
import type { Category } from "@/types/category"
import type { PagedTodosResponse, Todo } from "@/types/todo"
import { writeFilter } from "@/utils/category-filter"
import { cn } from "@/lib/utils"

/**
 * The two category dialogs on /categories — one for a new category, one for an existing one —
 * drawn as one sheet so they read as a pair, with their purpose said by every part of it.
 *
 * - **The hero takes the category's colour.** A wash of it behind the title, the icon in a
 *   tile of it, and the icon again as a large watermark, all changing on the slow curve as the
 *   colour or the icon is picked — the sheet is a preview of the category before it is one.
 * - **Name first, in the hero.** Naked fields behind the create panel's left rule
 *   (`.field-rule`): the title at title size, the description under it. Nothing is focused
 *   on opening; in the new-category sheet the first key typed goes to the name.
 * - **Look below.** Twelve swatches and a custom colour that folds the full wheel out, and
 *   the icon grid; each selection is one surface that springs to the new choice.
 * - **What sets them apart.** New: a "New category" eyebrow with a plus, a dashed icon tile,
 *   a live preview of the card it will become, and one explicit **Create category** (Enter
 *   in the name does it too). Existing: the category's open tasks, newest first, each opening
 *   its branch; edits save as they are made, with **Show in Tasks** and **Delete** at the foot.
 *
 * The sheet grows out of what opened it — the card, or the New category button — on the
 * task editor's spring (`Overlay animateFromOrigin`); `C` opens it from the centre.
 */

export type CategoryFormData = {
  name: string
  description: string
  /** A `#rrggbb` colour, or null for a category that has none (it then shows the accent). */
  color: string | null
  icon: string | null
}

export interface CategoryDialogProps {
  mode: "create" | "edit"
  open: boolean
  onClose: () => void
  /** Create: the one explicit save. Edit: every autosaved change; reject to show the failure. */
  onSave: (data: CategoryFormData) => Promise<void>
  /** Edit: the category being viewed. */
  category?: Category | null
  /** Edit: opens the page's delete confirmation for this category. */
  onDelete?: () => void
  /** Edit: the open-task count the list just read, so the card behind can match it. */
  onOpenCount?: (categoryId: string, openCount: number) => void
}

const NAME_MAX = 50
const DESCRIPTION_MAX = 500
const DEFAULT_COLOR = DEFAULT_CATEGORY_COLOR
const PRINTABLE_KEY = /^\S$/u

export function CategoryDialog({ mode, open, onClose, onSave, category: given, onDelete, onOpenCount }: CategoryDialogProps) {
  const creating = mode === "create"
  // The page lets go of the category as the sheet starts to close; the sheet keeps showing it
  // until it has folded away, rather than emptying mid-exit.
  const kept = useRef<Category | null>(null)
  if (given) kept.current = given
  const category = given ?? kept.current
  const reduce = useReducedMotion() ?? false
  const headingId = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [color, setColor] = useState<string | null>(DEFAULT_COLOR)
  const [icon, setIcon] = useState<string | null>(null)
  const [creatingNow, setCreatingNow] = useState(false)
  /** Counts openings: the pickers remount with each one, so the colour wheel always starts folded. */
  const [opening, setOpening] = useState(0)
  const [error, setError] = useState("")

  const formData: CategoryFormData = useMemo(
    () => ({ name: name.trim(), description: description.trim(), color, icon }),
    [name, description, color, icon],
  )

  const { status: saveStatus, flush, reset } = useAutosave<CategoryFormData>({
    value: formData,
    enabled: !creating && open,
    onSave,
    // A category's only required field: an empty name is never saved.
    validate: (data) => data.name.length > 0,
  })

  /*
   * Seed the form on the opening edge only. The page re-renders while the sheet is open (the
   * edit sheet's autosave updates the grid behind it), and re-seeding on those renders would
   * throw away what is being typed. Opening again always follows a close, so a different
   * category is still seeded correctly.
   */
  const wasOpen = useRef(false)
  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      const next = {
        name: creating ? "" : category?.name ?? "",
        description: creating ? "" : category?.description ?? "",
        color: creating ? DEFAULT_COLOR : isHexColor(category?.color) ? category.color : null,
        icon: creating ? null : category?.icon ?? null,
      }
      setName(next.name)
      setDescription(next.description)
      setColor(next.color)
      setIcon(next.icon)
      setError("")
      setOpening((n) => n + 1)
      reset({ ...next, name: next.name.trim(), description: next.description.trim() })
    }
    wasOpen.current = open
  }, [open, creating, category, reset])

  /** Flush the last edit before closing: closing inside the debounce must not lose it. */
  const close = useCallback(() => {
    if (!creating) void flush()
    onClose()
  }, [creating, flush, onClose])

  const create = useCallback(async () => {
    if (!formData.name) {
      setError("Give the category a name first.")
      nameRef.current?.focus()
      return
    }
    setCreatingNow(true)
    try {
      await onSave(formData)
      onClose()
    } catch {
      setError("Couldn't create the category. Try again.")
    } finally {
      setCreatingNow(false)
    }
  }, [formData, onClose, onSave])

  /*
   * Type-to-focus, as in the New task panel: while the new-category sheet is open and nothing
   * that takes text has focus, the first printable key moves focus into the name and the
   * browser types that very character there. Not in the edit sheet — there the name already
   * holds text, and a stray key would land at its end.
   */
  useEffect(() => {
    if (!open || !creating) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !PRINTABLE_KEY.test(event.key)) return
      if ((event.ctrlKey || event.metaKey || event.altKey) && !event.getModifierState("AltGraph")) return
      if (isTextEntry(document.activeElement)) return
      nameRef.current?.focus({ preventScroll: true })
      event.stopPropagation()
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [open, creating])

  const accent = color ?? "var(--pl-accent)"
  const tint = (percent: number) => `color-mix(in srgb, ${accent} ${percent}%, var(--pl-paper))`
  const Icon = (icon && ICON_MAP[icon]) || Folder
  const hint = !creating && !formData.name ? "Enter a name to save your changes." : ""

  return (
    <Overlay
      open={open}
      onClose={close}
      hideHeader
      labelledBy={headingId}
      className="max-w-[54rem]"
      animateFromOrigin
    >
      {/* ── The hero, in the category's colour ─────────────────────────────── */}
      <div
        className="relative isolate overflow-hidden border-b border-line px-6 pb-7 pt-5 transition-[background-color] duration-slow ease-emphasized sm:px-8"
        style={{ backgroundColor: tint(9) }}
      >
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-10 -right-8 -z-10 opacity-[0.07]">
          <SwapIcon icon={Icon} id={icon ?? "Folder"} reduce={reduce} className="h-48 w-48" strokeWidth={1} style={{ color: accent }} />
        </div>

        <div className="flex items-center justify-between gap-4">
          {creating ? (
            <p className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-ink/25 bg-paper/70 px-2.5 py-1 text-caption font-semibold text-ink">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              New category
            </p>
          ) : (
            <p className="inline-flex items-center gap-1.5 rounded-full bg-paper/70 px-2.5 py-1 text-caption font-semibold text-ink-muted">
              <Folder className="h-3.5 w-3.5" aria-hidden="true" />
              Category
            </p>
          )}
          <motion.button
            type="button"
            whileTap={TAP_PRESS}
            onClick={close}
            aria-label="Close"
            className="-mr-2 grid h-11 w-11 flex-shrink-0 place-items-center rounded-full text-ink-muted transition-colors duration-fast hover:bg-ink/5 hover:text-ink"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </motion.button>
        </div>

        <div className="mt-4 flex items-start gap-4 sm:gap-5">
          <span
            aria-hidden="true"
            className={cn(
              "grid h-14 w-14 flex-shrink-0 place-items-center rounded-lg transition-[background-color,border-color] duration-slow ease-emphasized sm:h-16 sm:w-16",
              creating ? "border-2 border-dashed" : "border border-transparent shadow-sm",
            )}
            style={{
              backgroundColor: creating ? tint(14) : tint(20),
              borderColor: creating ? `color-mix(in srgb, ${accent} 45%, transparent)` : undefined,
            }}
          >
            <SwapIcon icon={Icon} id={icon ?? "Folder"} reduce={reduce} className="h-7 w-7" style={{ color: accent }} />
          </span>

          <div className="field-rule min-w-0 flex-1 pl-4 sm:pl-5">
            <h2 id={headingId} className="sr-only">
              {creating ? "New category" : `Category ${category?.name ?? ""}`}
            </h2>
            <label htmlFor={`${headingId}-name`} className="sr-only">
              Name
            </label>
            <input
              ref={nameRef}
              id={`${headingId}-name`}
              value={name}
              maxLength={NAME_MAX}
              autoComplete="off"
              placeholder={creating ? "Name your category" : "Category name"}
              onChange={(event) => {
                setName(event.target.value)
                if (error) setError("")
              }}
              onKeyDown={(event) => {
                if (creating && event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void create()
                }
              }}
              aria-invalid={error ? true : undefined}
              className="field-naked w-full border-none bg-transparent p-0 text-title font-bold tracking-tight text-ink placeholder:text-ink-subtle sm:text-display-sm sm:leading-tight"
            />
            <label htmlFor={`${headingId}-description`} className="sr-only">
              Description
            </label>
            <input
              id={`${headingId}-description`}
              value={description}
              maxLength={DESCRIPTION_MAX}
              autoComplete="off"
              placeholder="Description (optional)"
              onChange={(event) => setDescription(event.target.value)}
              className="field-naked mt-1.5 w-full border-none bg-transparent p-0 text-body text-ink-muted placeholder:text-ink-subtle"
            />
          </div>
        </div>

        <div className="mt-4 min-h-6 pl-[4.5rem] sm:pl-[5.25rem]">
          <AnimatePresence initial={false} mode="wait">
            {error || hint ? (
              <motion.p
                key={error || hint}
                role="alert"
                initial={{ opacity: 0, y: reduce ? 0 : 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: DURATION_FAST } }}
                transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO }}
                className="text-body-sm font-semibold text-alert"
              >
                {error || hint}
              </motion.p>
            ) : (
              <motion.p key="tip" initial={false} className="text-caption text-ink-muted">
                {creating
                  ? "Pick a colour and an icon — the preview follows along."
                  : "Click the name or the description to change them."}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Look, and what the category holds ──────────────────────────────── */}
      <div className="grid grid-cols-1 gap-8 px-6 py-7 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
        <div className="min-w-0 space-y-7">
          <ColourField key={opening} value={color} onChange={setColor} reduce={reduce} />
          <IconField value={icon} onChange={setIcon} accent={accent} reduce={reduce} />
        </div>

        {/* What the existing category holds comes first on a phone, above the pickers. */}
        <div className={cn("min-w-0", !creating && "order-first lg:order-none")}>
          {creating ? (
            <CardPreview name={formData.name} description={formData.description} accent={accent} Icon={Icon} />
          ) : category ? (
            <CategoryTasks
              category={category}
              look={{ color, icon }}
              open={open}
              onClose={close}
              onOpenCount={onOpenCount}
              reduce={reduce}
            />
          ) : null}
        </div>
      </div>

      {/* ── The foot ───────────────────────────────────────────────────────── */}
      {/* Pinned to the bottom of the sheet while it scrolls: the actions never go below the fold. */}
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-line bg-paper/95 px-6 py-4 backdrop-blur-sm sm:px-8">
        {creating ? (
          <>
            <p className="hidden items-center gap-2 text-caption text-ink-muted sm:flex">
              <Kbd>Enter</Kbd> in the name creates it
            </p>
            <div className="flex-1" />
            <Button size="lg" className="w-full sm:w-auto" onClick={() => void create()} loading={creatingNow} disabled={!formData.name}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create category
            </Button>
          </>
        ) : (
          <>
            {onDelete && (
              <Button variant="ghost" size="sm" onClick={onDelete} className="-ml-3 text-ink-muted hover:bg-alert-surface hover:text-alert">
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Delete
              </Button>
            )}
            <div className="flex-1" />
            <AutosaveIndicator status={saveStatus} />
            <Button variant="outline" onClick={close}>
              Done
            </Button>
          </>
        )}
      </div>
    </Overlay>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-line bg-paper-sunken px-1.5 font-sans text-caption font-semibold text-ink-muted">
      {children}
    </kbd>
  )
}

/* ───────────────────────────── New: the card it becomes ──────────────────── */

function CardPreview({
  name,
  description,
  accent,
  Icon,
}: {
  name: string
  description: string
  accent: string
  Icon: typeof Folder
}) {
  return (
    <div>
      <p className={FIELD_LABEL_CLASS}>On your categories page</p>
      {/* The category card's own surface and layout, drawn still: a picture, not a control. */}
      <div
        aria-hidden="true"
        className="relative mt-3 overflow-hidden rounded-lg border border-line bg-paper shadow-sm transition-shadow duration-slow"
        style={{ boxShadow: `0 8px 32px -4px color-mix(in srgb, ${accent} 20%, transparent), 0 4px 16px -2px color-mix(in srgb, ${accent} 20%, transparent)` }}
      >
        <div className="pointer-events-none absolute -bottom-6 -right-6 opacity-10">
          <Icon className="h-28 w-28 text-ink" strokeWidth={1} />
        </div>
        <div className="relative flex items-start gap-4 p-5">
          <span
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md transition-[background-color] duration-slow"
            style={{ backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)` }}
          >
            <Icon className="h-5 w-5 transition-colors duration-slow" style={{ color: accent }} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={cn("block truncate text-body font-semibold tracking-tight", name ? "text-ink" : "text-ink-subtle")}>
              {name || "Name your category"}
            </span>
            {description && <span className="mt-0.5 line-clamp-1 text-body-sm text-ink-muted">{description}</span>}
            <span className="mt-3 flex">
              <span className="inline-flex h-6 items-center gap-1 rounded-sm border border-line bg-paper-sunken px-2 text-caption font-semibold text-ink-muted">
                <ListTodo className="h-3 w-3" />
                No tasks
              </span>
            </span>
          </span>
        </div>
      </div>
      <p className="mt-4 text-caption text-ink-muted">
        Tasks join a category from the task editor or the New task panel, and its card counts the open ones.
      </p>
    </div>
  )
}

/* ─────────────────────────── Existing: what it holds ─────────────────────── */

/** The palette's own reads for a scope: every open task, and the latest finished ones. */
const OPEN_LIMIT = 50
const DONE_LIMIT = 30

type TasksState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; open: Todo[]; done: Todo[]; openTotal: number; doneTotal: number }

const byCompletion = (a: PaletteTask, b: PaletteTask) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")

const personName = (friend: { firstName?: string | null; lastName?: string | null; email?: string | null }) =>
  [friend.firstName, friend.lastName].filter(Boolean).join(" ").trim() || friend.email || ""

/**
 * The category's tasks, drawn exactly as the search draws a category's scope (Ctrl K, Tab on a
 * category): "Open" by deadline, then "Done" newest first, in the palette's own rows —
 * `RowContent` with its category squircle, title, second line, deadline chip and the
 * one-drop highlight that glides between rows and glows in the category's colour. The reads
 * are the palette's too (`revealHidden=true`): a hidden task arrives whole and is blurred by
 * the palette's veil until it is reached for — pointed at, or moved to with Tab or the arrows.
 */
function CategoryTasks({
  category,
  look,
  open,
  onClose,
  onOpenCount,
  reduce,
}: {
  category: Category
  /** The colour and icon as they stand in the sheet now, so the rows follow every pick live. */
  look: { color: string | null; icon: string | null }
  open: boolean
  onClose: () => void
  onOpenCount?: (categoryId: string, openCount: number) => void
  reduce: boolean
}) {
  const router = useRouter()
  const viewerId = useAuthStore((s) => s.user?.userId) ?? null
  const friends = useFriends(open)
  const listId = useId()
  const [state, setState] = useState<TasksState>({ phase: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [active, setActive] = useState<string | null>(null)
  const [reached, setReached] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const reportCount = useRef(onOpenCount)
  reportCount.current = onOpenCount

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setState({ phase: "loading" })
    setActive(null)
    setReached(null)
    const read = (isCompleted: boolean, pageSize: number) =>
      api.get<PagedTodosResponse>("/todos/api/v1/todos", {
        params: { categoryId: category.id, pageNumber: 1, pageSize, isCompleted, revealHidden: true },
        signal: controller.signal,
      })
    Promise.all([
      read(false, OPEN_LIMIT),
      // The finished ones are the second section: without them the open list still stands.
      read(true, DONE_LIMIT).catch(() => null),
    ])
      .then(([openRes, doneRes]) => {
        const openItems = openRes.data.items ?? []
        const doneItems = doneRes?.data.items ?? []
        const openTotal = typeof openRes.data.totalCount === "number" ? openRes.data.totalCount : openItems.length
        const doneTotal = typeof doneRes?.data.totalCount === "number" ? doneRes.data.totalCount : doneItems.length
        setState({ phase: "ready", open: openItems, done: doneItems, openTotal, doneTotal })
        reportCount.current?.(category.id, openTotal)
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ phase: "error" })
      })
    return () => controller.abort()
  }, [category.id, open, attempt])

  /** Display names by user id: friends, plus the API's own author names — the palette's map. */
  const names = useMemo(() => {
    const map = new Map<string, string>()
    for (const friend of friends) {
      const name = personName(friend)
      if (name) map.set(friend.id, name)
    }
    if (state.phase === "ready") {
      for (const todo of [...state.open, ...state.done]) {
        if (todo.authorName && !map.has(todo.userId)) map.set(todo.userId, todo.authorName)
      }
    }
    return map
  }, [friends, state])

  const sections = useMemo(() => {
    if (state.phase !== "ready") return []
    // Every row is in this category, so every squircle shows the category as the sheet shows it
    // — the colour and icon being picked, not the ones the list was read with.
    const fill = (todo: Todo) =>
      toPaletteTask(
        {
          ...todo,
          categoryName: category.name,
          categoryColor: look.color ?? "var(--pl-accent)",
          categoryIcon: look.icon ?? "Folder",
        },
        viewerId,
        names,
      )
    const openTasks = state.open.map(fill).filter((t) => !t.completed).sort(byUrgency)
    const doneTasks = state.done.map(fill).sort(byCompletion)
    return [
      ...(openTasks.length ? [{ id: "open", title: "Open", tasks: openTasks }] : []),
      ...(doneTasks.length ? [{ id: "done", title: "Done", tasks: doneTasks }] : []),
    ]
  }, [state, category.name, look.color, look.icon, viewerId, names])

  // One clock per read, so every deadline chip in the list says the same "today".
  const readAt = state.phase === "ready" ? state : null
  const now = useMemo(() => (readAt ? new Date() : new Date(0)), [readAt])

  const point = useCallback((key: string) => {
    setActive(key)
    setReached(key)
  }, [])

  const openTask = useCallback(
    (taskId: string) => {
      onClose()
      router.push(`/branch/${taskId}`)
    },
    [onClose, router],
  )

  /** Up and down move between rows, as they do in the search. */
  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])
    if (rows.length === 0) return
    event.preventDefault()
    const at = rows.indexOf(document.activeElement as HTMLElement)
    const next = event.key === "ArrowDown" ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1)
    rows[at === -1 ? 0 : next]?.focus()
  }

  const showInTasks = () => {
    writeFilter(viewerId, [category.id])
    onClose()
    router.push("/tasks")
  }

  return (
    <section aria-labelledby={`${listId}-title`} className="flex h-full flex-col">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={`${listId}-title`} className={FIELD_LABEL_CLASS}>
          Tasks
        </h3>
        {state.phase === "ready" && (
          <p className="text-caption font-semibold tabular-nums text-ink-muted">
            {state.openTotal} open
            {state.doneTotal > 0 ? ` · ${state.doneTotal} done` : ""}
          </p>
        )}
      </div>

      <div className="mt-3 flex min-h-[15rem] flex-1 flex-col overflow-hidden rounded-xl border border-line bg-paper shadow-sm">
        {state.phase === "loading" ? (
          <SkeletonRows />
        ) : state.phase === "error" ? (
          <ListNote icon={RotateCw} title="Couldn’t load the tasks." hint="The category is fine; only its list did not arrive.">
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setAttempt((n) => n + 1)}>
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
          </ListNote>
        ) : sections.length === 0 ? (
          <ListNote
            icon={Inbox}
            title="Nothing in this category yet"
            hint="Put a task in it from the task's editor or the New task panel, and it shows up here."
          />
        ) : (
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- keys bubble up from the focusable rows inside, which the arrows move between; the list itself never takes focus
          <div
            ref={listRef}
            role="list"
            aria-label={`Tasks in ${category.name}`}
            onKeyDown={onListKeyDown}
            onPointerLeave={() => setActive(null)}
            className="max-h-[19rem] flex-1 overflow-y-auto overscroll-contain px-1.5 pb-1.5"
          >
            {sections.map((section) => (
              <div key={section.id} role="presentation">
                <div
                  aria-hidden="true"
                  className={cn(FIELD_LABEL_CLASS, "sticky top-0 z-[1] flex items-center justify-between bg-paper px-3 pb-1.5 pt-3 text-ink-subtle")}
                >
                  <span>{section.title}</span>
                  {section.id === "done" && state.phase === "ready" && state.doneTotal > section.tasks.length ? (
                    <span className="normal-case tracking-normal text-ink-muted">Latest {section.tasks.length}</span>
                  ) : null}
                </div>
                {section.tasks.map((task) => {
                  const key = `task:${task.id}`
                  return (
                    <TaskOption
                      key={key}
                      itemKey={key}
                      task={task}
                      layoutId={`${listId}-active`}
                      active={active === key}
                      revealed={active === key && reached === key}
                      now={now}
                      names={names}
                      reduce={reduce}
                      onPoint={point}
                      onOpen={openTask}
                    />
                  )
                })}
              </div>
            ))}
            {state.phase === "ready" && state.openTotal > state.open.length && (
              <p className="px-3 pb-1 pt-2 text-caption text-ink-muted">And {state.openTotal - state.open.length} more open in Tasks.</p>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 flex justify-end">
        <Button variant="ghost" size="sm" onClick={showInTasks} className="-mr-3">
          Show in Tasks
          <ArrowRight className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5" aria-hidden="true" />
        </Button>
      </div>
    </section>
  )
}

/** The list's empty and error states, in the palette's own empty-state shape. */
function ListNote({ icon: Icon, title, hint, children }: { icon: typeof Inbox; title: string; hint: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 animate-fade-in flex-col items-center justify-center px-6 py-8 text-center">
      <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-paper-sunken text-ink-subtle">
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-3 text-body-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 max-w-xs text-caption font-medium text-ink-muted">{hint}</p>
      {children}
    </div>
  )
}

/**
 * One task row: the palette's `Option`, as a button. The highlight is one drop shared between
 * rows (`layoutId`) that slides to the row under the pointer or the focus, glowing in the task's
 * category colour the way a task card does; a veiled row does not glow, the colour being the
 * task's. Rows follow the pointer on `pointermove`, so a list scrolling under a resting pointer
 * does not steal the highlight.
 */
const TaskOption = memo(function TaskOption({
  itemKey,
  task,
  layoutId,
  active,
  revealed,
  now,
  names,
  reduce,
  onPoint,
  onOpen,
}: {
  itemKey: string
  task: PaletteTask
  layoutId: string
  active: boolean
  revealed: boolean
  now: Date
  names: Map<string, string>
  reduce: boolean
  onPoint: (key: string) => void
  onOpen: (taskId: string) => void
}) {
  const item: PaletteItem = useMemo(
    () => ({ key: itemKey, kind: "task", label: task.title, task, action: { type: "open-task", taskId: task.id } }),
    [itemKey, task],
  )
  const veiled = task.hidden
  const color = !task.completed && (!veiled || revealed) ? task.categoryColor : null
  const glow = color ? ({ "--row-glow": `color-mix(in srgb, ${color} 34%, transparent)` } as CSSProperties) : undefined

  return (
    <div role="listitem">
      <button
        type="button"
        data-row=""
        onPointerMove={() => {
          if (!active || (veiled && !revealed)) onPoint(itemKey)
        }}
        onFocus={() => onPoint(itemKey)}
        onClick={() => onOpen(task.id)}
        className="relative flex min-h-12 w-full cursor-pointer select-none items-center gap-3 rounded-md px-3 py-2 text-left focus-visible:-outline-offset-2"
      >
        <RowContent
          item={item}
          active={active}
          revealed={revealed}
          now={now}
          names={names}
          hideCategory
          highlight={
            active ? (
              <motion.span
                layoutId={layoutId}
                aria-hidden="true"
                style={glow}
                transition={reduce ? { duration: 0 } : SPRING_STANDARD}
                className="absolute inset-0 rounded-md bg-ink/5 shadow-[0_8px_20px_-10px_var(--row-glow,transparent)]"
              />
            ) : null
          }
        />
      </button>
    </div>
  )
})
