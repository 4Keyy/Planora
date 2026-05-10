export enum TodoStatus {
  Pending = "Pending",
  InProgress = "InProgress",
  Done = "Done",
  Completed = "Completed",
  Cancelled = "Cancelled",
}

/**
 * Backend accepts only: "todo" | "inprogress" | "done" (case-insensitive).
 * Frontend historically used additional aliases; this helper normalizes them for API writes.
 */
export function toApiTodoStatus(status: TodoStatus | string | null | undefined): "todo" | "inprogress" | "done" {
  const s = String(status ?? "").toLowerCase()

  if (s === "todo" || s === "pending") return "todo"
  if (s === "inprogress" || s === "in progress") return "inprogress"
  if (s === "done" || s === "completed") return "done"

  // Default safe status
  return "todo"
}

export function isCompletedTodoStatus(status: TodoStatus | string | null | undefined): boolean {
  const s = String(status ?? "").toLowerCase()
  return s === "done" || s === "completed"
}

export enum TodoPriority {
  VeryLow = "VeryLow",
  Low = "Low",
  Medium = "Medium",
  High = "High",
  Urgent = "Urgent",
}

// Legacy aliases for backward compat
export const TodoStatusLabels: Record<string, string> = {
  Pending: "Pending",
  pending: "Pending",
  InProgress: "In Progress",
  inprogress: "In Progress",
  Done: "Done",
  done: "Done",
  Completed: "Done",
  completed: "Done",
  Cancelled: "Cancelled",
  cancelled: "Cancelled",
}

export const TodoPriorityLabels: Record<string, string> = {
  VeryLow: "Very Low",
  Low: "Low",
  Medium: "Medium",
  High: "High",
  Urgent: "Urgent",
  // Legacy numeric values from backend
  "1": "Very Low",
  "2": "Low",
  "3": "Medium",
  "4": "High",
  "5": "Urgent",
  // Legacy names
  Critical: "Urgent",
}

export const TodoPriorityOrder: Record<string, number> = {
  VeryLow: 1, Low: 2, Medium: 3, High: 4, Urgent: 5, Critical: 5,
  "1": 1, "2": 2, "3": 3, "4": 4, "5": 5,
}

export type Todo = {
  id: string
  userId: string
  title: string
  description?: string | null
  status: TodoStatus | string
  categoryId?: string | null
  dueDate?: string | null
  expectedDate?: string | null
  actualDate?: string | null
  priority: TodoPriority | string
  isPublic: boolean
  isCompleted: boolean
  hidden?: boolean
  completedAt?: string | null
  isOnTime?: boolean | null
  delay?: string | null
  tags: string[]
  createdAt: string
  updatedAt?: string | null
  categoryName?: string | null
  categoryColor?: string | null
  categoryIcon?: string | null
  authorName?: string | null
  sharedWithUserIds?: string[] | null
  hasSharedAudience?: boolean | null
  isVisuallyUrgent?: boolean | null
  requiredWorkers?: number | null
  workerCount?: number
  isWorking?: boolean
  workerUserIds?: string[] | null
}

export type PagedTodosResponse = {
  items: Todo[]
  totalCount: number
}

export type TodoComment = {
  id: string
  todoItemId: string
  authorId: string
  authorName: string
  content: string
  createdAt: string
  updatedAt?: string | null
  isOwn: boolean
  isEdited: boolean
}

export type CreateTodoPayload = {
  userId?: string | null
  title: string
  description?: string | null
  categoryId?: string | null
  dueDate?: string | null
  priority?: number
  isPublic?: boolean
  sharedWithUserIds?: string[]
  tags?: string[]
  requiredWorkers?: number | null
}

export type UpdateTodoPayload = {
  title?: string
  description?: string | null
  categoryId?: string | null
  dueDate?: string | null
  priority?: number
  isPublic?: boolean
  sharedWithUserIds?: string[]
  status?: "todo" | "inprogress" | "done"
  requiredWorkers?: number | null
  clearRequiredWorkers?: boolean
}

const EMPTY_GUID = "00000000-0000-0000-0000-000000000000"

export function sameUserId(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false
  const normalizedLeft = left.toLowerCase()
  const normalizedRight = right.toLowerCase()
  return normalizedLeft !== EMPTY_GUID && normalizedLeft === normalizedRight
}

export function isTodoOwner(todo: Pick<Todo, "userId">, viewerId: string | null | undefined): boolean {
  return sameUserId(todo.userId, viewerId)
}
