// Legacy file — re-exports from the redesigned module.
// Import sites (@/components/todos/edit-todo-modal) continue to resolve here
// because TypeScript prefers .tsx over a folder index; this file bridges them.
export { EditTodoModal } from "./edit-todo-modal/index"
export type { EditTodoModalProps } from "./edit-todo-modal/index"
