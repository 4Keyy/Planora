"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { motion, useReducedMotion } from "framer-motion"
import { TodoCard } from "@/components/todos/todo-card"
import { UndoBar, useUndoableAction } from "@/components/ui/undo-bar"
import { useListNavigation } from "@/hooks/use-list-navigation"
import { FIELD_LABEL_CLASS } from "@/components/ui/field"
import { TodoSkeleton } from "@/components/todos/todo-skeleton"
import { StatusPanel } from "@/components/ui/status-panel"
import { todoToOwnerPayload } from "@/components/todos/edit-todo-modal/utils"
import { api, parseApiResponse } from "@/lib/api"
import { DEMO_USER } from "@/lib/demo/state"
import { legendKeyFor, ROW_KEYS, type LegendKey } from "@/lib/landing-keys"
import { SPRING_RESPONSIVE } from "@/lib/animations"
import { useToastStore } from "@/store/toast"
import { isTodoOwner, toApiTodoStatus, type Todo, type PagedTodosResponse } from "@/types/todo"
import type { Category } from "@/types/category"
import { toCategoryList, type CategoryListResponse } from "@/types/category"
import { SandboxNotice } from "./demo-sandbox"
import { cn } from "@/lib/utils"

const EditTodoModal = dynamic(
  () => import("@/components/todos/edit-todo-modal").then((m) => ({ default: m.EditTodoModal })),
  { ssr: false },
)

/**
 * Block 4 — the product, on the product's own data layer.
 *
 * Every call below goes through `lib/api.ts`, which means the sandbox genuinely exercises
 * the request interceptor (auth header, CSRF echo, traceparent), the response interceptor
 * (401-refresh-retry, 403-CSRF-retry, cancellation) and `parseApiResponse`'s three
 * envelope shapes. `DemoSandbox` swaps only the transport — the layer below all of that —
 * so nothing in this file knows it is a demo, and nothing here is written twice.
 *
 * ## It behaves the way `/tasks` behaves, not the way a demo would like to
 *
 * Completing is **not** optimistic in the product: the card leaves once the server has
 * said yes, and the product says "Task completed!". A failure is a toast, as it is there —
 * this block used to roll back silently, which no screen in the app does. Priority is the
 * owner's alone and goes through `todoToOwnerPayload`, because the endpoint is a PUT and a
 * partial body clears what it omits. The list stops listening while the task editor is
 * open (`enabled`), exactly as `/tasks` does: otherwise Escape in the editor also dropped
 * the list's cursor, and Space on a focused editor control could complete the task behind
 * the dialog.
 *
 * Two constraints that are easy to break:
 *
 * `useListNavigation` is single-instance per page by construction — the first listener's
 * `preventDefault()` trips the second's `defaultPrevented` guard. This is the only list
 * on `/`.
 *
 * `<ShortcutsHelp/>` is already mounted globally with a capture-phase `?` handler, so a
 * second copy here would double-toggle the very overlay this block points at.
 */
export function KeyboardConsole() {
  const [tasks, setTasks] = useState<Todo[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState<Todo | null>(null)
  const [openInTitleEdit, setOpenInTitleEdit] = useState(false)
  const { pending, run, undo } = useUndoableAction()
  const addToast = useToastStore((s) => s.addToast)

  const load = useCallback(async () => {
    try {
      const [todoRes, catRes] = await Promise.all([
        api.get<PagedTodosResponse>("/todos/api/v1/todos", { params: { isCompleted: false } }),
        api.get<CategoryListResponse>("/categories/api/v1/categories"),
      ])
      setTasks(parseApiResponse(todoRes.data).items ?? [])
      setCategories(toCategoryList(catRes.data))
      setFailed(false)
    } catch {
      // The real error path, not a swallowed one: if the sandbox ever fails to install,
      // the block says so instead of showing an empty list that looks like a product
      // with nothing in it.
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggleComplete = async (id: string) => {
    const task = tasks.find((t) => t.id === id)
    if (!task) return
    // Every task in this list is open (it is loaded with isCompleted=false), so the only
    // direction is done — the same PUT `/tasks` sends, confirmed before the row leaves.
    try {
      await api.put(`/todos/api/v1/todos/${id}`, { status: "done" })
      setTasks((prev) => prev.filter((t) => t.id !== id))
      addToast({ type: "success", title: "Task completed!" })
    } catch {
      addToast({ type: "error", title: "Failed to update task" })
    }
  }

  const setPriority = async (id: string, level: number) => {
    const task = tasks.find((t) => t.id === id)
    // A shared viewer pressing `3` would earn a 403 for a key nobody offered them.
    if (!task || !isTodoOwner(task, DEMO_USER.userId)) return
    try {
      const res = await api.put(`/todos/api/v1/todos/${id}`, {
        ...todoToOwnerPayload(task),
        priority: level,
        status: toApiTodoStatus(task.status),
      })
      const updated = parseApiResponse<Todo>(res.data)
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updated } : t)))
    } catch {
      addToast({ type: "error", title: "Failed to update task" })
    }
  }

  /**
   * Delete, deferred. `useUndoableAction` holds the DELETE for five seconds and drops the
   * timer entirely if the visitor undoes — so on this page, exactly as in the product,
   * an undone delete never reaches the API at all.
   */
  const remove = (id: string) => {
    const victim = tasks.find((t) => t.id === id)
    if (!victim) return
    const index = tasks.findIndex((t) => t.id === id)
    const putBack = () =>
      setTasks((prev) => {
        if (prev.some((t) => t.id === id)) return prev
        const next = [...prev]
        next.splice(Math.min(index, next.length), 0, victim)
        return next
      })
    setTasks((prev) => prev.filter((t) => t.id !== id))
    run({
      label: "Task deleted",
      commit: async () => {
        try {
          await api.delete(`/todos/api/v1/todos/${id}`)
        } catch {
          putBack()
          addToast({ type: "error", title: "Failed to delete task" })
        }
      },
      rollback: putBack,
    })
  }

  const openEditor = (task: Todo, titleEdit: boolean) => {
    setOpenInTitleEdit(titleEdit)
    setEditing(task)
  }

  const nav = useListNavigation({
    ids: tasks.map((t) => t.id),
    enabled: editing === null,
    onActivate: (id) => {
      const task = tasks.find((t) => t.id === id)
      if (task) openEditor(task, false)
    },
    onEdit: (id) => {
      const task = tasks.find((t) => t.id === id)
      if (task) openEditor(task, true)
    },
    onToggleComplete: (id) => void toggleComplete(id),
    onDelete: remove,
    onPriority: (id, level) => void setPriority(id, level),
  })

  const lit = useLitKey({
    enabled: editing === null,
    rowKeysLive: nav.cursorVisible && nav.activeId !== null,
  })

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-10">
      <div>
        {loading ? (
          // Reserving the real card footprint, so the swap costs no layout shift.
          <div className="flex flex-col gap-3">
            <TodoSkeleton />
            <TodoSkeleton />
            <TodoSkeleton />
          </div>
        ) : failed ? (
          <StatusPanel
            title="The sandbox did not start"
            description="Reload the page to try again. Nothing was sent anywhere."
            action={{ label: "Reload", onClick: () => window.location.reload() }}
            size="compact"
            as="p"
          />
        ) : tasks.length === 0 ? (
          <StatusPanel
            title="Everything is done"
            description="Undo brings the last one back, or reload to start over."
            action={{ label: "Start over", onClick: () => window.location.reload() }}
            size="compact"
            as="p"
          />
        ) : (
          <div className="flex flex-col gap-3">
            {tasks.map((task) => (
              <TodoCard
                key={task.id}
                todo={task}
                viewerId={DEMO_USER.userId}
                rowProps={nav.getRowProps(task.id)}
                onComplete={() => toggleComplete(task.id)}
                onDelete={() => remove(task.id)}
                onEdit={() => openEditor(task, false)}
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <p className={FIELD_LABEL_CLASS}>Bound on this page</p>
        <dl className="mt-3 flex flex-col gap-2">
          {KEYS.map(({ keys, does }) => (
            <LegendRow key={keys} keys={keys} does={does} lit={lit === keys} />
          ))}
        </dl>
        <p className="mt-4 text-caption text-ink-muted">
          On a phone there&rsquo;s no keyboard, so treat this list as a map.
        </p>
        <div className="mt-4">
          <SandboxNotice />
        </div>
      </div>

      <UndoBar pending={pending} onUndo={undo} />

      {editing && (
        <EditTodoModal
          todo={editing}
          categories={categories}
          openInTitleEdit={openInTitleEdit}
          onClose={() => setEditing(null)}
          onSave={async (payload) => {
            await api.put(`/todos/api/v1/todos/${editing.id}`, payload)
            await load()
          }}
          onSaveViewerPreference={async (payload) => {
            await api.patch(`/todos/api/v1/todos/${editing.id}/viewer-preferences`, payload)
          }}
          onCreateCategory={load}
        />
      )}
    </div>
  )
}

/**
 * The legend row the visitor's last keystroke belongs to, for ~700ms.
 *
 * A passive listener: it never prevents, never stops propagation, and ignores keys typed
 * into a field, so it cannot change what any key does — it only reports it. Row keys light
 * only while the list's cursor is shown, because with a hidden cursor they do nothing, and
 * a legend that lights up for a key that did nothing would be the lie this block exists to
 * avoid.
 */
function useLitKey({ enabled, rowKeysLive }: { enabled: boolean; rowKeysLive: boolean }) {
  const [lit, setLit] = useState<LegendKey | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const live = useRef(rowKeysLive)
  useEffect(() => {
    live.current = rowKeysLive
  }, [rowKeysLive])

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])") !== null)
      ) {
        return
      }
      const row = legendKeyFor(event)
      if (!row) return
      if (ROW_KEYS.has(row) && !live.current) return
      setLit(row)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setLit(null), 700)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [enabled])

  return lit
}

function LegendRow({ keys, does, lit }: { keys: LegendKey; does: string; lit: boolean }) {
  const reduce = useReducedMotion() ?? false
  return (
    <div className="flex h-7 items-center justify-between gap-4">
      <dt>
        <motion.kbd
          aria-hidden="true"
          // A single press, keyed to each lighting so a repeated key presses again.
          key={lit ? `${keys}-lit` : keys}
          initial={lit && !reduce ? { scale: 0.9 } : false}
          animate={{ scale: 1 }}
          transition={SPRING_RESPONSIVE}
          className={cn(
            "inline-flex h-6 min-w-6 items-center justify-center rounded-sm border px-1.5",
            "text-caption font-semibold tabular-nums transition-colors duration-fast",
            lit ? "border-ink bg-ink text-paper" : "border-line bg-paper-sunken text-ink-muted"
          )}
        >
          {keys}
        </motion.kbd>
      </dt>
      <dd
        className={cn(
          "text-caption transition-colors duration-fast",
          lit ? "font-semibold text-ink" : "text-ink-muted"
        )}
      >
        {does}
      </dd>
    </div>
  )
}

/**
 * Every key here is bound on this page, and the list is the claim.
 *
 * `Enter` and `E` open the product's real branch editor; `Cmd/Ctrl+K` is the product's
 * real command palette, which works because the sandbox seeds a session and the palette
 * returns `null` without one. That is the difference between this list and a picture.
 */
const KEYS: { keys: LegendKey; does: string }[] = [
  { keys: "J K", does: "Move the cursor" },
  { keys: "⏎", does: "Open the branch" },
  { keys: "E", does: "Edit the title in place" },
  { keys: "Space", does: "Complete the task" },
  { keys: "1–5", does: "Set priority" },
  { keys: "Delete", does: "Delete, with five seconds to undo" },
  { keys: "Mod K", does: "The command palette" },
  { keys: "?", does: "The keyboard map itself" },
]
