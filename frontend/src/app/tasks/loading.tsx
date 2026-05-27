import { TodoSkeleton } from "@/components/todos/todo-skeleton"

// Streaming fallback for /tasks. React renders this while the segment's
// async tree is suspending. Six skeleton rows match the typical viewport
// the page resolves with.
export default function TasksLoading() {
  return (
    <div className="space-y-4">
      <div className="h-12 w-2/3 max-w-md animate-pulse rounded-2xl bg-gray-100" />
      <div className="grid gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <TodoSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}
