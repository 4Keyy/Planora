import { TodoSkeleton } from "@/components/todos/todo-skeleton"
import { CreatePlatePlaceholder } from "@/components/todos/plate-placeholder"

/**
 * The dashboard's frame while it streams, built from the same layout classes as the page
 * rather than a fixed-height block: the overview card with its padding, its two columns
 * (stacked under `lg`), the eyebrow, title and filter row on the left and the ring beside
 * the week on the right; then the "Active tasks" row, the create plate and the grid. Its
 * height therefore follows the viewport the way the real card's does.
 */
const bar = "inline-block rounded-sm bg-paper-sunken"

export default function DashboardLoading() {
  return (
    // Two elements: the outer one is shown only once the wait is long enough to notice
    // (`.skeleton-defer`), the inner one pulses — one `animation` each, or one would win.
    <div aria-busy="true" aria-hidden="true" className="skeleton-defer">
      <div className="animate-pulse space-y-10">
        <div className="rounded-xl border border-line bg-paper p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-caption">
                <span className={`${bar} w-20`}>&nbsp;</span>
              </p>
              <p className="mt-2 text-title font-bold sm:text-display-sm">
                <span className={`${bar} w-72 max-w-full rounded-md`}>&nbsp;</span>
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <div className="h-10 w-28 rounded-md bg-paper-sunken" />
                <div className="h-10 w-32 rounded-md bg-paper-sunken" />
                <div className="h-10 w-28 rounded-md bg-paper-sunken" />
              </div>
            </div>
            <div className="flex items-center gap-6 border-t border-line pt-6 lg:w-96 lg:flex-shrink-0 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
              <div className="h-24 w-24 flex-shrink-0 rounded-full bg-paper-sunken" />
              <div className="min-w-0 flex-1">
                <p className="text-caption">
                  <span className={`${bar} w-16`}>&nbsp;</span>
                </p>
                <p className="mt-1 text-title font-bold">
                  <span className={`${bar} w-28`}>&nbsp;</span>
                </p>
                <div className="mt-3 h-14 rounded-sm bg-paper-sunken" />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="flex min-h-control items-center justify-between">
            <p className="text-title-sm font-bold">
              <span className={`${bar} w-40`}>&nbsp;</span>
            </p>
          </div>
          <CreatePlatePlaceholder />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <TodoSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
