import { Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { getDeletionCountdown } from "@/utils/deletion-countdown"
import { formatDateLong } from "@/lib/datetime"

interface TaskDeletionBadgeProps {
  /** The task's global completion timestamp (`todo.completedAt`). */
  completedAt?: string | null
  className?: string
}

/**
 * Small, non-intrusive pill on a completed task that tells the user it will be auto-deleted, and when.
 * Renders nothing unless the task is actually on the deletion path (a global completion timestamp is
 * present); a viewer-only completion has no `completedAt` and is hidden rather than deleted, so no badge
 * appears. The colour warms up in the final three days. The exact date lives in the tooltip / aria-label.
 */
export function TaskDeletionBadge({ completedAt, className }: TaskDeletionBadgeProps) {
  const info = getDeletionCountdown(completedAt)
  if (!info) return null

  const { daysLeft, deleteAt } = info
  const urgent = daysLeft <= 3

  const label =
    daysLeft === 0 ? "deletes today"
    : daysLeft === 1 ? "deletes tomorrow"
    : `deletes in ${daysLeft} days`

  const exactDate = formatDateLong(deleteAt.toISOString())

  return (
    <span
      title={`This task is deleted automatically on ${exactDate}`}
      aria-label={`This task is deleted on ${exactDate}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption font-medium leading-none select-none",
        urgent
          ? "border-warn-surface bg-warn-surface text-warn"
          : "border-line bg-paper-sunken text-ink-subtle",
        className,
      )}
    >
      <Clock className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  )
}
