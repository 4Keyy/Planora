import { TodoSkeleton } from "@/components/todos/todo-skeleton"
import { PageHeaderSkeleton } from "@/components/layout/page-header"
import { CreatePlatePlaceholder, FilterPlatePlaceholder } from "@/components/todos/plate-placeholder"

/**
 * Streaming fallback for /tasks: the header with its two count pills, the two control
 * plates (the collapsed create panel and the quick filter), then the grid — the same
 * stack, gaps and heights as the page, so the real one replaces it without a jump.
 */
export default function TasksLoading() {
  return (
    <div aria-busy="true" className="space-y-6">
      <PageHeaderSkeleton withSentence={false} actions="pills" />
      <CreatePlatePlaceholder />
      <FilterPlatePlaceholder />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <TodoSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}
