"use client"

import { useCallback, useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { TodoCard } from "@/components/todos/todo-card"
import { UndoBar, useUndoableAction } from "@/components/ui/undo-bar"
import { useListNavigation } from "@/hooks/use-list-navigation"
import { FIELD_LABEL_CLASS } from "@/components/ui/field"
import { TodoSkeleton } from "@/components/todos/todo-skeleton"
import { StatusPanel } from "@/components/ui/status-panel"
import { api, parseApiResponse } from "@/lib/api"
import { DEMO_USER } from "@/lib/demo/state"
import type { Todo, PagedTodosResponse } from "@/types/todo"
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
 * The earlier version of this block held its own React state. It looked identical and
 * proved much less: an optimistic update that is never contradicted by a refetch is not
 * evidence of anything, and the whole data layer was bypassed.
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
    const next = !task.isCompleted
    // Optimistic, then reconciled by the response — the product's own pattern.
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, isCompleted: next } : t)))
    try {
      await api.put(`/todos/api/v1/todos/${id}`, { status: next ? "done" : "todo" })
      if (next) setTasks((prev) => prev.filter((t) => t.id !== id))
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, isCompleted: !next } : t)))
    }
  }

  const setPriority = async (id: string, level: number) => {
    const previous = tasks
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, priority: String(level) } : t)))
    try {
      await api.put(`/todos/api/v1/todos/${id}`, { priority: String(level) })
    } catch {
      setTasks(previous)
    }
  }

  /**
   * Delete, deferred. `useUndoableAction` holds the DELETE for five seconds and drops the
   * timer entirely if the visitor undoes — so on this page, exactly as in the product,
   * an undone delete never reaches the API at all. That is the honest version of the
   * claim, and it is the reason the block can say the request is never sent.
   */
  const remove = (id: string) => {
    const victim = tasks.find((t) => t.id === id)
    if (!victim) return
    const index = tasks.findIndex((t) => t.id === id)
    setTasks((prev) => prev.filter((t) => t.id !== id))
    run({
      label: "Task deleted",
      commit: async () => {
        try {
          await api.delete(`/todos/api/v1/todos/${id}`)
        } catch {
          setTasks((prev) => {
            const next = [...prev]
            next.splice(index, 0, victim)
            return next
          })
        }
      },
      rollback: () =>
        setTasks((prev) => {
          const next = [...prev]
          next.splice(index, 0, victim)
          return next
        }),
    })
  }

  const nav = useListNavigation({
    ids: tasks.map((t) => t.id),
    onActivate: (id) => {
      setOpenInTitleEdit(false)
      setEditing(tasks.find((t) => t.id === id) ?? null)
    },
    onEdit: (id) => {
      setOpenInTitleEdit(true)
      setEditing(tasks.find((t) => t.id === id) ?? null)
    },
    onToggleComplete: (id) => void toggleComplete(id),
    onDelete: remove,
    onPriority: (id, level) => void setPriority(id, level),
  })

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-10">
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
                onComplete={() => void toggleComplete(task.id)}
                onDelete={() => remove(task.id)}
                onEdit={() => {
                  setOpenInTitleEdit(false)
                  setEditing(task)
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <p className={FIELD_LABEL_CLASS}>Bound on this page</p>
        <dl className="mt-3 flex flex-col gap-2">
          {KEYS.map(({ keys, does }) => (
            <div key={keys} className="flex items-baseline justify-between gap-4">
              <dt>
                <kbd
                  aria-hidden="true"
                  className={cn(
                    "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line",
                    "bg-paper-sunken px-1.5 text-caption font-semibold tabular-nums text-ink-muted"
                  )}
                >
                  {keys}
                </kbd>
              </dt>
              <dd className="text-caption text-ink-subtle">{does}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-caption text-ink-subtle">
          On a phone there is no keyboard to promise, so this list is here to read rather than to
          use.
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
 * Every key here is bound on this page, and the list is the claim.
 *
 * `Enter` and `E` open the product's real branch editor; `Cmd/Ctrl+K` is the product's
 * real command palette, which works because the sandbox seeds a session and the palette
 * returns `null` without one. That is the difference between this list and a picture.
 */
const KEYS: { keys: string; does: string }[] = [
  { keys: "J K", does: "Move the cursor" },
  { keys: "⏎", does: "Open the branch" },
  { keys: "E", does: "Edit the title in place" },
  { keys: "Space", does: "Complete or reopen" },
  { keys: "1–5", does: "Set priority" },
  { keys: "Delete", does: "Delete, with five seconds to undo" },
  { keys: "Mod K", does: "The command palette" },
  { keys: "?", does: "The keyboard map itself" },
]
