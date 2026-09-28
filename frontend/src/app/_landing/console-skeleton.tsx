import { TodoSkeleton } from "@/components/todos/todo-skeleton"
import { FIELD_LABEL_CLASS } from "@/components/ui/field"

/**
 * The console's footprint, held while the sandbox waits for the session restore.
 *
 * Same grid, same three rows, same legend column as `KeyboardConsole`, so the swap to the
 * real block moves nothing below it. Kept out of `keyboard-console.tsx` on purpose: that
 * module is code-split, and the placeholder has to render in the first response rather
 * than after the split chunk arrives.
 */
export function ConsoleSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-10">
      <div className="flex flex-col gap-3">
        <TodoSkeleton />
        <TodoSkeleton />
        <TodoSkeleton />
      </div>
      <div>
        <p className={FIELD_LABEL_CLASS}>Bound on this page</p>
        <div className="mt-3 flex flex-col gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-7 rounded-sm bg-paper-sunken" />
          ))}
        </div>
      </div>
    </div>
  )
}
