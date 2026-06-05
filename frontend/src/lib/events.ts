/** Custom DOM events dispatched across the app via window.dispatchEvent / window.addEventListener */
import type { Todo } from "@/types/todo"

export const TASK_CREATED_EVENT = "planora:task-created" as const

/**
 * Payload carried on a {@link TASK_CREATED_EVENT}. When the creating surface
 * (e.g. the navbar quick-create) already has the created task, it ships it on
 * the event so listeners can render it instantly — optimistically — before the
 * authoritative background refetch reconciles the list.
 */
export interface TaskCreatedDetail {
  todo?: Todo
}

/** Dispatch a task-created event, optionally with the freshly created task. */
export function dispatchTaskCreated(todo?: Todo): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<TaskCreatedDetail>(TASK_CREATED_EVENT, { detail: { todo } }))
}
