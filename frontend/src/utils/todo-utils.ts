import { type Todo } from "@/types/todo"

/**
 * When the user removes a category the backend PUT silently ignores null categoryId
 * and echoes back the old values. This helper overlays all four category fields with null
 * so the UI immediately reflects the user's intent regardless of the API response.
 */
export function applyCategoryPatch(todo: Todo, incomingCategoryId: string | null | undefined): Todo {
  if (incomingCategoryId !== null) return todo
  return { ...todo, categoryId: null, categoryName: null, categoryColor: null, categoryIcon: null }
}
