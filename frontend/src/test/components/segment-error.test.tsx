import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SegmentError } from "@/components/ui/segment-error"
import { MotionPreferencesProvider } from "@/components/motion-preferences-provider"
import { reportClientError } from "@/lib/client-errors"

vi.mock("@/lib/client-errors", () => ({ reportClientError: vi.fn() }))

// next/link renders a plain anchor in jsdom; mock keeps the test free of the
// App Router runtime while preserving href/children for assertions.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

describe("SegmentError", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders the friendly message scoped to the segment label", () => {
    render(<SegmentError error={new Error("boom")} reset={vi.fn()} segmentLabel="tasks" />)

    expect(screen.getByText(/Something went wrong while loading tasks\./i)).toBeInTheDocument()
    // SECURITY: the raw error.message must never reach the user (PII / stack-trace leak).
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument()
  })

  it("reports the error through console.error for the global reporter", () => {
    const error = new Error("internal detail")
    render(<SegmentError error={error} reset={vi.fn()} segmentLabel="profile" />)

    // Logged as a description (name, message, stack), never as the raw object: an Axios error
    // reaching a boundary would carry its bearer token in `config`.
    expect(console.error).toHaveBeenCalledWith(
      "[profile] segment-level error",
      expect.objectContaining({ name: "Error", message: "internal detail", stack: expect.any(String) }),
    )
  })

  it("reports the crash to the service logs with the digest it shows", () => {
    const error = Object.assign(new Error("internal detail"), { digest: "1742815393" })
    render(<SegmentError error={error} reset={vi.fn()} segmentLabel="tasks" />)

    expect(reportClientError).toHaveBeenCalledWith(error, "segment", "1742815393")
  })

  it("shows the digest reference id only when present", () => {
    const { rerender } = render(
      <SegmentError
        error={Object.assign(new Error("x"), { digest: "abc123" })}
        reset={vi.fn()}
        segmentLabel="tasks"
      />,
    )
    expect(screen.getByText("abc123")).toBeInTheDocument()

    rerender(<SegmentError error={new Error("x")} reset={vi.fn()} segmentLabel="tasks" />)
    expect(screen.queryByText(/Reference id/i)).not.toBeInTheDocument()
  })

  it("invokes reset when Retry is ticked, once its check has drawn", async () => {
    const reset = vi.fn()
    render(<SegmentError error={new Error("x")} reset={reset} segmentLabel="tasks" />)

    fireEvent.click(screen.getByRole("button", { name: /retry/i }))
    await waitFor(() => expect(reset).toHaveBeenCalledTimes(1))
  })

  it("says so when the connection is gone, and retries by itself when it comes back", async () => {
    const reset = vi.fn()
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
    render(<SegmentError error={new Error("x")} reset={reset} segmentLabel="tasks" />)
    expect(screen.getByRole("heading", { name: "You're offline." })).toBeInTheDocument()

    onLine.mockReturnValue(true)
    act(() => {
      window.dispatchEvent(new Event("online"))
    })
    expect(screen.getByRole("heading", { name: "Back online." })).toBeInTheDocument()
    await waitFor(() => expect(reset).toHaveBeenCalledTimes(1))
  })

  it("offers an escape hatch back to the dashboard", () => {
    render(<SegmentError error={new Error("x")} reset={vi.fn()} segmentLabel="tasks" />)

    expect(screen.getByRole("link", { name: /back to dashboard/i })).toHaveAttribute(
      "href",
      "/dashboard",
    )
  })
})

describe("MotionPreferencesProvider", () => {
  it("renders its children inside the motion config boundary", () => {
    render(
      <MotionPreferencesProvider>
        <span>animated child</span>
      </MotionPreferencesProvider>,
    )

    expect(screen.getByText("animated child")).toBeInTheDocument()
  })
})
