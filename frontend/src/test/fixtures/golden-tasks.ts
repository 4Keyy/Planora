import { TodoPriority } from "@/types/todo"
import type { SortableTask } from "@/utils/sort-tasks"

/** A Wednesday leaves separate tomorrow, current-week and future buckets. */
export function goldenNow(): Date {
  return new Date(2026, 9, 21, 12)
}

/** Calendar offsets preserve local days across time zones and daylight-saving changes. */
function localDate(days: number, hour = 9): string {
  const today = goldenNow()
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + days, hour).toISOString()
}

export function goldenTasks(): SortableTask[] {
  const task = (id: string, fields: Partial<SortableTask> = {}): SortableTask => ({
    id,
    title: id,
    priority: TodoPriority.Medium,
    createdAt: localDate(-10),
    ...fields,
  })
  const heldCreated = localDate(-6)
  const heldDue = localDate(1)
  const heldCreatedKey = -new Date(heldCreated).getTime()

  // Interleaving bands makes the expected order independent of the fixture's presentation.
  // Equal-key pairs intentionally remain in their input order, including missing completion dates.
  return [
    task("r-week", { dueDate: localDate(3) }),
    task("s-hidden", { hidden: true, isPublic: true }),
    task("u-today-low", { dueDate: localDate(0), priority: TodoPriority.Low, isVisuallyUrgent: null }),
    task("c-new", { isCompleted: true, completedAt: localDate(-1), isVisuallyUrgent: true, hidden: true }),
    task("p-hidden", { hidden: true, priority: TodoPriority.High }),
    task("r-invalid-equal-a", { dueDate: "not-a-date", priority: TodoPriority.Low, createdAt: localDate(-8) }),
    task("s-overdue-muted", { hasSharedAudience: true, dueDate: localDate(-2), isVisuallyUrgent: false }),
    task("u-hidden-flag", { hidden: true, isVisuallyUrgent: true }),
    task("p-high-week", { priority: TodoPriority.High, dueDate: localDate(3) }),
    task("r-working", { status: "inprogress", dueDate: localDate(9) }),
    task("u-overdue-medium", { dueDate: localDate(-5), isVisuallyUrgent: null }),
    task("s-week-flag", { hasSharedAudience: true, isPublic: false, dueDate: localDate(3) }),
    task("r-undated-new", { createdAt: localDate(-4) }),
    task("p-urgent-muted", { priority: TodoPriority.Urgent, isVisuallyUrgent: false, dueDate: localDate(-4) }),
    task("s-working", { isWorking: true, hasSharedAudience: true, dueDate: localDate(10) }),
    task("r-hidden", { hidden: true }),
    task("u-no-due", { priority: TodoPriority.Urgent }),
    task("c-no-completed", { status: "Completed", createdAt: localDate(-9) }),
    task("r-tomorrow", { dueDate: localDate(1) }),
    task("s-today-muted", { isPublic: true, dueDate: localDate(0), isVisuallyUrgent: false }),
    task("u-working-today", { isWorking: true, priority: TodoPriority.High, dueDate: localDate(0), isVisuallyUrgent: true }),
    task("p-high-no-due", { priority: TodoPriority.High }),
    task("s-undated-list", { sharedWithUserIds: ["friend-b"] }),
    task("r-overdue-muted", { dueDate: localDate(-1), isVisuallyUrgent: false }),
    task("u-overdue-urgent-priority", { priority: TodoPriority.Urgent, dueDate: localDate(-1), isVisuallyUrgent: null }),
    task("r-held-opened", {
      dueDate: heldDue,
      createdAt: heldCreated,
      heldPlace: {
        place: [3, 1, 1, 3, Infinity, 2, heldCreatedKey],
        open: [3, 0, 1, 2, 2, new Date(heldDue).getTime(), heldCreatedKey],
      },
    }),
    task("p-working", { priority: TodoPriority.High, isWorking: true, dueDate: localDate(8) }),
    task("u-flag-true-future", { priority: TodoPriority.VeryLow, dueDate: localDate(8), isVisuallyUrgent: true }),
    task("r-today-muted", { dueDate: localDate(0), isVisuallyUrgent: false }),
    task("s-invalid-shared", { hasSharedAudience: true, dueDate: "not-a-date" }),
    task("p-high-overdue-muted", { priority: TodoPriority.High, dueDate: localDate(-2), isVisuallyUrgent: false }),
    task("r-undated-equal-b", { priority: TodoPriority.Low, createdAt: localDate(-8) }),
    task("u-hidden-working", { hidden: true, isWorking: true, priority: TodoPriority.Urgent }),
    task("s-future-public", { isPublic: true, dueDate: localDate(8) }),
    task("c-status-done", { status: "Done", completedAt: localDate(-2) }),
    task("r-future", { dueDate: localDate(8) }),
    task("u-today-urgent", { priority: TodoPriority.Urgent, dueDate: localDate(0) }),
    task("s-tomorrow-list", { sharedWithUserIds: ["friend-a"], dueDate: localDate(1) }),
    task("p-hidden-working", { hidden: true, priority: TodoPriority.High, status: "inprogress" }),
    task("r-undated", { dueDate: null }),
    task("u-overdue-high", { priority: TodoPriority.High, dueDate: localDate(-3) }),
    task("r-authoritative-private", { hasSharedAudience: false, isPublic: true, sharedWithUserIds: ["friend-c"], dueDate: localDate(9) }),
    task("p-high-tomorrow", { priority: TodoPriority.High, dueDate: localDate(1) }),
    task("c-invalid-completed", { isCompleted: true, completedAt: "not-a-date", createdAt: localDate(-1) }),
    task("s-hidden-working", { hidden: true, hasSharedAudience: true, isWorking: true }),
    task("u-urgent-tomorrow", { priority: TodoPriority.Urgent, dueDate: localDate(1) }),
    task("r-hidden-working", { hidden: true, isWorking: true }),
    task("u-working-overdue", { status: "inprogress", dueDate: localDate(-2), priority: TodoPriority.Low }),
  ]
}
