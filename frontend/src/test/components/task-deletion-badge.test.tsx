import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { TaskDeletionBadge } from "@/components/todos/task-deletion-badge"

const DAY = 24 * 60 * 60 * 1000

/** A completion timestamp whose 30-day window ends at `deleteAt`. */
const completedFor = (deleteAt: Date) => new Date(deleteAt.getTime() - 30 * DAY).toISOString()

describe("TaskDeletionBadge", () => {
  beforeEach(() => {
    // Local 10:00, so "today" and "tomorrow" mean the same thing in any time zone the suite runs in.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date(2026, 9, 6, 10, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("renders nothing when the task has no global completion timestamp", () => {
    const { container } = render(<TaskDeletionBadge completedAt={null} />)
    expect(container.firstChild).toBeNull()
  })

  it("shows a day countdown for a globally-completed task", () => {
    const completed = new Date(Date.now() - 20 * DAY).toISOString() // 10 days left
    render(<TaskDeletionBadge completedAt={completed} />)
    expect(screen.getByText("deletes in 10 days")).toBeTruthy()
  })

  it("exposes the exact deletion date on the accessible label", () => {
    const completed = new Date(Date.now() - 5 * DAY).toISOString()
    render(<TaskDeletionBadge completedAt={completed} />)
    const badge = screen.getByLabelText(/This task is deleted on/)
    expect(badge).toBeTruthy()
  })

  it("reads 'deletes today' when the window ends later today", () => {
    // Eight hours away. Rounding hours up into whole days used to call this "tomorrow".
    render(<TaskDeletionBadge completedAt={completedFor(new Date(2026, 9, 6, 18, 0))} />)
    expect(screen.getByText("deletes today")).toBeTruthy()
  })

  it("reads 'deletes tomorrow' for any time tomorrow (urgent styling)", () => {
    // 37 hours away is still tomorrow, not "in 2 days".
    render(<TaskDeletionBadge completedAt={completedFor(new Date(2026, 9, 7, 23, 0))} />)
    const badge = screen.getByText("deletes tomorrow")
    expect(badge.className).toContain("text-warn")
  })

  it("counts a friend's task the reader completed for themselves, and says it stays with its author", () => {
    // The API reports the reader's own completion time as completedAt for such a task.
    const completed = new Date(Date.now() - 25 * DAY).toISOString() // 5 days left
    render(<TaskDeletionBadge completedAt={completed} personal />)
    const badge = screen.getByText("deletes in 5 days")
    expect(badge.getAttribute("title")).toMatch(/Leaves your completed tasks automatically on .+\. It stays with its author\./)
    expect(screen.getByLabelText(/^Leaves your completed tasks on /)).toBe(badge)
  })

  it("keeps reading 'deletes today' once the window has ended, until the hourly pass removes it", () => {
    const completed = new Date(Date.now() - 35 * DAY).toISOString() // past the window
    render(<TaskDeletionBadge completedAt={completed} />)
    expect(screen.getByText("deletes today")).toBeTruthy()
  })
})
