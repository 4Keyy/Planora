import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { NotificationBadge } from "@/components/notifications/notification-badge"

describe("NotificationBadge", () => {
  afterEach(() => vi.restoreAllMocks())

  it("labels a known type", () => {
    render(<NotificationBadge type="comment.added" />)
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "New message")
  })

  it("renders the people+check composite for participants-done", () => {
    const { container } = render(<NotificationBadge type="task.participants_done" />)
    // The Users glyph plus the Check disc → at least two svgs.
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(2)
  })

  it("shows a count bubble when showCount and count > 1", () => {
    render(<NotificationBadge type="comment.added" count={5} showCount />)
    expect(screen.getByText("5")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", expect.stringContaining("5 unread"))
  })

  it("caps the count at 99+", () => {
    render(<NotificationBadge type="comment.added" count={150} showCount />)
    expect(screen.getByText("99+")).toBeInTheDocument()
  })

  it("omits the bubble for a single unread", () => {
    render(<NotificationBadge type="comment.added" count={1} showCount />)
    expect(screen.queryByText("1")).not.toBeInTheDocument()
  })

  it("uses the plain label when showCount but count is zero", () => {
    render(<NotificationBadge type="comment.added" count={0} showCount />)
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "New message")
  })

  it("falls back to a generic label for an unknown type", () => {
    render(<NotificationBadge type="nope.nope" />)
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Notification")
  })

  it("renders with the pulse disabled", () => {
    const { container } = render(<NotificationBadge type="task.review" pulse={false} />)
    expect(container.querySelector("[role='status']")).toBeInTheDocument()
  })

  it("respects reduced motion", () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as typeof window.matchMedia
    render(<NotificationBadge type="comment.added" count={3} showCount />)
    expect(screen.getByText("3")).toBeInTheDocument()
  })
})
