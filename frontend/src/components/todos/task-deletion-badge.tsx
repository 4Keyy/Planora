import { Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { getDeletionCountdown } from "@/utils/deletion-countdown"
import { formatDateLong } from "@/lib/datetime"

interface TaskDeletionBadgeProps {
  /** When the task became completed for the reader (`todo.completedAt`). */
  completedAt?: string | null
  /**
   * The reader completed a friend's task only for themselves. When the window ends it leaves the
   * reader's lists, not the author's, and the tooltip says so.
   */
  personal?: boolean
  className?: string
}

/**
 * Small, non-intrusive pill on a completed task that tells the user it will be auto-deleted, and when.
 * Renders nothing without a completion time. A friend's task the reader completed only for themselves
 * carries the reader's own completion time as `completedAt`, because retention counts their 30 days
 * from that moment and then removes the task from their lists — so it shows the same countdown, with a
 * tooltip saying it stays with its author. The colour warms up in the final three days. The exact date
 * lives in the tooltip / aria-label.
 */
export function TaskDeletionBadge({ completedAt, personal = false, className }: TaskDeletionBadgeProps) {
  const info = getDeletionCountdown(completedAt)
  if (!info) return null

  const { daysLeft, deleteAt } = info
  const urgent = daysLeft <= 3

  const label =
    daysLeft === 0 ? "deletes today"
    : daysLeft === 1 ? "deletes tomorrow"
    : `deletes in ${daysLeft} days`

  const exactDate = formatDateLong(deleteAt.toISOString())
  const title = personal
    ? `Leaves your completed tasks automatically on ${exactDate}. It stays with its author.`
    : `This task is deleted automatically on ${exactDate}`
  const spoken = personal
    ? `Leaves your completed tasks on ${exactDate}`
    : `This task is deleted on ${exactDate}`

  return (
    <span
      title={title}
      aria-label={spoken}
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
