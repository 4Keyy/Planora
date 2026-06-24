import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { NotificationBadgeCluster } from "@/components/notifications/notification-badge-cluster"

describe("NotificationBadgeCluster", () => {
  it("renders nothing when there are no groups or zero total", () => {
    const { container } = render(<NotificationBadgeCluster groups={[]} total={0} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders the labeled pill for a single type", () => {
    render(<NotificationBadgeCluster groups={[{ type: "task.review", count: 3 }]} total={3} />)
    const status = screen.getByRole("status")
    // The single-type pill carries the human label, not the cluster's "N types" summary.
    expect(status.getAttribute("aria-label")).toContain("Ready for review")
  })

  it("fans out overlapping discs for several types and announces the spread", () => {
    render(
      <NotificationBadgeCluster
        groups={[
          { type: "task.review", count: 1 },
          { type: "comment.added", count: 2 },
          { type: "subtask.added", count: 1 },
        ]}
        total={4}
      />,
    )
    const status = screen.getByRole("status")
    expect(status.getAttribute("aria-label")).toContain("3 types")
  })

  it("caps visible discs at four and shows a +N overflow pip", () => {
    render(
      <NotificationBadgeCluster
        groups={[
          { type: "task.review", count: 1 },
          { type: "comment.added", count: 1 },
          { type: "subtask.added", count: 1 },
          { type: "subtask.completed", count: 1 },
          { type: "task.completed", count: 1 },
          { type: "task.joined", count: 1 },
        ]}
        total={6}
      />,
    )
    // Six types → four discs + a "+2" overflow pip.
    expect(screen.getByText("+2")).toBeInTheDocument()
  })
})
