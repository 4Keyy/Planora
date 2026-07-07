import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { TaskDeletionBadge } from "@/components/todos/task-deletion-badge"

const DAY = 24 * 60 * 60 * 1000

describe("TaskDeletionBadge", () => {
  it("renders nothing when the task has no global completion timestamp", () => {
    const { container } = render(<TaskDeletionBadge completedAt={null} />)
    expect(container.firstChild).toBeNull()
  })

  it("shows a day countdown for a globally-completed task", () => {
    const completed = new Date(Date.now() - 20 * DAY).toISOString() // ~10 days left
    render(<TaskDeletionBadge completedAt={completed} />)
    expect(screen.getByText(/удалится через \d+ дн\./)).toBeTruthy()
  })

  it("exposes the exact deletion date on the accessible label", () => {
    const completed = new Date(Date.now() - 5 * DAY).toISOString()
    render(<TaskDeletionBadge completedAt={completed} />)
    const badge = screen.getByLabelText(/Задача будет удалена/)
    expect(badge).toBeTruthy()
  })

  it("reads 'удалится завтра' with one day left (urgent styling)", () => {
    const completed = new Date(Date.now() - 29 * DAY).toISOString() // ~1 day left
    render(<TaskDeletionBadge completedAt={completed} />)
    expect(screen.getByText("удалится завтра")).toBeTruthy()
  })

  it("reads 'удалится сегодня' once the window has elapsed", () => {
    const completed = new Date(Date.now() - 35 * DAY).toISOString() // past the window
    render(<TaskDeletionBadge completedAt={completed} />)
    expect(screen.getByText("удалится сегодня")).toBeTruthy()
  })
})
