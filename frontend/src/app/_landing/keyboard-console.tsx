"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { TodoCard } from "@/components/todos/todo-card"
import { UndoBar, useUndoableAction } from "@/components/ui/undo-bar"
import { useListNavigation } from "@/hooks/use-list-navigation"
import { usePriorityWriter } from "@/hooks/use-priority-writer"
import { FIELD_LABEL_CLASS } from "@/components/ui/field"
import { KeyLegendRow, useLitKey } from "@/components/ui/key-legend"
import { TodoSkeleton } from "@/components/todos/todo-skeleton"
import { StatusPanel } from "@/components/ui/status-panel"
import { api, parseApiResponse } from "@/lib/api"
import { DEMO_USER } from "@/lib/demo/state"
import { type LegendKey } from "@/lib/landing-keys"
import { useToastStore } from "@/store/toast"
import { isTodoOwner, type Todo, type PagedTodosResponse } from "@/types/todo"
import type { Category } from "@/types/category"
import { toCategoryList, type CategoryListResponse } from "@/types/category"
import { SandboxNotice } from "./demo-sandbox"

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
 * owner's alone and goes through `usePriorityWriter`, the same writer the app's screens
 * use: shown on the keypress, saved once, `{ priority }` and nothing else — from the
 * cursor, or from the card under the pointer. The list stops listening while the task
 * editor is open (`enabled`), exactly as `/tasks` does: otherwise Escape in the editor also
 * dropped the list's cursor, and Space on a focused editor control could complete the task
 * behind the dialog.
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
  const { pending, run, undo, hold, release } = useUndoableAction()
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
      addToast({ type: "success", title: "Task completed" })
    } catch {
      addToast({ type: "error", title: "Couldn't update task" })
    }
  }

  // Memoised cards keep the handlers of their first render; the writer reads the list
  // through this ref, so an old handler still sees today's tasks.
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks

  const writePriority = usePriorityWriter({
    read: (id) => tasksRef.current.find((t) => t.id === id),
    patch: (id, fields) => setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...fields } : t))),
    save: async (id, level) => {
      const res = await api.put(`/todos/api/v1/todos/${id}`, { priority: level })
      return parseApiResponse<Todo>(res.data)
    },
    onError: () => addToast({ type: "error", title: "Couldn't change the priority" }),
  })

  const setPriority = (id: string, level: number) => {
    const task = tasksRef.current.find((t) => t.id === id)
    // A shared viewer pressing `3` would earn a 403 for a key nobody offered them.
    if (!task || task.hidden || !isTodoOwner(task, DEMO_USER.userId)) return
    writePriority(id, level)
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
          addToast({ type: "error", title: "Couldn't delete task" })
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
    onPriority: setPriority,
  })

  const lit = useLitKey({ enabled: editing === null })

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-10">
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
                onPriority={(level) => setPriority(task.id, level)}
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <p className={FIELD_LABEL_CLASS}>Bound on this page</p>
        <dl className="mt-3 flex flex-col gap-2">
          {KEYS.map(({ keys, does }) => (
            <KeyLegendRow key={keys} keys={keys} does={does} lit={lit === keys} />
          ))}
        </dl>
        <p className="mt-4 text-caption text-ink-muted">
          On a phone there&rsquo;s no keyboard, so treat this list as a map.
        </p>
        <div className="mt-4">
          <SandboxNotice />
        </div>
      </div>

      <UndoBar pending={pending} onUndo={undo} onHold={hold} onRelease={release} />

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
