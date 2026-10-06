import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Overlay } from "@/components/ui/overlay"
import { useScrollLock } from "@/hooks/use-scroll-lock"

beforeEach(() => {
  document.documentElement.style.overflow = ""
  document.documentElement.style.paddingRight = ""
  document.body.style.overflow = ""
  document.body.style.paddingRight = ""
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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
    expect(document.documentElement.style.overflow).toBe("hidden")
    rerender(<Overlay open={false} onClose={vi.fn()} title="Edit">body</Overlay>)
    expect(document.documentElement.style.overflow).toBe("")
  })
})

describe("useScrollLock", () => {
  function Harness({ active }: { active: boolean }) {
    useScrollLock(active)
    return null
  }

  it("locks the root, which is what scrolls, and leaves <body> alone", () => {
    // globals.css scrolls the page on <html>. `overflow: hidden` on <body> froze nothing
    // and made <body> a scroll container under every sticky element.
    const view = render(<Harness active />)
    expect(document.documentElement.style.overflow).toBe("hidden")
    expect(document.body.style.overflow).toBe("")
    view.unmount()
    expect(document.documentElement.style.overflow).toBe("")
  })

  it("keeps the lock while a second holder is still open", () => {
    // A confirm dialog inside the category editor: the inner one closing first must
    // not hand scrolling back to the page while the outer dialog is still up.
    const outer = render(<Harness active />)
    const inner = render(<Harness active />)
    expect(document.documentElement.style.overflow).toBe("hidden")

    inner.unmount()
    expect(document.documentElement.style.overflow).toBe("hidden")

    outer.unmount()
    expect(document.documentElement.style.overflow).toBe("")
  })

  it("does nothing while inactive", () => {
    render(<Harness active={false} />)
    expect(document.documentElement.style.overflow).toBe("")
  })

  it("adds no padding while the scrollbar's lane stays reserved", () => {
    // The regression: a visible 10px scrollbar (innerWidth 1440, clientWidth 1430) whose
    // lane `scrollbar-gutter: stable` keeps reserved under the lock. Padding it anyway
    // pushed every centred element 5px to the left for as long as a task was open.
    vi.stubGlobal("CSS", { supports: () => true })
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1440)
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1430)
    const view = render(<Harness active />)
    expect(document.documentElement.style.paddingRight).toBe("")
    expect(document.body.style.paddingRight).toBe("")
    view.unmount()
  })

  it("replaces the scrollbar's width where the lane cannot be reserved", () => {
    // A browser without `scrollbar-gutter` gives the lane to the page when the root stops
    // scrolling; without the padding every centred element would jump right.
    vi.stubGlobal("CSS", { supports: () => false })
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1015)
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000)
    const view = render(<Harness active />)
    expect(document.documentElement.style.paddingRight).toBe("15px")
    view.unmount()
    expect(document.documentElement.style.paddingRight).toBe("")
  })

  it("adds no padding on a platform with overlay scrollbars", () => {
    vi.stubGlobal("CSS", { supports: () => false })
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000)
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000)
    const view = render(<Harness active />)
    expect(document.documentElement.style.paddingRight).toBe("")
    view.unmount()
  })
})
