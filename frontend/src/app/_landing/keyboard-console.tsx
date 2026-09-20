"use client"

import { useState } from "react"
import { TodoCard } from "@/components/todos/todo-card"
import { UndoBar, useUndoableAction } from "@/components/ui/undo-bar"
import { useListNavigation } from "@/hooks/use-list-navigation"
import { FIELD_LABEL_CLASS } from "@/components/ui/field"
import { CONSOLE_TASKS, FIXTURE_OWNER_ID } from "./fixtures"
import type { Todo } from "@/types/todo"
import { cn } from "@/lib/utils"

const KEYS: { keys: string; does: string }[] = [
  { keys: "J K", does: "Move the cursor" },
  { keys: "Space", does: "Complete or reopen" },
  { keys: "1–5", does: "Set priority" },
  { keys: "Delete", does: "Delete, with five seconds to undo" },
  { keys: "?", does: "The keyboard map itself" },
]

/**
 * Block 4 — the product, driven by the keyboard, on fixtures.
 *
 * One list, one mount site, three lessons. `TodoCard` is 1084 lines and pulls in the
 * celebration, the confirm dialog, the notification store, the icon map and
 * `shared-origin`; mounting it in three separate blocks would pay that three times.
 *
 * Two things that are easy to break here.
 *
 * `useListNavigation` is single-instance per page by construction: the first listener's
 * `preventDefault()` trips the second's `defaultPrevented` guard, so a second list on
 * this route would go deaf. This is the only one on `/`.
 *
 * `<ShortcutsHelp/>` is already mounted in `app/layout.tsx` with a global capture-phase
 * `?` listener, so `?` already opens the product's real shortcut map on this page. A
 * second copy would double-toggle the very overlay this block uses as proof — so this
 * block mounts nothing and simply says to press the key.
 */
export function KeyboardConsole() {
  const [tasks, setTasks] = useState<Todo[]>(CONSOLE_TASKS)
  const { pending, run, undo } = useUndoableAction()

  const setPriority = (id: string, level: number) =>
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, priority: String(level) } : t)))

  const toggleComplete = (id: string) =>
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, isCompleted: !t.isCompleted, status: t.isCompleted ? "Todo" : "Done" }
          : t
      )
    )

  const remove = (id: string) => {
    const victim = tasks.find((t) => t.id === id)
    if (!victim) return
    const index = tasks.findIndex((t) => t.id === id)
    setTasks((prev) => prev.filter((t) => t.id !== id))
    run({
      label: "Task deleted",
      // Nothing is sent anywhere: on this page the "request" is the fixture staying gone.
      commit: () => {},
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
    onToggleComplete: toggleComplete,
    onDelete: remove,
    onPriority: setPriority,
  })

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-10">
      <div>
        <div className="flex flex-col gap-3">
          {tasks.map((task) => (
            <TodoCard
              key={task.id}
              todo={task}
              viewerId={FIXTURE_OWNER_ID}
              rowProps={nav.getRowProps(task.id)}
              onComplete={() => toggleComplete(task.id)}
              onDelete={() => remove(task.id)}
              onEdit={() => {}}
            />
          ))}
        </div>

        {tasks.length === 0 && (
          <div className="rounded-lg border border-line bg-paper-sunken p-8 text-center">
            <p className="text-body-sm font-semibold text-ink">Everything is gone.</p>
            <p className="mt-1 text-body-sm text-ink-subtle">
              Undo brings the last one back, or reload the page to start over.
            </p>
          </div>
        )}
      </div>

      <div>
        <p className={FIELD_LABEL_CLASS}>Keys, on this page</p>
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
      </div>

      <UndoBar pending={pending} onUndo={undo} />
    </div>
  )
}
