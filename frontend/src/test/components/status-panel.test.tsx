import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { AlertTriangle, Inbox } from "lucide-react"
import { StatusPanel } from "@/components/ui/status-panel"

describe("StatusPanel", () => {
  it("renders the title as a heading by default", () => {
    render(<StatusPanel title="No tasks yet" />)
    expect(screen.getByRole("heading", { name: "No tasks yet", level: 2 })).toBeInTheDocument()
  })

  it("renders the title as plain text when the section already has a heading", () => {
    // A second heading inside an already-titled sub-panel puts a phantom level in
    // the page outline, which is what a screen-reader user navigates by.
    render(<StatusPanel as="p" title="No active sessions" />)
    expect(screen.queryByRole("heading")).toBeNull()
    expect(screen.getByText("No active sessions")).toBeInTheDocument()
  })

  it("announces a failure but not an empty state", () => {
    // A failure replaces content the user was waiting for, so assistive tech has
    // to hear about it. An empty state is just the page's normal content.
    const { rerender } = render(<StatusPanel tone="alert" title="Couldn't load your tasks" />)
    const alert = screen.getByRole("status")
    expect(alert).toHaveAttribute("aria-live", "polite")

    rerender(<StatusPanel tone="neutral" title="No tasks yet" />)
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("hides the icon from assistive tech", () => {
    const { container } = render(<StatusPanel icon={Inbox} title="Empty" />)
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
  })

  it("runs the primary action on click", async () => {
    const onClick = vi.fn()
    render(<StatusPanel title="Failed" action={{ label: "Try again", onClick }} />)
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("renders an href action as a link, not a button", () => {
    render(<StatusPanel title="Nothing here" action={{ label: "Go to active tasks", href: "/tasks" }} />)
    const link = screen.getByRole("link", { name: "Go to active tasks" })
    expect(link).toHaveAttribute("href", "/tasks")
  })

  it("blocks a second click while the action is in flight", async () => {
    const onClick = vi.fn()
    render(<StatusPanel title="Failed" action={{ label: "Try again", onClick, loading: true }} />)
    const button = screen.getByRole("button", { name: "Try again" })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("aria-busy", "true")
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it("shows both actions when both are given", () => {
    render(
      <StatusPanel
        title="Something went wrong"
        action={{ label: "Retry", onClick: vi.fn() }}
        secondaryAction={{ label: "Back to dashboard", href: "/dashboard" }}
      />
    )
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toBeInTheDocument()
  })

  it("shows a reference id but never a raw error message", () => {
    // The digest is an opaque id a user can quote. `error.message` can carry a
    // stack trace or another user's data and means nothing to the reader, so the
    // component offers no way to put it here.
    render(<StatusPanel tone="alert" title="Something went wrong" referenceId="abc123" />)
    expect(screen.getByText(/abc123/)).toBeInTheDocument()
  })

  it("omits the reference line entirely when there is no digest", () => {
    render(<StatusPanel tone="alert" title="Something went wrong" />)
    expect(screen.queryByText(/Reference id/)).toBeNull()
  })

  it("omits the action row when there is nothing to do", () => {
    const { container } = render(<StatusPanel title="No active tasks" />)
    expect(container.querySelectorAll("button, a")).toHaveLength(0)
  })

  it("never uses ink-faint for text", () => {
    // 2.52:1 — it fails WCAG 1.4.3 at any size and is reserved for dividers.
    const { container } = render(
      <StatusPanel tone="alert" icon={AlertTriangle} title="Failed" description="Try again" referenceId="x1" />
    )
    expect(container.querySelector(".text-ink-faint")).toBeNull()
  })

  it("scales the icon plate with the size", () => {
    const { container: page } = render(<StatusPanel size="page" icon={Inbox} title="t" />)
    expect(page.querySelector(".h-16")).not.toBeNull()

    const { container: compact } = render(<StatusPanel size="compact" icon={Inbox} title="t" />)
    expect(compact.querySelector(".h-11")).not.toBeNull()
  })
})
