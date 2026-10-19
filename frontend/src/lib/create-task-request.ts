import type { TitleRequest } from "@/components/todos/create-todo-panel"
import { isTextEntry } from "@/lib/text-entry"

export const CREATE_TASK_EVENT = "planora:create-task"
const PENDING_MAX_AGE_MS = 5000
let pending: { request: TitleRequest; at: number } | null = null
let lastNonce = 0

/** One request survives navigation to Tasks; the first mounted consumer takes it. */
export function requestNewTask(request: { title?: string } = {}): void {
  const now = Date.now()
  lastNonce = Math.max(now, lastNonce + 1)
  const detail: TitleRequest = { nonce: lastNonce, ...request }
  pending = { request: detail, at: now }
  window.dispatchEvent(new CustomEvent<TitleRequest>(CREATE_TASK_EVENT, { detail }))
}

export function takeCreateTaskRequest(): TitleRequest | null {
  const held = pending
  pending = null
  return held && Date.now() - held.at <= PENDING_MAX_AGE_MS ? held.request : null
}

/** Shared by task creation and Categories' page-local C binding. */
export function canHandleCreateShortcut(event: KeyboardEvent): boolean {
  if (event.code !== "KeyC" || event.defaultPrevented || event.repeat || event.isComposing) return false
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || isTextEntry(event.target)) return false
  return !Array.from(document.querySelectorAll(
    "[role='dialog'], [role='alertdialog'], [aria-modal='true'], [role='menu'], [role='listbox']",
  )).some(element => !element.closest("[hidden], [inert], [aria-hidden='true'], [data-state='closed']"))
}
