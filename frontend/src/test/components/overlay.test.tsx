import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Overlay } from "@/components/ui/overlay"
import { useScrollLock } from "@/hooks/use-scroll-lock"

beforeEach(() => {
  document.body.style.overflow = ""
  document.body.style.paddingRight = ""
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("Overlay", () => {
  it("renders nothing while closed", () => {
    render(<Overlay open={false} onClose={vi.fn()} title="Edit category">body</Overlay>)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("announces itself as a modal dialog with a name", () => {
    render(<Overlay open onClose={vi.fn()} title="Edit category">body</Overlay>)
    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveAttribute("aria-modal", "true")
    expect(dialog).toHaveAccessibleName("Edit category")
  })

  it("takes its name from the content's own heading when asked to", () => {
    render(
      <Overlay open onClose={vi.fn()} hideHeader labelledBy="my-heading">
        <h2 id="my-heading">New category</h2>
      </Overlay>
    )
    expect(screen.getByRole("dialog")).toHaveAccessibleName("New category")
  })

  it("closes on Escape", async () => {
    const onClose = vi.fn()
    render(<Overlay open onClose={onClose} title="Edit">body</Overlay>)
    await userEvent.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("lets a nested layer keep Escape for itself", async () => {
    // Escape must peel one layer at a time: an open date picker inside the dialog
    // has to be able to close without taking the whole dialog with it.
    const onClose = vi.fn()
    render(
      <Overlay open onClose={onClose} title="Edit">
        <input
          data-testid="inner"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.stopPropagation()
          }}
        />
      </Overlay>
    )
    const inner = screen.getByTestId("inner")
    inner.focus()
    await userEvent.keyboard("{Escape}")
    expect(onClose).not.toHaveBeenCalled()
  })

  it("closes when the backdrop is clicked", async () => {
    const onClose = vi.fn()
    const { container } = render(<Overlay open onClose={onClose} title="Edit">body</Overlay>)
    const backdrop = container.ownerDocument.querySelector('[aria-hidden="true"].absolute')
    expect(backdrop).not.toBeNull()
    await userEvent.click(backdrop as Element)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("keeps the backdrop out of the accessibility tree", () => {
    // A viewport-sized element with a role would be announced as a giant button.
    const { container } = render(<Overlay open onClose={vi.fn()} title="Edit">body</Overlay>)
    const backdrop = container.ownerDocument.querySelector('[aria-hidden="true"].absolute')
    expect(backdrop).not.toHaveAttribute("role")
    expect(backdrop).not.toHaveAttribute("tabindex")
  })

  it("moves focus into the dialog and traps Tab there", async () => {
    render(
      <>
        <button>outside</button>
        <Overlay open onClose={vi.fn()} title="Edit">
          <button>first</button>
          <button>last</button>
        </Overlay>
      </>
    )
    await waitFor(() => expect(screen.getByRole("button", { name: "first" })).toHaveFocus())
    await userEvent.tab()
    expect(screen.getByRole("button", { name: "last" })).toHaveFocus()
    await userEvent.tab()
    // Wrapped back into the dialog rather than escaping to "outside".
    expect(screen.getByRole("button", { name: "first" })).toHaveFocus()
  })

  it("locks page scroll while open and releases it on close", () => {
    const { rerender } = render(<Overlay open onClose={vi.fn()} title="Edit">body</Overlay>)
    expect(document.body.style.overflow).toBe("hidden")
    rerender(<Overlay open={false} onClose={vi.fn()} title="Edit">body</Overlay>)
    expect(document.body.style.overflow).toBe("")
  })
})

describe("useScrollLock", () => {
  function Harness({ active }: { active: boolean }) {
    useScrollLock(active)
    return null
  }

  it("keeps the lock while a second holder is still open", () => {
    // A confirm dialog inside the category editor: the inner one closing first must
    // not hand scrolling back to the page while the outer dialog is still up.
    const outer = render(<Harness active />)
    const inner = render(<Harness active />)
    expect(document.body.style.overflow).toBe("hidden")

    inner.unmount()
    expect(document.body.style.overflow).toBe("hidden")

    outer.unmount()
    expect(document.body.style.overflow).toBe("")
  })

  it("does nothing while inactive", () => {
    render(<Harness active={false} />)
    expect(document.body.style.overflow).toBe("")
  })

  it("replaces the scrollbar's width so the page behind does not jump", () => {
    // innerWidth minus clientWidth is the scrollbar. Removing it without replacing
    // it widens the viewport and shifts every centred element sideways.
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1015)
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000)
    const view = render(<Harness active />)
    expect(document.body.style.paddingRight).toBe("15px")
    view.unmount()
    expect(document.body.style.paddingRight).toBe("")
  })

  it("adds no padding on a platform with overlay scrollbars", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000)
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000)
    const view = render(<Harness active />)
    expect(document.body.style.paddingRight).toBe("")
    view.unmount()
  })
})
