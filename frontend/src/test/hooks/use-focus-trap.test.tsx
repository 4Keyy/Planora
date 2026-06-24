import { describe, expect, it } from "vitest"
import { useState } from "react"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import { useFocusTrap } from "@/hooks/use-focus-trap"

function Dialog({ active, empty = false }: { active: boolean; empty?: boolean }) {
  const ref = useFocusTrap<HTMLDivElement>(active)
  return (
    <div>
      <button>outside</button>
      {active && (
        <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1} data-testid="dialog">
          {!empty && (
            <>
              <button>first</button>
              <button>last</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Toggle({ initial = false }: { initial?: boolean }) {
  const [open, setOpen] = useState(initial)
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)}>trigger</button>
      <Dialog active={open} />
    </div>
  )
}

describe("useFocusTrap", () => {
  it("does nothing while inactive", () => {
    render(<Dialog active={false} />)
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument()
  })

  it("moves focus to the first focusable on activation", async () => {
    render(<Dialog active />)
    await waitFor(() => expect(screen.getByText("first")).toHaveFocus())
  })

  it("wraps Tab from the last element back to the first", async () => {
    render(<Dialog active />)
    await waitFor(() => expect(screen.getByText("first")).toHaveFocus())

    act(() => screen.getByText("last").focus())
    fireEvent.keyDown(document, { key: "Tab" })
    expect(screen.getByText("first")).toHaveFocus()
  })

  it("wraps Shift+Tab from the first element to the last", async () => {
    render(<Dialog active />)
    await waitFor(() => expect(screen.getByText("first")).toHaveFocus())

    act(() => screen.getByText("first").focus())
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true })
    expect(screen.getByText("last")).toHaveFocus()
  })

  it("ignores non-Tab keys", async () => {
    render(<Dialog active />)
    await waitFor(() => expect(screen.getByText("first")).toHaveFocus())
    fireEvent.keyDown(document, { key: "Enter" })
    expect(screen.getByText("first")).toHaveFocus()
  })

  it("focuses the container itself when there are no focusable children", async () => {
    render(<Dialog active empty />)
    await waitFor(() => expect(screen.getByTestId("dialog")).toHaveFocus())
    // Tab with nothing focusable keeps focus on the container.
    fireEvent.keyDown(document, { key: "Tab" })
    expect(screen.getByTestId("dialog")).toHaveFocus()
  })

  it("restores focus to the trigger when it deactivates", async () => {
    render(<Toggle />)
    const trigger = screen.getByText("trigger")
    act(() => trigger.focus())
    fireEvent.click(trigger) // open
    await waitFor(() => expect(screen.getByText("first")).toHaveFocus())
    fireEvent.click(trigger) // close → focus returns to the trigger
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
