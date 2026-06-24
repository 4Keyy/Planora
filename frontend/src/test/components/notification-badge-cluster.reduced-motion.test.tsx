import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

// Exercise the reduced-motion branches: every animated prop has a `reduce ? … : …` ternary.
vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>()
  return { ...actual, useReducedMotion: () => true }
})

import { NotificationBadgeCluster } from "@/components/notifications/notification-badge-cluster"

describe("NotificationBadgeCluster (reduced motion)", () => {
  it("renders the single-type pill without motion", () => {
    render(<NotificationBadgeCluster groups={[{ type: "task.review", count: 2 }]} total={2} />)
    expect(screen.getByRole("status").getAttribute("aria-label")).toContain("Ready for review")
  })

  it("renders the multi-disc cluster with the overflow pip and no motion", () => {
    render(
      <NotificationBadgeCluster
        groups={[
          { type: "task.review", count: 1 },
          { type: "comment.added", count: 1 },
          { type: "subtask.added", count: 1 },
          { type: "subtask.completed", count: 1 },
          { type: "task.completed", count: 1 },
        ]}
        total={5}
        pulse={false}
      />,
    )
    expect(screen.getByRole("status").getAttribute("aria-label")).toContain("5 types")
    expect(screen.getByText("+1")).toBeInTheDocument()
  })
})
