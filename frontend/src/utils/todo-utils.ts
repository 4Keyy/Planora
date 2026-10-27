import { EMPTY_GUID, type Todo } from "@/types/todo"

/**
 * When the user removes a category the backend PUT silently ignores null categoryId
 * and echoes back the old values. This helper overlays all four category fields with null
 * so the UI immediately reflects the user's intent regardless of the API response.
 */
export function applyCategoryPatch(todo: Todo, incomingCategoryId: string | null | undefined): Todo {
  if (incomingCategoryId !== null && incomingCategoryId !== EMPTY_GUID) return todo
  return { ...todo, categoryId: null, categoryName: null, categoryColor: null, categoryIcon: null }
}

/**
 * Puts a task back where it was taken from — at `index`, or at the end when that place is gone —
 * unless the list already holds it again. Undoing a deletion, or a deletion the server refused,
 * restores a card this way: in place, rather than on top.
 */
export function putBack(list: Todo[], todo: Todo, index: number): Todo[] {
  if (list.some((t) => t.id === todo.id)) return list
  const next = [...list]
  next.splice(index < 0 || index > next.length ? next.length : index, 0, todo)
  return next
}
