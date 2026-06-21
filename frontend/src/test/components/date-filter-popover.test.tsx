import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DateFilterPopover } from "@/components/todos/date-filter-popover"

describe("DateFilterPopover", () => {
  it("idle: shows the 'By date' trigger, no clear control, and no open popover", () => {
    render(<DateFilterPopover start="" end="" onChange={vi.fn()} onClear={vi.fn()} />)

    expect(screen.getByRole("button", { name: /By date/i })).toBeInTheDocument()
    expect(screen.queryByLabelText("Clear completion-date filter")).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("opens the floating calendar popover when the trigger is clicked", async () => {
    render(<DateFilterPopover start="" end="" onChange={vi.fn()} onClear={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: /By date/i }))

    const dialog = await screen.findByRole("dialog")
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText(/Completed on/i)).toBeInTheDocument()
  })

  it("closes the popover on Escape", async () => {
    render(<DateFilterPopover start="" end="" onChange={vi.fn()} onClear={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /By date/i }))
    expect(await screen.findByRole("dialog")).toBeInTheDocument()

    fireEvent.keyDown(document, { key: "Escape" })
    // AnimatePresence unmounts after the exit animation, so poll for removal.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("active: renders a clear control that calls onClear", () => {
    const onClear = vi.fn()
    render(<DateFilterPopover start="" end="2026-06-10" onChange={vi.fn()} onClear={onClear} />)

    // The idle hint is replaced by the formatted window, and a clear affordance appears.
    expect(screen.queryByText("By date")).toBeNull()
    fireEvent.click(screen.getByLabelText("Clear completion-date filter"))
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})
