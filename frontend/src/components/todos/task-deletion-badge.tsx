import { Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { getDeletionCountdown } from "@/utils/deletion-countdown"

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
    daysLeft === 0 ? "удалится сегодня"
    : daysLeft === 1 ? "удалится завтра"
    : `удалится через ${daysLeft} дн.`

  const exactDate = deleteAt.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })

  return (
    <span
      title={`Задача будет автоматически удалена ${exactDate}`}
      aria-label={`Задача будет удалена ${exactDate}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none select-none",
        urgent
          ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300"
          : "border-gray-200 bg-gray-50 text-gray-500 dark:border-white/10 dark:bg-white/5 dark:text-gray-400",
        className,
      )}
    >
      <Clock className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  )
}
