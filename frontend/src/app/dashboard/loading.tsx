import { TodoSkeleton } from "@/components/todos/todo-skeleton"

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="h-14 w-2/3 max-w-md animate-pulse rounded-2xl bg-gray-100" />
      <div className="grid gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <TodoSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}
