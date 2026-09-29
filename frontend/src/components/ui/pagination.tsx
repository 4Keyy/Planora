import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { pageWindow } from "@/lib/pagination"
import { cn } from "@/lib/utils"

/**
 * The pager, once.
 *
 * The dashboard and the completed list each hand-built one, and they had drifted into
 * the loudest control on either screen: an active page scaled to 110% under a black
 * gradient and a 30%-black shadow, page numbers that grew by 15% on hover, and
 * "Previous"/"Next" buttons that grew by 5% in a wrapper of their own — three
 * different scales moving at once under the pointer. Here nothing grows: the current
 * page is ink, the others are quiet, and every target is at least 44px.
 */
export function Pagination({
  page,
  totalPages,
  onChange,
  className,
}: {
  page: number
  totalPages: number
  onChange: (page: number) => void
  className?: string
}) {
  if (totalPages <= 1) return null
  const slots = pageWindow(page, totalPages)

  return (
    <nav aria-label="Pagination" className={cn("flex items-center justify-center gap-2", className)}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
        className="px-3"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Previous</span>
      </Button>

      {/* gap-2: `.touch-target` needs 8px between neighbours, or each button's 44px hit area
          covers the edge of the next one. */}
      <ol className="flex items-center gap-2">
        {slots.map((slot, i) =>
          slot === "gap" ? (
            <li key={`gap-${i}`} aria-hidden="true" className="w-9 text-center text-body-sm text-ink-subtle">
              …
            </li>
          ) : (
            <li key={slot}>
              <button
                type="button"
                onClick={() => onChange(slot)}
                aria-current={slot === page ? "page" : undefined}
                aria-label={`Page ${slot}`}
                className={cn(
                  "touch-target h-9 min-w-9 rounded-md px-2 text-body-sm font-semibold tabular-nums transition-colors duration-fast",
                  slot === page ? "bg-ink text-paper" : "text-ink-muted hover:bg-paper-sunken hover:text-ink",
                )}
              >
                {slot}
              </button>
            </li>
          ),
        )}
      </ol>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="Next page"
        className="px-3"
      >
        <span className="hidden sm:inline">Next</span>
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </nav>
  )
}
