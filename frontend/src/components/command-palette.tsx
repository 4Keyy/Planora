"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import {
  ArrowRight,
  CheckCircle2,
  CornerDownLeft,
  FolderOpen,
  LayoutDashboard,
  ListTodo,
  Plus,
  Search,
  User,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { ModalPortal } from "@/components/ui/modal-portal"
import { useFocusTrap } from "@/hooks/use-focus-trap"
import { useScrollLock } from "@/hooks/use-scroll-lock"
import { api } from "@/lib/api"
import type { PagedTodosResponse } from "@/types/todo"
import { EASE_OUT_EXPO, DURATION_FAST, SPRING_STANDARD } from "@/lib/animations"
import { useAuthStore } from "@/store/auth"
import { cn } from "@/lib/utils"

/**
 * Command palette — ⌘K on a Mac, Ctrl+K everywhere else.
 *
 * The product's keyboard path used to stop at Tab. On a desktop this is where an
 * experienced user actually lives: one chord, type three letters, Enter. Every row
 * shows the shortcut that reaches it directly, so the palette teaches the product's
 * other keys rather than replacing them.
 *
 * It searches the user's real tasks, not just a static menu. That is what makes it
 * worth opening: "flights" finds the task about booking flights and lands on its
 * branch, in about a second, from anywhere.
 *
 * Accessibility follows the ARIA combobox-with-listbox pattern: the input keeps
 * focus and owns `aria-activedescendant`, so arrow keys move the selection while a
 * screen reader announces the highlighted row without focus ever leaving the field.
 */

type Command = {
  id: string
  label: string
  hint?: string
  icon: LucideIcon
  shortcut?: string
  group: "Actions" | "Go to" | "Tasks"
  run: () => void
}

const OPEN_CREATE_EVENT = "planora:open-create"

/** Fires the same create panel the "c" shortcut opens. */
function requestCreate() {
  window.dispatchEvent(new CustomEvent(OPEN_CREATE_EVENT))
}

/**
 * Subsequence match, the way every good palette scores: "bfl" finds
 * "Book the FLights". Returns a score — lower is better — or null for no match.
 * A run of adjacent characters and a match at a word boundary both score better,
 * which is what makes short queries land on the obvious result.
 */
function fuzzyScore(haystack: string, needle: string): number | null {
  if (!needle) return 0
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()
  let score = 0
  let hi = 0
  let lastHit = -2
  for (let ni = 0; ni < n.length; ni++) {
    const ch = n[ni]
    const found = h.indexOf(ch, hi)
    if (found === -1) return null
    // Adjacent characters are worth far more than scattered ones.
    if (found !== lastHit + 1) score += 8
    // A match at the start of a word beats one in the middle of it.
    if (found > 0 && h[found - 1] !== " " && found !== lastHit + 1) score += 4
    score += found - hi
    lastHit = found
    hi = found + 1
  }
  return score
}

export function CommandPalette() {
  const router = useRouter()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const reduce = useReducedMotion() ?? false

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const [tasks, setTasks] = useState<{ id: string; title: string; category?: string | null }[]>([])

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const dialogRef = useFocusTrap<HTMLDivElement>(open)
  useScrollLock(open)

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

  // ── open / close ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [isAuthenticated])

  // Reset every time it opens: a palette that remembers the last query makes the
  // user delete someone else's search before they can start their own.
  useEffect(() => {
    if (!open) return
    setQuery("")
    setActive(0)
    const t = setTimeout(() => inputRef.current?.focus(), 40)
    return () => clearTimeout(t)
  }, [open])

  /**
   * Tasks are loaded once per opening, not on every keystroke. The list is small
   * enough to filter in memory, and a request per character would be both slower
   * and rude to the API.
   */
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      try {
        // One page is plenty: the palette shows at most eight rows, and a person
        // who cannot find a task in their 100 most recent ones wants the task list,
        // not a longer dropdown.
        const res = await api.get<PagedTodosResponse>("/todos/api/v1/todos", {
          params: { pageNumber: 1, pageSize: 100, isCompleted: false },
          suppressErrorLog: true,
        } as Parameters<typeof api.get>[1])
        if (cancelled) return
        // Deduplicate by id. A task shared with the viewer can arrive both as their
        // own row and as the owner's, and two identical rows in a palette is the
        // kind of thing that makes a user distrust the search.
        const seen = new Set<string>()
        const unique = (res.data.items ?? []).filter((t) => {
          if (seen.has(t.id)) return false
          seen.add(t.id)
          return true
        })
        setTasks(unique.map((t) => ({ id: t.id, title: t.title, category: t.categoryName })))
      } catch {
        // A palette that cannot reach the API is still a navigation palette.
        if (!cancelled) setTasks([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  const close = useCallback(() => setOpen(false), [])

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => {
      close()
      router.push(href)
    }
    const base: Command[] = [
      {
        id: "new-task",
        label: "Create task",
        hint: "Opens the composer on Tasks",
        icon: Plus,
        shortcut: "C",
        group: "Actions",
        run: () => {
          close()
          // Navigate first: only the Tasks screen owns the composer, so firing the
          // event from the dashboard would land on nobody. Pushing to a route we are
          // already on is a no-op, and the frame of delay lets that page mount its
          // listener before the event arrives.
          router.push("/tasks")
          requestAnimationFrame(requestCreate)
        },
      },
      { id: "go-dashboard", label: "Dashboard", hint: "Today at a glance", icon: LayoutDashboard, group: "Go to", run: go("/dashboard") },
      { id: "go-tasks", label: "Tasks", hint: "Everything active", icon: ListTodo, group: "Go to", run: go("/tasks") },
      { id: "go-completed", label: "Completed tasks", icon: CheckCircle2, group: "Go to", run: go("/tasks/completed") },
      { id: "go-categories", label: "Categories", icon: FolderOpen, group: "Go to", run: go("/categories") },
      { id: "go-profile", label: "Profile", hint: "Account, security, friends", icon: User, group: "Go to", run: go("/profile") },
    ]
    const taskCommands: Command[] = tasks.map((t) => ({
      id: `task-${t.id}`,
      label: t.title,
      hint: t.category || undefined,
      icon: ArrowRight,
      group: "Tasks",
      run: go(`/branch/${t.id}`),
    }))
    return [...base, ...taskCommands]
  }, [close, router, tasks])

  const results = useMemo(() => {
    if (!query.trim()) return commands.slice(0, 8)
    const scored = commands
      .map((c) => {
        const score = fuzzyScore(`${c.label} ${c.hint ?? ""}`, query.trim())
        return score === null ? null : { c, score }
      })
      .filter((x): x is { c: Command; score: number } => x !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 8)

    /**
     * Take the best eight by score, then regroup them.
     *
     * Ranking and grouping pull in opposite directions: a purely score-ordered list
     * interleaves the groups, so the headers read "TASKS / ACTIONS / TASKS" and the
     * list looks broken. Scoring first keeps the best match at the top of its own
     * group; regrouping after keeps each header appearing exactly once.
     */
    const order: Command["group"][] = ["Actions", "Go to", "Tasks"]
    return order.flatMap((g) => scored.filter((x) => x.c.group === g).map((x) => x.c))
  }, [commands, query])

  // Clamp the selection when the result set shrinks under it.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, results.length - 1)))
  }, [results.length])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((a) => (a + 1) % Math.max(1, results.length))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((a) => (a - 1 + results.length) % Math.max(1, results.length))
    } else if (e.key === "Enter") {
      e.preventDefault()
      results[active]?.run()
    } else if (e.key === "Escape") {
      // Stop here so the palette closes without also closing whatever is behind it.
      e.stopPropagation()
      close()
    }
  }

  // Keep the highlighted row in view when the arrows walk past the edge.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    el?.scrollIntoView({ block: "nearest" })
  }, [active])

  if (!isAuthenticated) return null

  let lastGroup: string | null = null

  return (
    <ModalPortal>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-modal flex items-start justify-center px-4 pt-[12vh]">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DURATION_FAST, ease: EASE_OUT_EXPO }}
              onClick={close}
              aria-hidden="true"
              className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
            />

            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Command palette"
              tabIndex={-1}
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: -4 }}
              transition={SPRING_STANDARD}
              className="relative z-modal w-full max-w-xl overflow-hidden rounded-xl border border-line bg-paper shadow-xl outline-none"
            >
              {/* Query */}
              <div className="flex items-center gap-3 border-b border-line px-4 py-1.5">
                <Search className="h-4 w-4 flex-shrink-0 text-ink-subtle" aria-hidden="true" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setActive(0) }}
                  onKeyDown={onKeyDown}
                  placeholder="Search tasks, or jump to a screen…"
                  aria-label="Search tasks and commands"
                  role="combobox"
                  aria-expanded="true"
                  aria-controls="command-palette-list"
                  aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
                  autoComplete="off"
                  spellCheck={false}
                  className="h-control w-full rounded-md bg-transparent px-1 text-body text-ink placeholder:text-ink-subtle"
                />
                <kbd
                  aria-hidden="true"
                  className="hidden flex-shrink-0 rounded border border-line bg-paper-sunken px-1.5 py-0.5 font-mono text-caption font-bold text-ink-subtle sm:block"
                >
                  ESC
                </kbd>
              </div>

              {/* Results */}
              <div
                ref={listRef}
                id="command-palette-list"
                role="listbox"
                aria-label="Results"
                className="max-h-[46vh] overflow-y-auto p-2"
              >
                {results.length === 0 ? (
                  <p className="px-3 py-8 text-center text-body-sm font-medium text-ink-subtle">
                    Nothing matches “{query}”.
                  </p>
                ) : (
                  results.map((c, i) => {
                    const header = c.group !== lastGroup ? c.group : null
                    lastGroup = c.group
                    const Icon = c.icon
                    const isActive = i === active
                    return (
                      <div key={c.id}>
                        {header ? (
                          <p className="px-3 pb-1 pt-3 text-caption font-semibold uppercase tracking-wider text-ink-subtle first:pt-1">
                            {header}
                          </p>
                        ) : null}
                        <motion.button
                          id={`cmd-${c.id}`}
                          data-index={i}
                          role="option"
                          aria-selected={isActive}
                          type="button"
                          onClick={c.run}
                          onMouseMove={() => setActive(i)}
                          initial={reduce ? false : { opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          // 20ms apart, capped at six, so the last row never waits.
                          transition={{ duration: DURATION_FAST, ease: EASE_OUT_EXPO, delay: reduce ? 0 : Math.min(i, 6) * 0.02 }}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors duration-instant",
                            isActive ? "bg-paper-sunken" : "bg-transparent",
                          )}
                        >
                          <Icon
                            className={cn("h-4 w-4 flex-shrink-0", isActive ? "text-ink" : "text-ink-subtle")}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-body-sm font-semibold text-ink">{c.label}</span>
                            {c.hint ? (
                              <span className="block truncate text-caption font-medium text-ink-subtle">{c.hint}</span>
                            ) : null}
                          </span>
                          {c.shortcut ? (
                            <kbd
                              aria-hidden="true"
                              className="flex-shrink-0 rounded border border-line bg-paper-sunken px-1.5 py-0.5 font-mono text-caption font-bold text-ink-subtle"
                            >
                              {c.shortcut}
                            </kbd>
                          ) : null}
                          {isActive ? (
                            <CornerDownLeft className="h-3.5 w-3.5 flex-shrink-0 text-ink-subtle" aria-hidden="true" />
                          ) : null}
                        </motion.button>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Footer — the palette teaches its own keys. */}
              <div className="flex items-center gap-4 border-t border-line bg-paper-sunken px-5 py-2.5 text-caption font-medium text-ink-subtle">
                <span className="flex items-center gap-1.5">
                  <kbd aria-hidden="true" className="rounded border border-line bg-paper px-1 font-mono font-bold">↑</kbd>
                  <kbd aria-hidden="true" className="rounded border border-line bg-paper px-1 font-mono font-bold">↓</kbd>
                  navigate
                </span>
                <span className="flex items-center gap-1.5">
                  <kbd aria-hidden="true" className="rounded border border-line bg-paper px-1 font-mono font-bold">↵</kbd>
                  open
                </span>
                <span className="ml-auto hidden items-center gap-1.5 sm:flex">
                  <kbd aria-hidden="true" className="rounded border border-line bg-paper px-1 font-mono font-bold">
                    {isMac ? "⌘" : "Ctrl"}
                  </kbd>
                  <kbd aria-hidden="true" className="rounded border border-line bg-paper px-1 font-mono font-bold">K</kbd>
                  to close
                </span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </ModalPortal>
  )
}

export { OPEN_CREATE_EVENT }
