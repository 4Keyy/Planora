"use client"

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence, useReducedMotion } from "framer-motion"
import { ArrowRight, Check, EyeOff, Folder, ListTodo, Pipette, Plus, RotateCw, Trash2, X } from "lucide-react"
import { motion } from "@/components/ui/motion"
import { Button } from "@/components/ui/button"
import { Overlay } from "@/components/ui/overlay"
import { AutosaveIndicator } from "@/components/ui/autosave-indicator"
import { PriorityMeter } from "@/components/ui/priority-meter"
import { FIELD_LABEL_CLASS } from "@/components/ui/field"
import { ICON_PICKER_ITEMS } from "@/components/ui/icon-picker"
import { ColorPicker } from "@/components/todos/edit-todo-modal/color-picker"
import { CATEGORY_COLOR_SWATCHES } from "@/components/todos/edit-todo-modal/utils"
import { useAutosave } from "@/hooks/use-autosave"
import { api } from "@/lib/api"
import { DURATION_FAST, DURATION_SLOW, DURATION_UI, EASE_OUT_EXPO, SPRING_RESPONSIVE, SPRING_STANDARD, TAP_PRESS } from "@/lib/animations"
import { UI_LOCALE } from "@/lib/datetime"
import { ICON_MAP } from "@/lib/icon-map"
import { isTextEntry } from "@/lib/text-entry"
import { useAuthStore } from "@/store/auth"
import type { Category } from "@/types/category"
import { TodoPriorityOrder, type PagedTodosResponse, type Todo } from "@/types/todo"
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
/** A new category starts on the first swatch: a real colour the API accepts, never a CSS variable. */
const DEFAULT_COLOR = CATEGORY_COLOR_SWATCHES[0]
/** How many open tasks the sheet lists before pointing at the Tasks page for the rest. */
const LIST_LIMIT = 50
const PRINTABLE_KEY = /^\S$/u

const isHex = (value: string | null | undefined): value is string => !!value && /^#[0-9a-f]{6}$/i.test(value)

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
        color: creating ? DEFAULT_COLOR : isHex(category?.color) ? category.color : null,
        icon: creating ? null : category?.icon ?? null,
      }
      setName(next.name)
      setDescription(next.description)
      setColor(next.color)
      setIcon(next.icon)
      setError("")
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
          <ColourField value={color} onChange={setColor} reduce={reduce} />
          <IconField value={icon} onChange={setIcon} accent={accent} reduce={reduce} />
        </div>

        {/* What the existing category holds comes first on a phone, above the pickers. */}
        <div className={cn("min-w-0", !creating && "order-first lg:order-none")}>
          {creating ? (
            <CardPreview name={formData.name} description={formData.description} accent={accent} Icon={Icon} />
          ) : category ? (
            <CategoryTasks categoryId={category.id} open={open} onClose={close} onOpenCount={onOpenCount} reduce={reduce} />
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

/** An icon that swaps with a small spring when the choice changes, instead of blinking. */
function SwapIcon({
  icon: Glyph,
  id,
  reduce,
  className,
  strokeWidth,
  style,
}: {
  icon: typeof Folder
  id: string
  reduce: boolean
  className: string
  strokeWidth?: number
  style?: CSSProperties
}) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      <motion.span
        key={id}
        className="grid place-items-center"
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: -12 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: 12 }}
        transition={reduce ? { duration: 0 } : SPRING_RESPONSIVE}
      >
        <Glyph className={cn("transition-colors duration-slow", className)} strokeWidth={strokeWidth} style={style} />
      </motion.span>
    </AnimatePresence>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-line bg-paper-sunken px-1.5 font-sans text-caption font-semibold text-ink-muted">
      {children}
    </kbd>
  )
}

/* ────────────────────────────────── Colour ───────────────────────────────── */

function ColourField({ value, onChange, reduce }: { value: string | null; onChange: (hex: string) => void; reduce: boolean }) {
  const groupId = useId()
  const preset = CATEGORY_COLOR_SWATCHES.find((c) => c.toLowerCase() === value?.toLowerCase())
  const custom = !!value && !preset
  const [wheel, setWheel] = useState(false)
  const wheelOpen = wheel || custom

  return (
    <fieldset>
      <legend className={FIELD_LABEL_CLASS}>Colour</legend>
      <div role="radiogroup" aria-label="Colour" className="mt-3 grid grid-cols-7 gap-2 sm:gap-1.5">
        {CATEGORY_COLOR_SWATCHES.map((swatch) => {
          const selected = swatch === preset
          return (
            <motion.button
              key={swatch}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`Colour ${swatch}`}
              whileTap={TAP_PRESS}
              onClick={() => {
                onChange(swatch)
                setWheel(false)
              }}
              className="relative grid aspect-square place-items-center rounded-full"
            >
              {selected && (
                <motion.span
                  layoutId={`${groupId}-ring`}
                  aria-hidden="true"
                  className="absolute -inset-0.5 rounded-full border-2 border-ink"
                  transition={reduce ? { duration: 0 } : SPRING_STANDARD}
                />
              )}
              <span aria-hidden="true" className="h-[78%] w-[78%] rounded-full shadow-sm" style={{ backgroundColor: swatch }} />
              {selected && <Check className="absolute h-3.5 w-3.5 text-paper" strokeWidth={3} aria-hidden="true" />}
            </motion.button>
          )
        })}
        <motion.button
          type="button"
          role="radio"
          aria-checked={custom}
          aria-expanded={wheelOpen}
          aria-label="Custom colour"
          whileTap={TAP_PRESS}
          onClick={() => setWheel((w) => !w || custom)}
          className="relative grid aspect-square place-items-center rounded-full"
        >
          {custom && (
            <motion.span
              layoutId={`${groupId}-ring`}
              aria-hidden="true"
              className="absolute -inset-0.5 rounded-full border-2 border-ink"
              transition={reduce ? { duration: 0 } : SPRING_STANDARD}
            />
          )}
          <span
            aria-hidden="true"
            className="grid h-[78%] w-[78%] place-items-center rounded-full shadow-sm"
            // The wheel of the swatches themselves, closed on the first one.
            style={{ background: `conic-gradient(${[...CATEGORY_COLOR_SWATCHES, CATEGORY_COLOR_SWATCHES[0]].join(", ")})` }}
          >
            <span className="grid h-[58%] w-[58%] place-items-center rounded-full bg-paper">
              <Pipette className="h-3 w-3 text-ink-muted" />
            </span>
          </span>
        </motion.button>
      </div>

      {/* The full wheel folds out under the swatches, the New task plate's way: a grid row
          growing from 0fr on the slow curve while its content fades in behind it. */}
      <div
        className="grid"
        style={{
          gridTemplateRows: wheelOpen ? "1fr" : "0fr",
          transition: reduce ? "none" : `grid-template-rows ${DURATION_SLOW}s var(--pl-ease-emphasized)`,
        }}
      >
        <div className="min-h-0 overflow-hidden" inert={!wheelOpen} aria-hidden={!wheelOpen}>
          <div
            className="pt-4"
            style={{ opacity: wheelOpen ? 1 : 0, transition: reduce ? "none" : `opacity ${DURATION_UI}s var(--pl-ease-emphasized)` }}
          >
            <div className="rounded-lg border border-line bg-paper-sunken p-4">
              <ColorPicker value={value ?? DEFAULT_COLOR} onChange={onChange} />
            </div>
          </div>
        </div>
      </div>
    </fieldset>
  )
}

/* ─────────────────────────────────── Icon ────────────────────────────────── */

function IconField({
  value,
  onChange,
  accent,
  reduce,
}: {
  value: string | null
  onChange: (name: string) => void
  accent: string
  reduce: boolean
}) {
  const groupId = useId()
  const current = value ?? "Folder"
  return (
    <fieldset>
      <legend className={FIELD_LABEL_CLASS}>Icon</legend>
      {/* Six across at 44px on a phone; nine across at 36px from `sm`, four rows for all 34,
          each still a 44px target (`touch-target`). */}
      <div role="radiogroup" aria-label="Icon" className="mt-3 grid grid-cols-6 gap-1.5 sm:grid-cols-9 sm:gap-1">
        {ICON_PICKER_ITEMS.map((item) => {
          const Glyph = item.icon
          const selected = current === item.name
          return (
            <motion.button
              key={item.name}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${item.name} icon`}
              whileTap={TAP_PRESS}
              onClick={() => onChange(item.name)}
              className={cn(
                "touch-target relative grid h-11 place-items-center rounded-md transition-colors duration-fast sm:h-9",
                selected ? "text-paper" : "text-ink-muted hover:bg-paper-sunken hover:text-ink",
              )}
            >
              {selected && (
                // The choice is one surface in the category's colour, springing to the new icon.
                <motion.span
                  layoutId={`${groupId}-fill`}
                  aria-hidden="true"
                  className="absolute inset-0 rounded-md shadow-sm"
                  style={{ backgroundColor: accent }}
                  transition={reduce ? { duration: 0 } : SPRING_STANDARD}
                />
              )}
              <Glyph className="relative h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
            </motion.button>
          )
        })}
      </div>
    </fieldset>
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

type TasksState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; open: Todo[]; openTotal: number; doneTotal: number | null }

const DUE = new Intl.DateTimeFormat(UI_LOCALE, { month: "short", day: "numeric" })

function CategoryTasks({
  categoryId,
  open,
  onClose,
  onOpenCount,
  reduce,
}: {
  categoryId: string
  open: boolean
  onClose: () => void
  onOpenCount?: (categoryId: string, openCount: number) => void
  reduce: boolean
}) {
  const router = useRouter()
  const userId = useAuthStore((s) => s.user?.userId)
  const [state, setState] = useState<TasksState>({ phase: "loading" })
  const [attempt, setAttempt] = useState(0)
  const reportCount = useRef(onOpenCount)
  reportCount.current = onOpenCount

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setState({ phase: "loading" })
    const params = { categoryId, pageNumber: 1 }
    Promise.all([
      api.get<PagedTodosResponse>("/todos/api/v1/todos", {
        params: { ...params, pageSize: LIST_LIMIT, isCompleted: false },
        signal: controller.signal,
      }),
      api
        .get<PagedTodosResponse>("/todos/api/v1/todos", {
          params: { ...params, pageSize: 1, isCompleted: true },
          signal: controller.signal,
        })
        .then((res) => res.data.totalCount ?? null)
        // The done count is a footnote: without it the list still stands.
        .catch(() => null),
    ])
      .then(([openRes, doneTotal]) => {
        const items = openRes.data.items ?? []
        const openTotal = typeof openRes.data.totalCount === "number" ? openRes.data.totalCount : items.length
        setState({ phase: "ready", open: items, openTotal, doneTotal })
        reportCount.current?.(categoryId, openTotal)
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ phase: "error" })
      })
    return () => controller.abort()
  }, [categoryId, open, attempt])

  const showInTasks = () => {
    writeFilter(userId, [categoryId])
    onClose()
    router.push("/tasks")
  }

  return (
    <section aria-labelledby={`${categoryId}-tasks`} className="flex h-full flex-col">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={`${categoryId}-tasks`} className={FIELD_LABEL_CLASS}>
          Open tasks
        </h3>
        {state.phase === "ready" && (
          <p className="text-caption font-semibold tabular-nums text-ink-muted">
            {state.openTotal} open
            {state.doneTotal !== null && state.doneTotal > 0 ? ` · ${state.doneTotal} done` : ""}
          </p>
        )}
      </div>

      <div className="mt-3 flex min-h-[12rem] flex-1 flex-col rounded-lg border border-line bg-paper">
        {state.phase === "loading" ? (
          <ul aria-label="Loading tasks" className="divide-y divide-line">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3">
                <span className="h-4 w-4 flex-shrink-0 animate-pulse rounded-full bg-paper-sunken motion-reduce:animate-none" />
                <span className="h-3.5 flex-1 animate-pulse rounded-sm bg-paper-sunken motion-reduce:animate-none" style={{ maxWidth: `${70 - i * 15}%` }} />
              </li>
            ))}
          </ul>
        ) : state.phase === "error" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-body-sm text-ink-muted">Couldn&rsquo;t load the tasks.</p>
            <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
          </div>
        ) : state.open.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-full bg-paper-sunken text-ink-muted">
              <Check className="h-5 w-5" />
            </span>
            <p className="text-body-sm font-semibold text-ink">Nothing open here</p>
            <p className="max-w-[16rem] text-caption text-ink-muted">
              {state.doneTotal ? "Every task in this category is done." : "Put a task in this category from its editor and it shows up here."}
            </p>
          </div>
        ) : (
          <ul className="max-h-[17rem] divide-y divide-line overflow-y-auto">
            {state.open.map((todo, index) => (
              <TaskRow
                key={todo.id}
                todo={todo}
                order={index}
                reduce={reduce}
                onOpen={() => {
                  onClose()
                  router.push(`/branch/${todo.id}`)
                }}
              />
            ))}
            {state.openTotal > state.open.length && (
              <li className="px-4 py-3 text-caption text-ink-muted">
                And {state.openTotal - state.open.length} more in Tasks.
              </li>
            )}
          </ul>
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

function TaskRow({ todo, order, onOpen, reduce }: { todo: Todo; order: number; onOpen: () => void; reduce: boolean }) {
  const due = todo.dueDate ? new Date(todo.dueDate) : null
  const overdue = !!due && !Number.isNaN(due.getTime()) && due.getTime() < Date.now() - 24 * 3600_000
  const level = TodoPriorityOrder[String(todo.priority)] ?? 3
  return (
    // The rows arrive one after another when the list has loaded, the first eight staggered.
    <motion.li
      initial={{ opacity: 0, y: reduce ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: DURATION_UI, ease: EASE_OUT_EXPO, delay: Math.min(order, 8) * 0.035 }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="group flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-fast hover:bg-paper-sunken focus-visible:-outline-offset-2"
      >
        {todo.hidden ? (
          <EyeOff className="h-4 w-4 flex-shrink-0 text-ink-subtle" aria-hidden="true" />
        ) : (
          <span aria-hidden="true" className="h-4 w-4 flex-shrink-0 rounded-full border-2 border-line-strong transition-colors duration-fast group-hover:border-ink" />
        )}
        <span className={cn("min-w-0 flex-1 truncate text-body-sm font-semibold", todo.hidden ? "text-ink-muted" : "text-ink")}>
          {todo.hidden ? "Hidden task" : todo.title}
        </span>
        {due && !Number.isNaN(due.getTime()) && (
          <span className={cn("flex-shrink-0 text-caption font-semibold tabular-nums", overdue ? "text-alert" : "text-ink-muted")}>
            {DUE.format(due)}
          </span>
        )}
        {!todo.hidden && <PriorityMeter value={level} size="sm" className="hidden flex-shrink-0 sm:flex" />}
        <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-ink-subtle opacity-0 transition-opacity duration-fast group-hover:opacity-100" aria-hidden="true" />
      </button>
    </motion.li>
  )
}
