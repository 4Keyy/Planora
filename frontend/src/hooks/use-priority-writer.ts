"use client"

import { useCallback, useEffect, useRef } from "react"
import { announce } from "@/lib/announce"
import { TodoPriorityOrder, type Todo } from "@/types/todo"

/**
 * Setting a priority from a key: shown at once, saved once, never lost, never wrong.
 *
 * A number key is the fastest edit in the product, and people use it that way — `5`,
 * no, `4` — so the write is shaped for bursts:
 *
 * - **Shown at once.** The card takes the new level on the keypress; the server is told
 *   afterwards. Waiting a round trip for a meter to move reads as a dead key.
 * - **Saved once.** Presses on one task within `PRIORITY_SETTLE_MS` collapse into one
 *   request carrying the last of them.
 * - **In order.** A task never has two saves in flight. A level chosen while one is
 *   travelling waits for it and goes next, so a slow first answer cannot land after
 *   the second and put the old level back.
 * - **Honest.** A failed save puts back the level the server holds and says so; an
 *   answer that arrives after a newer press is not allowed to repaint the card.
 *
 * The request carries `{ priority }` and nothing else. The update endpoint applies only
 * the fields it is given (`UpdateTodoCommandHandler`; pinned by a server test), so a
 * one-key edit cannot overwrite a description someone else just changed — and it cannot
 * write back a hidden task's redacted copy, which held no description, no date and no
 * audience and would have saved exactly that.
 */

export const PRIORITY_SETTLE_MS = 200

const NAMES = ["VeryLow", "Low", "Medium", "High", "Urgent"] as const
const LABELS = ["Very low", "Low", "Medium", "High", "Urgent"] as const

/** Any spelling the API or the UI uses for a priority, as 1–5. Unknown reads as Medium. */
export function priorityLevel(priority: Todo["priority"] | number | null | undefined): number {
  return TodoPriorityOrder[String(priority)] ?? 3
}

/** Due today or earlier on the server's UTC calendar (`TodoViewerStateResolver.IsVisuallyUrgent`). */
function dueByToday(dueDate: string | null | undefined, today: Date): boolean {
  if (!dueDate) return false
  const due = new Date(dueDate)
  if (Number.isNaN(due.getTime())) return false
  return (
    Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate()) <=
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  )
}

/**
 * The fields a priority change touches, as the server will compute them: the level, and
 * the red frame, which an Urgent task wears whatever its date.
 */
export function priorityFields(todo: Todo, level: number, today = new Date()): Pick<Todo, "priority" | "isVisuallyUrgent"> {
  return {
    priority: NAMES[level - 1],
    isVisuallyUrgent: level === 5 || dueByToday(todo.dueDate, today),
  }
}

export interface PriorityWriterOptions {
  /** The task as the page holds it now — read through refs, never a stale closure. */
  read: (id: string) => Todo | undefined
  /** Merges fields into every list on the page that holds the task. */
  patch: (id: string, fields: Partial<Todo>) => void
  /** Persists the level; resolves with the server's copy of the task when it sends one. */
  save: (id: string, level: number) => Promise<Todo | null | undefined>
  /** A save failed and the card went back to the server's level. */
  onError?: (id: string) => void
}

interface Entry {
  /** The level the server holds, as far as this page knows. */
  confirmed: number
  /** The level waiting to be saved. */
  wanted: number | null
  timer: ReturnType<typeof setTimeout> | null
  saving: boolean
}

export function usePriorityWriter(options: PriorityWriterOptions): (id: string, level: number) => void {
  const latest = useRef(options)
  latest.current = options
  const entries = useRef(new Map<string, Entry>())

  const flush = useCallback(async (id: string): Promise<void> => {
    const entry = entries.current.get(id)
    if (!entry) return
    if (entry.timer) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
    if (entry.saving || entry.wanted === null) return
    const level = entry.wanted
    if (level === entry.confirmed) {
      // Pressed back to where the server already is: nothing to send.
      entry.wanted = null
      entries.current.delete(id)
      return
    }

    entry.saving = true
    try {
      const saved = await latest.current.save(id, level)
      entry.confirmed = saved?.priority != null ? priorityLevel(saved.priority) : level
      if (entry.wanted === level) {
        entry.wanted = null
        if (saved) {
          const fields: Partial<Todo> = { priority: saved.priority }
          if (typeof saved.isVisuallyUrgent === "boolean") fields.isVisuallyUrgent = saved.isVisuallyUrgent
          if (saved.updatedAt) fields.updatedAt = saved.updatedAt
          latest.current.patch(id, fields)
        }
      }
    } catch {
      // Superseded by a newer press: that one goes next and decides what the card shows.
      if (entry.wanted === level) {
        entry.wanted = null
        const todo = latest.current.read(id)
        if (todo) latest.current.patch(id, priorityFields(todo, entry.confirmed))
        latest.current.onError?.(id)
      }
    } finally {
      entry.saving = false
      if (entry.wanted !== null) {
        if (!entry.timer) void flush(id)
      } else if (!entry.timer) {
        entries.current.delete(id)
      }
    }
  }, [])

  // Leaving the page must not lose a press that was still settling.
  useEffect(() => {
    const map = entries.current
    return () => {
      for (const [id, entry] of map) {
        if (!entry.timer) continue
        clearTimeout(entry.timer)
        entry.timer = null
        void flush(id)
      }
    }
  }, [flush])

  return useCallback((id: string, level: number) => {
    if (!Number.isInteger(level) || level < 1 || level > 5) return
    const todo = latest.current.read(id)
    if (!todo) return
    const shown = priorityLevel(todo.priority)
    let entry = entries.current.get(id)
    if (!entry) {
      entry = { confirmed: shown, wanted: null, timer: null, saving: false }
      entries.current.set(id, entry)
    }
    announce(`Priority ${level} of 5, ${LABELS[level - 1]}`)
    if (level !== shown) latest.current.patch(id, priorityFields(todo, level))
    entry.wanted = level
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      void flush(id)
    }, PRIORITY_SETTLE_MS)
  }, [flush])
}
