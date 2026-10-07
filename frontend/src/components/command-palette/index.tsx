"use client"

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react"
import { usePathname, useRouter } from "next/navigation"
import { LayoutGroup, useAnimationControls, useReducedMotion } from "framer-motion"
import { CloudOff, Search, X } from "lucide-react"
import { motion } from "@/components/ui/motion"
import { ModalPortal } from "@/components/ui/modal-portal"
import { FIELD_LABEL_CLASS } from "@/components/ui/field-label"
import { Kbd, OPEN_SHORTCUTS_EVENT, useIsApplePlatform } from "@/components/ui/shortcuts-overlay"
import { requestCapture } from "@/components/todos/quick-capture"
import { useExitPresence } from "@/hooks/use-exit-presence"
import { useFocusTrap } from "@/hooks/use-focus-trap"
import { useFriends } from "@/hooks/use-friends"
import { useScrollLock } from "@/hooks/use-scroll-lock"
import { api, parseApiResponse, type ApiResponse } from "@/lib/api"
import { DURATION_FAST, DURATION_UI, EASE_STANDARD, SPRING_LAYOUT, SPRING_STANDARD } from "@/lib/animations"
import { originTransform, type OriginRect, type OriginTransform } from "@/lib/shared-origin"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/store/auth"
import type { FriendDto } from "@/types/auth"
import { toCategoryList, type Category, type CategoryListResponse } from "@/types/category"
import type { PagedTodosResponse, Todo } from "@/types/todo"
import { EmptyState, Footer, RollingHint, ScopeBar, ScopeChip, SkeletonRows, TabBar, ViewChips } from "./chrome"
import { Preview } from "./preview"
import { readRecent, rememberRecent, type RecentEntry } from "./recent"
import { RowContent } from "./rows"
import { parseQuery, toPaletteTask, type SmartView } from "./search"
import {
  buildSections,
  countMatches,
  countViews,
  flatten,
  inScope,
  SECTION_TAB,
  type PaletteCategory,
  type PaletteItem,
  type PalettePerson,
  type Scope,
  type Tab,
} from "./sections"

/**
 * Command palette — ⌘K on a Mac, Ctrl+K everywhere else, or the search button in
 * the app bar, out of which it grows.
 *
 * One field that reaches everything the product holds: tasks (open and recently
 * done), categories, friends, the smart views ("Overdue", "Due today"), every
 * screen and the two global actions. What it is built around:
 *
 * - **Nothing typed is still an answer.** The empty palette shows where you were
 *   (Recent), what is next (Up next, by deadline) and a row of view chips that
 *   doubles as a status line — "Overdue 3" before a single key is pressed.
 * - **Typing ranks across kinds.** Fuzzy, accent-insensitive matching marks the
 *   letters it matched; the group holding the best match comes first, every tab
 *   says how many results it holds, and `#` `@` `>` limit the search to categories,
 *   people or shortcuts. The hint in the empty field rolls through exactly those.
 * - **Narrowing, not navigating.** Tab (or Enter) on a category, a person or a
 *   view narrows the search to it, shown as a chip in the field; Backspace in the
 *   empty field widens it again, and Escape steps back one level at a time.
 * - **Nothing is a dead end.** A query that matches nothing offers to become a
 *   task — quick capture opens with the text already typed.
 * - **The highlighted row explains itself.** On a desktop the column beside the
 *   results shows the task — deadline, priority, people, steps — glowing in its
 *   category's colour, so the right one of three similar titles is picked first time.
 *
 * Accessibility follows the ARIA combobox-with-listbox pattern: the input keeps
 * focus and owns `aria-activedescendant`, so the arrows move the highlight while a
 * screen reader announces the row without focus ever leaving the field; groups are
 * labelled, the result count is announced politely, and every key is in the `?` map.
 */

/** Opens the palette from a control — the search button in the app bar. */
export const OPEN_PALETTE_EVENT = "planora:open-palette"

export interface PaletteRequest {
  /** Where the control that asked sits: the palette grows out of it and folds back into it. */
  origin?: OriginRect
}

/** Opens the palette, growing it out of `from` when one is given. */
export function requestPalette(from?: HTMLElement | null): void {
  const rect = from?.getBoundingClientRect()
  const origin = rect && rect.width > 0 && rect.height > 0
    ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
    : undefined
  window.dispatchEvent(new CustomEvent<PaletteRequest>(OPEN_PALETTE_EVENT, { detail: { origin } }))
}

// ─── Data ───────────────────────────────────────────────────────────────────

const TODOS_URL = "/todos/api/v1/todos"
const CATEGORIES_URL = "/categories/api/v1/categories"

/** The screens that mount quick capture; anywhere else the palette goes to Tasks first. */
const CAPTURE_ROUTES = new Set(["/dashboard", "/tasks"])

/** Rows PageUp and PageDown jump. */
const PAGE = 5

interface Snapshot {
  todos: Todo[]
  categories: Category[]
  /** The open tasks could not be read. The palette still navigates and runs its shortcuts. */
  tasksFailed: boolean
}


type QuietConfig = NonNullable<Parameters<typeof api.get>[1]> & { suppressErrorLog?: boolean }
const quiet = (params?: Record<string, unknown>) => ({ params, suppressErrorLog: true }) as QuietConfig

/**
 * Three reads, settled independently: a palette whose category read failed still
 * searches tasks, and one that cannot reach the tasks at all is still a palette
 * of screens and shortcuts. One page of each is plenty — a task that is not among
 * the hundred most recent open ones wants the task list, not a longer dropdown.
 *
 * `revealHidden`: the lists send a hidden task redacted ("Hidden task", nothing else)
 * so that a list never holds what its owner hid. The palette is the one place a hidden
 * task can be looked for by name (owner's ruling, 2026-10-07; ADR 0004), so it asks
 * for the real rows — and keeps every one of them blurred until it is pointed at.
 * A server without the flag ignores it and the rows simply stay redacted.
 */
async function readSnapshot(): Promise<Snapshot> {
  const [open, done, categories] = await Promise.allSettled([
    api.get<PagedTodosResponse>(TODOS_URL, quiet({ pageNumber: 1, pageSize: 100, isCompleted: false, revealHidden: true })),
    api.get<PagedTodosResponse>(TODOS_URL, quiet({ pageNumber: 1, pageSize: 30, isCompleted: true, revealHidden: true })),
    api.get<ApiResponse<CategoryListResponse>>(CATEGORIES_URL, quiet()),
  ])

  // Deduplicated by id, open first: a task shared with the viewer can arrive both as
  // their own row and as the owner's, and two identical rows make a search untrustworthy.
  const todos: Todo[] = []
  const seen = new Set<string>()
  for (const result of [open, done]) {
    if (result.status !== "fulfilled") continue
    for (const todo of result.value.data?.items ?? []) {
      if (!todo?.id || typeof todo.title !== "string" || seen.has(todo.id)) continue
      seen.add(todo.id)
      todos.push(todo)
    }
  }

  const list = categories.status === "fulfilled"
    ? toCategoryList(parseApiResponse<CategoryListResponse>(categories.value.data))
    : []
  return {
    todos,
    categories: list.filter((c) => Boolean(c?.id) && typeof c.name === "string" && c.name.trim() !== ""),
    tasksFailed: open.status === "rejected",
  }
}

function personName(friend: FriendDto): string {
  return [friend.firstName, friend.lastName].filter(Boolean).join(" ").trim() || friend.email || ""
}

/**
 * K for the palette — also on a Cyrillic or Greek layout, where the same key
 * types "л" or "κ". A Latin layout that puts another letter there (Dvorak) keeps
 * that letter's meaning: `code` only decides when `key` is not a Latin letter.
 */
function isPaletteKey(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase()
  return key === "k" || (!/^[a-z]$/.test(key) && event.code === "KeyK")
}

/** What Enter does to the highlighted row, in the footer's one word. */
type FooterVerb = "open" | "go" | "narrow" | "create" | "capture" | "show"

/** The highlighted row, and the key of the row the user reached for, if they did. */
interface Highlighted {
  index: number
  reached: string | null
}

const TOP: Highlighted = { index: 0, reached: null }

// ─── A row ──────────────────────────────────────────────────────────────────

interface OptionProps {
  item: PaletteItem
  index: number
  id: string
  active: boolean
  /** A hidden task's row was reached for, so it shows itself. */
  revealed: boolean
  now: Date
  names: Map<string, string>
  hideCategory: boolean
  onPoint: (index: number, key: string) => void
  onRun: (item: PaletteItem, options?: { newTab?: boolean }) => void
}

/** Clicking a row must not take focus out of the field. */
const keepFocus = (event: ReactMouseEvent) => event.preventDefault()

/**
 * One result. The highlight is a single drop shared between rows (`layoutId`), so
 * moving the selection slides it rather than switching it — the same liquid the
 * app bar's tabs are made of. On a task it glows in the task's category colour,
 * the way a task card does under the pointer. Rows follow the pointer on
 * `pointermove`, not `pointerenter`: a list scrolled by the keyboard slides rows
 * under a resting pointer, and those must not steal the highlight.
 *
 * A hidden task's row is blurred until it is reached for. The first row of a fresh
 * list is highlighted without anyone choosing it, so pointing at that row has to
 * count too: the move reveals it even though the highlight is already there.
 */
const Option = memo(function Option({ item, index, id, active, revealed, now, names, hideCategory, onPoint, onRun }: OptionProps) {
  const reduce = useReducedMotion() ?? false
  const veiled = Boolean(item.task?.hidden)
  // A veiled row does not glow in its category's colour either: the colour is the task's.
  const color = item.task && !item.task.completed && (!veiled || revealed) ? item.task.categoryColor : null
  const glow = color ? ({ "--row-glow": `color-mix(in srgb, ${color} 34%, transparent)` } as CSSProperties) : undefined
  const opensElsewhere = item.action.type === "open-task" || item.action.type === "navigate"

  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      data-index={index}
      onPointerMove={() => {
        if (!active || (veiled && !revealed)) onPoint(index, item.key)
      }}
      onMouseDown={keepFocus}
      onClick={(event) => onRun(item, { newTab: event.metaKey || event.ctrlKey })}
      onAuxClick={(event) => {
        if (event.button !== 1 || !opensElsewhere) return
        event.preventDefault()
        onRun(item, { newTab: true })
      }}
      className="relative flex min-h-12 scroll-mt-10 cursor-pointer select-none items-center gap-3 rounded-md px-3 py-2"
    >
      <RowContent
        item={item}
        active={active}
        revealed={revealed}
        now={now}
        names={names}
        hideCategory={hideCategory}
        highlight={active ? (
          <motion.span
            layoutId="palette-active"
            aria-hidden="true"
            style={glow}
            transition={reduce ? { duration: 0 } : SPRING_STANDARD}
            className="absolute inset-0 rounded-md bg-ink/5 shadow-[0_8px_20px_-10px_var(--row-glow,transparent)]"
          />
        ) : null}
      />
    </div>
  )
})

// ─── The palette ────────────────────────────────────────────────────────────

export function CommandPalette() {
  const router = useRouter()
  const pathname = usePathname()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const viewerId = useAuthStore((s) => s.user?.userId ?? null)
  const reduce = useReducedMotion() ?? false

  /*
   * Resolved after mount, never during render, and shared with the `?` map so the
   * two cannot print different spellings of the same key. A render-time read of
   * `navigator.platform` once made the server print "Ctrl" and a Mac print "⌘",
   * and React threw away the whole server pass over the mismatch on every page.
   */
  const isApple = useIsApplePlatform()

  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const listboxId = `palette-${uid}-results`
  const optionId = useCallback((key: string) => `cmd-${uid}-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`, [uid])

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [tab, setTab] = useState<Tab>("all")
  const [scope, setScope] = useState<Scope | null>(null)
  /*
   * The highlighted row, and the row the user reached for — by pointing at it or by moving
   * to it with the keys. Only a hidden task cares about the second: its row stays blurred
   * until it is reached for. One state, so every reset of the highlight (a new query, tab
   * or scope) also veils again whatever was revealed: a reveal answers one gesture.
   */
  const [highlight, setHighlight] = useState<Highlighted>(TOP)
  const active = highlight.index
  const [recent, setRecent] = useState<RecentEntry[]>([])
  const [now, setNow] = useState(() => new Date())
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [reload, setReload] = useState(0)
  const [pressed, setPressed] = useState<readonly string[]>([])

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const originRef = useRef<OriginRect | null>(null)
  const openRef = useRef(open)
  openRef.current = open
  const keyboardMove = useRef(false)
  const pressTimer = useRef<number | undefined>(undefined)

  useScrollLock(open)
  const trapRef = useFocusTrap<HTMLDivElement>(open)
  const { mounted, finishExit, presenceProps } = useExitPresence(open, DURATION_UI * 1000)

  // ── open / close ──────────────────────────────────────────────────────────

  /**
   * Every opening starts clean: a palette that remembers the last query makes the
   * user delete their previous search before they can start the next one. The
   * task read must be fresh too: its hidden preference may have changed elsewhere.
   */
  const show = useCallback((origin: OriginRect | null) => {
    originRef.current = origin
    setQuery("")
    setTab("all")
    setScope(null)
    setHighlight(TOP)
    setNow(new Date())
    setRecent(readRecent(viewerId))
    setSnapshot(null)
    setOpen(true)
  }, [viewerId])

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!isAuthenticated) {
      setOpen(false)
      return
    }
    // Capture phase, so the chord works from inside any field that keeps its keys.
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || !isPaletteKey(event)) return
      event.preventDefault()
      if (openRef.current) setOpen(false)
      else show(null)
    }
    const onRequest = (event: Event) => {
      if (openRef.current) return
      show((event as CustomEvent<PaletteRequest | null>).detail?.origin ?? null)
    }
    window.addEventListener("keydown", onKey, true)
    window.addEventListener(OPEN_PALETTE_EVENT, onRequest)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      window.removeEventListener(OPEN_PALETTE_EVENT, onRequest)
    }
  }, [isAuthenticated, show])

  // ── data ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void readSnapshot().then((fresh) => {
      if (cancelled) return
      setSnapshot(fresh)
    })
    return () => {
      cancelled = true
    }
  }, [open, viewerId, reload])

  const friends = useFriends(open)

  /** Display names by user id: friends, plus the API's own author names. */
  const names = useMemo(() => {
    const map = new Map<string, string>()
    for (const friend of friends) {
      const name = personName(friend)
      if (name) map.set(friend.id, name)
    }
    for (const todo of snapshot?.todos ?? []) {
      if (todo.authorName && !map.has(todo.userId)) map.set(todo.userId, todo.authorName)
    }
    return map
  }, [friends, snapshot])

  const tasks = useMemo(() => {
    // A task that carries only its category's id borrows the colour, icon and name
    // from the category list, so its glyph and glow still say which one it is.
    const byId = new Map((snapshot?.categories ?? []).map((c) => [c.id, c]))
    return (snapshot?.todos ?? []).map((todo) => {
      const category = todo.categoryId ? byId.get(todo.categoryId) : undefined
      const filled = category
        ? {
            ...todo,
            categoryName: todo.categoryName ?? category.name,
            categoryColor: todo.categoryColor ?? category.color ?? null,
            categoryIcon: todo.categoryIcon ?? category.icon ?? null,
          }
        : todo
      return toPaletteTask(filled, viewerId, names)
    })
  }, [snapshot, viewerId, names])

  const categories = useMemo<PaletteCategory[]>(() => {
    const openIn = new Map<string, number>()
    for (const task of tasks) {
      if (!task.completed && task.categoryId) openIn.set(task.categoryId, (openIn.get(task.categoryId) ?? 0) + 1)
    }
    return (snapshot?.categories ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description?.trim() || null,
      color: c.color ?? null,
      icon: c.icon ?? null,
      open: openIn.get(c.id) ?? 0,
    }))
  }, [snapshot, tasks])

  const people = useMemo<PalettePerson[]>(() => {
    const list: PalettePerson[] = []
    for (const friend of friends) {
      const name = personName(friend)
      if (!name) continue
      const theirs: Scope = { kind: "person", id: friend.id, label: name, avatar: null }
      list.push({
        id: friend.id,
        name,
        email: friend.email || null,
        avatar: friend.profilePictureUrl ?? null,
        shared: tasks.filter((t) => !t.completed && inScope(t, theirs, now)).length,
      })
    }
    // The people you actually share work with first.
    return list.sort((a, b) => b.shared - a.shared || a.name.localeCompare(b.name))
  }, [friends, tasks, now])

  // ── results ───────────────────────────────────────────────────────────────

  const parsed = useMemo(() => parseQuery(query), [query])
  const shownTab: Tab = parsed.narrow ?? tab
  const sections = useMemo(
    () => buildSections({ query: parsed, tab, scope, tasks, categories, people, recent, now }),
    [parsed, tab, scope, tasks, categories, people, recent, now],
  )
  const items = useMemo(() => flatten(sections), [sections])
  const counts = useMemo(
    () => (scope ? null : countMatches({ query: parsed, tasks, categories, people, now })),
    [scope, parsed, tasks, categories, people, now],
  )
  const views = useMemo(() => countViews(tasks, now), [tasks, now])
  const scopeCounts = useMemo(() => {
    let openCount = 0
    let doneCount = 0
    if (scope) {
      for (const task of tasks) {
        if (!inScope(task, scope, now)) continue
        if (task.completed) doneCount += 1
        else openCount += 1
      }
    }
    return { open: openCount, done: doneCount }
  }, [scope, tasks, now])

  // The selection survives the list changing under it, clamped to what is there.
  const current = Math.min(active, Math.max(items.length - 1, 0))
  const activeItem = items[current] ?? null
  // Reached for, and still the row the highlight is on.
  const revealed = activeItem !== null && highlight.reached === activeItem.key

  // ── keys ──────────────────────────────────────────────────────────────────

  const press = useCallback((...keys: string[]) => {
    setPressed(keys)
    window.clearTimeout(pressTimer.current)
    pressTimer.current = window.setTimeout(() => setPressed([]), 150)
  }, [])
  useEffect(() => () => window.clearTimeout(pressTimer.current), [])

  const move = useCallback((index: number, key: string | undefined) => {
    keyboardMove.current = true
    setHighlight({ index, reached: key ?? null })
  }, [])

  const point = useCallback((index: number, key: string) => {
    keyboardMove.current = false
    setHighlight({ index, reached: key })
  }, [])

  const narrowTo = useCallback((next: Scope | null) => {
    setScope(next)
    setQuery("")
    setHighlight(TOP)
    inputRef.current?.focus()
  }, [])

  const run = useCallback((item: PaletteItem, { newTab = false }: { newTab?: boolean } = {}) => {
    const action = item.action
    if (action.type === "open-task" || action.type === "navigate") {
      const href = action.type === "open-task" ? `/branch/${action.taskId}` : action.href
      rememberRecent(viewerId, action.type === "open-task" ? { kind: "task", id: action.taskId } : { kind: "screen", id: action.screen })
      if (newTab) {
        // The palette stays open, so several tasks can be sent to tabs in a row.
        window.open(href, "_blank", "noopener,noreferrer")
        return
      }
      setOpen(false)
      router.push(href)
      return
    }
    if (action.type === "scope") {
      const next = action.scope
      if (next.kind === "category" || next.kind === "person") rememberRecent(viewerId, { kind: next.kind, id: next.id })
      narrowTo(next)
      return
    }
    setOpen(false)
    if (action.type === "capture") {
      const request = { title: action.title }
      // On a screen with capture it opens in place, a frame after the palette has
      // handed focus back; anywhere else the request waits for Tasks to mount it.
      if (CAPTURE_ROUTES.has(pathname ?? "")) {
        window.requestAnimationFrame(() => requestCapture(request))
      } else {
        requestCapture(request)
        router.push("/tasks")
      }
      return
    }
    window.requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(OPEN_SHORTCUTS_EVENT)))
  }, [viewerId, router, pathname, narrowTo])

  const selectTab = useCallback((next: Tab) => {
    setTab(next)
    // An operator would overrule the tab that was just chosen; the tab decides now.
    setQuery((value) => {
      const current = parseQuery(value)
      return current.narrow ? current.text : value
    })
    setHighlight(TOP)
    inputRef.current?.focus()
  }, [])

  const pickView = useCallback((view: SmartView) => {
    narrowTo({ kind: "view", id: view.id, label: view.label })
  }, [narrowTo])

  /**
   * Escape peels one layer at a time: the query, then the scope, then the palette.
   * Claimed in the capture phase so nothing behind the palette — a dialog it was
   * opened over, the list's own keys — sees the key; a dialog opened on top of the
   * palette (the shortcut map) keeps its own Escape.
   */
  const stepBack = useRef<() => void>(() => undefined)
  stepBack.current = () => {
    if (query) {
      setQuery("")
      setHighlight(TOP)
    } else if (scope) {
      setScope(null)
      setHighlight(TOP)
    } else {
      setOpen(false)
    }
  }

  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return
      const owner = event.target instanceof Element ? event.target.closest("[role='dialog']") : null
      if (owner && owner !== panelRef.current) return
      event.preventDefault()
      event.stopPropagation()
      press("esc")
      stepBack.current()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [open, press])

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    const count = items.length
    const moveTo = (index: number) => move(index, items[index]?.key)
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault()
        press("down")
        if (count) moveTo((current + 1) % count)
        return
      case "ArrowUp":
        event.preventDefault()
        press("up")
        if (count) moveTo((current - 1 + count) % count)
        return
      case "PageDown":
        event.preventDefault()
        if (count) moveTo(Math.min(count - 1, current + PAGE))
        return
      case "PageUp":
        event.preventDefault()
        if (count) moveTo(Math.max(0, current - PAGE))
        return
      case "Enter": {
        event.preventDefault()
        const newTab = event.metaKey || event.ctrlKey
        if (newTab) press("mod", "enter")
        else press("enter")
        if (activeItem) run(activeItem, { newTab })
        return
      }
      case "Tab":
        // Tab narrows into the highlighted category, person or view; on any other
        // row it is ordinary Tab, and the focus trap keeps it inside the palette.
        if (event.shiftKey || !activeItem || activeItem.action.type !== "scope") return
        event.preventDefault()
        press("tab")
        run(activeItem)
        return
      case "Backspace":
        if (query !== "" || !scope) return
        event.preventDefault()
        setScope(null)
        setHighlight(TOP)
        return
    }
  }

  /**
   * Keys pressed inside the palette stay inside it. The list behind it answers to
   * bare letters (`x`, `e`, Delete) whenever focus is not in a text field — which
   * it is not while a tab or a chip here has focus.
   */
  const isolateKeys = (event: ReactKeyboardEvent) => {
    if (event.key === "Tab") return
    event.stopPropagation()
    event.nativeEvent.stopImmediatePropagation()
  }

  // Keep the highlighted row in view when the keys walk past the edge.
  useEffect(() => {
    if (!keyboardMove.current) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView?.({ block: "nearest" })
  }, [current])

  // A new question starts at the top of its answer.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
  }, [query, tab, scope])

  // ── entrance and exit ─────────────────────────────────────────────────────

  /**
   * It grows out of the search button and folds back into it — the task editor's
   * card-to-dialog move, with the same critically damped spring, so it lands
   * without passing its size. Opened from the keyboard it drops in from just
   * above. Measured untransformed before the first frame, once per opening.
   */
  const controls = useAnimationControls()
  const [panel, setPanel] = useState<HTMLDivElement | null>(null)
  const attachPanel = useCallback((node: HTMLDivElement | null) => {
    trapRef(node)
    panelRef.current = node
    setPanel(node)
  }, [trapRef])
  const wasOpen = useRef(false)
  const entrance = useRef<OriginTransform | null>(null)
  const animationRun = useRef(0)

  useLayoutEffect(() => {
    if (!panel) return
    if (!open) {
      if (!wasOpen.current) return
      wasOpen.current = false
      controls.stop()
      const exitRun = ++animationRun.current
      const from = reduce ? null : entrance.current
      void controls
        .start(
          from ? { opacity: 0, ...from } : { opacity: 0, scale: reduce ? 1 : 0.98, x: 0, y: reduce ? 0 : -8 },
          { duration: from ? DURATION_UI : DURATION_FAST, ease: EASE_STANDARD },
        )
        .then(() => {
          // An interrupted close must never remove a palette that reopened meanwhile.
          if (animationRun.current === exitRun && !wasOpen.current) finishExit()
        })
      return
    }
    if (wasOpen.current) return
    wasOpen.current = true
    ++animationRun.current
    controls.stop()
    const previous = panel.style.transform
    panel.style.transform = "none"
    const target = panel.getBoundingClientRect()
    panel.style.transform = previous
    const origin = originRef.current
    originRef.current = null
    const from = !reduce && origin && target.width > 0 && target.height > 0 ? originTransform(origin, target) : null
    entrance.current = from
    controls.set(from ? { opacity: 0, ...from } : { opacity: 0, scale: reduce ? 1 : 0.97, x: 0, y: reduce ? 0 : -12 })
    void controls.start({ opacity: 1, scale: 1, x: 0, y: 0 }, SPRING_LAYOUT)
  }, [panel, open, reduce, controls, finishExit])

  useLayoutEffect(() => () => {
    ++animationRun.current
    controls.stop()
  }, [controls])

  if (!isAuthenticated) return null

  // ── render ────────────────────────────────────────────────────────────────

  const searching = parsed.tokens.length > 0
  const home = !scope && !searching && !parsed.narrow && tab === "all"
  const loading = snapshot === null
  const found = items.filter((item) => item.kind !== "create").length

  let empty: { title: string; hint: string } | null = null
  if (!loading && found === 0) {
    if (searching) {
      const canCreate = !parsed.narrow && (scope !== null || tab === "all" || tab === "tasks")
      empty = {
        title: `Nothing matches “${parsed.text}”`,
        hint: canCreate
          ? "Press ↵ to make it a task, or try # @ > to look elsewhere."
          : "Try another word, or another tab.",
      }
    } else if (scope) {
      empty = { title: `Nothing in ${scope.label} yet`, hint: "Backspace widens the search back out." }
    } else if (shownTab === "people") {
      empty = { title: "No friends yet", hint: "Add friends on your profile, and the tasks you share show up here." }
    } else if (shownTab === "categories") {
      empty = { title: "No categories yet", hint: "Make one on the Categories screen to group your tasks." }
    } else if (shownTab === "tasks") {
      empty = { title: "No tasks yet", hint: "Press C anywhere to capture the first one." }
    }
  }

  const status = loading
    ? "Loading tasks"
    : searching
      ? found ? `${found} ${found === 1 ? "result" : "results"}` : "No results"
      : ""

  const verb: FooterVerb | null = activeItem ? footerVerb(activeItem) : null
  const escape = query ? "clear" : scope ? "back" : "close"

  let index = -1

  return (
    <ModalPortal>
      {mounted ? (
        <div
          className={cn(
            "fixed inset-0 z-modal flex items-start justify-center px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-4 sm:pt-[12vh]",
            !open && "pointer-events-none",
          )}
        >
          <div
            data-state={presenceProps["data-state"]}
            onClick={close}
            aria-hidden="true"
            className="backdrop-surface absolute inset-0 bg-ink/40 backdrop-blur-sm"
          />

          <motion.div
            ref={attachPanel}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            tabIndex={-1}
            initial={{ opacity: 0 }}
            animate={controls}
            onKeyDown={isolateKeys}
            className="relative flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-paper shadow-xl outline-none"
          >
            <LayoutGroup id="palette">
              {/* The question */}
              <div className="flex h-14 flex-shrink-0 items-center gap-3 border-b border-line px-4">
                <Search className="h-5 w-5 flex-shrink-0 text-ink-subtle" aria-hidden="true" />
                {scope ? <ScopeChip scope={scope} onRemove={() => narrowTo(null)} /> : null}
                <div className="relative flex min-w-0 flex-1 items-center">
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value)
                      setHighlight(TOP)
                    }}
                    onKeyDown={onInputKeyDown}
                    placeholder={scope ? `Search in ${scope.label}` : "Search tasks, categories, people and shortcuts"}
                    aria-label={scope ? `Search in ${scope.label}` : "Search tasks and shortcuts"}
                    role="combobox"
                    aria-expanded="true"
                    aria-controls={listboxId}
                    aria-autocomplete="list"
                    aria-activedescendant={activeItem ? optionId(activeItem.key) : undefined}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    enterKeyHint="go"
                    className="field-naked h-12 w-full min-w-0 bg-transparent text-body font-medium tracking-tight text-ink placeholder:text-transparent sm:text-title-sm"
                  />
                  {query === "" ? (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 flex items-center overflow-hidden text-body font-medium tracking-tight text-ink-subtle sm:text-title-sm"
                    >
                      <RollingHint scopeLabel={scope?.label} />
                    </span>
                  ) : null}
                </div>
                {query ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={keepFocus}
                    onClick={() => {
                      setQuery("")
                      setHighlight(TOP)
                      inputRef.current?.focus()
                    }}
                    aria-label="Clear search"
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-ink-subtle transition-colors duration-fast hover:bg-ink/5 hover:text-ink"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : (
                  <span aria-hidden="true" className="hidden flex-shrink-0 sm:inline-flex">
                    <Kbd>Esc</Kbd>
                  </span>
                )}
              </div>

              {/* Where to look */}
              <div className="flex h-11 flex-shrink-0 items-center border-b border-line px-2 sm:px-3">
                {scope ? (
                  <ScopeBar scope={scope} open={scopeCounts.open} done={scopeCounts.done} onBack={() => narrowTo(null)} />
                ) : (
                  <TabBar tab={shownTab} counts={counts} onSelect={selectTab} />
                )}
              </div>

              <div className="flex min-h-0 flex-1">
                <motion.div
                  ref={listRef}
                  layoutScroll
                  className="max-h-[min(27rem,62dvh)] min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-2 md:h-[min(27rem,58vh)] md:max-h-none"
                >
                  {snapshot?.tasksFailed ? (
                    <div className="mx-1 mt-3 flex items-center gap-3 rounded-md bg-paper-sunken px-3 py-2.5 text-caption font-medium text-ink-muted">
                      <CloudOff className="h-4 w-4 flex-shrink-0 text-ink-subtle" aria-hidden="true" />
                      <span className="min-w-0 flex-1">Your tasks didn’t load. Screens and shortcuts still work.</span>
                      <button
                        type="button"
                        onMouseDown={keepFocus}
                        onClick={() => setReload((n) => n + 1)}
                        className="flex-shrink-0 font-semibold text-ink underline underline-offset-2 transition-colors duration-fast hover:text-ink-muted"
                      >
                        Try again
                      </button>
                    </div>
                  ) : null}

                  {home && !loading ? <ViewChips views={views} onPick={pickView} /> : null}
                  {home && loading ? <SkeletonRows /> : null}
                  {empty ? <EmptyState title={empty.title} hint={empty.hint} /> : null}

                  <div role="listbox" id={listboxId} aria-label="Results" className="pb-2">
                    {sections.map((section) => {
                      const headingId = `${listboxId}-${section.id}`
                      const target = !scope && shownTab === "all" ? SECTION_TAB[section.id] : undefined
                      const more = target && section.total && section.total > section.items.length ? section.total : 0
                      return (
                        <div key={section.id} role="group" aria-labelledby={headingId}>
                          <div
                            id={headingId}
                            role="presentation"
                            className={cn(FIELD_LABEL_CLASS, "sticky top-0 z-[1] flex items-center justify-between bg-paper px-3 pb-1.5 pt-3 text-ink-subtle")}
                          >
                            <span>{section.title}</span>
                            {more && target ? (
                              <button
                                type="button"
                                tabIndex={-1}
                                aria-hidden="true"
                                onMouseDown={keepFocus}
                                onClick={() => selectTab(target)}
                                className="normal-case tracking-normal text-ink-muted transition-colors duration-fast hover:text-ink"
                              >
                                Show all {more}
                              </button>
                            ) : null}
                          </div>
                          {section.items.map((item) => {
                            index += 1
                            return (
                              <Option
                                key={item.key}
                                item={item}
                                index={index}
                                id={optionId(item.key)}
                                active={index === current}
                                revealed={index === current && revealed}
                                now={now}
                                names={names}
                                hideCategory={scope?.kind === "category"}
                                onPoint={point}
                                onRun={run}
                              />
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                </motion.div>

                <aside
                  aria-label="Details"
                  className="relative hidden w-72 flex-shrink-0 flex-col overflow-hidden border-l border-line bg-paper-sunken p-5 md:flex"
                >
                  <Preview item={activeItem} scope={scope} tasks={tasks} now={now} names={names} revealed={revealed} />
                </aside>
              </div>

              <Footer
                pressed={pressed}
                isApple={isApple}
                primary={verb}
                newTab={activeItem?.action.type === "open-task" || activeItem?.action.type === "navigate"}
                narrow={activeItem?.action.type === "scope"}
                filters={!scope}
                escape={escape}
              />
              <div role="status" aria-live="polite" className="sr-only">{status}</div>
            </LayoutGroup>
          </motion.div>
        </div>
      ) : null}
    </ModalPortal>
  )
}

function footerVerb(item: PaletteItem): FooterVerb {
  switch (item.action.type) {
    case "open-task":
      return "open"
    case "navigate":
      return "go"
    case "scope":
      return "narrow"
    case "capture":
      return item.kind === "create" ? "create" : "capture"
    case "shortcuts":
      return "show"
  }
}
