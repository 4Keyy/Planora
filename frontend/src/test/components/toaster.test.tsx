import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, act, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Toaster } from "@/components/ui/toast"
import { TOAST_DURATIONS, useToastStore } from "@/store/toast"

describe("Toaster a11y", () => {
  afterEach(() => {
    act(() => useToastStore.setState({ toasts: [] }))
  })

  it("is a polite live region and announces errors assertively", () => {
    act(() => {
      useToastStore.getState().addToast({ type: "error", title: "Save failed" })
      useToastStore.getState().addToast({ type: "success", title: "Saved" })
    })

    render(<Toaster />)

    // The container is a labelled, polite live region.
    const region = screen.getByRole("region", { name: "Notifications" })
    expect(region).toHaveAttribute("aria-live", "polite")
    // Notices announce status/alert, so the layout list does not require listitem roles.
    expect(region.querySelector("ol")).toHaveAttribute("role", "presentation")

    // Errors get role="alert" (assertive); other toasts get role="status".
    expect(screen.getByRole("alert")).toHaveTextContent("Save failed")
    expect(screen.getByRole("status")).toHaveTextContent("Saved")
  })
})

describe("Toaster clocks", () => {
  beforeEach(() => {
    // Real time still moves, so user-event's own waits resolve; the notices' clocks are skipped
    // ahead by hand.
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    act(() => useToastStore.getState().clear())
    vi.useRealTimers()
  })

  const say = (title: string) => act(() => { useToastStore.getState().addToast({ type: "success", title }) })
  const expire = () => act(() => { vi.advanceTimersByTime(TOAST_DURATIONS.success + 50) })
  const setup = () => userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })

  it("lets the next notice expire after one was closed from the keyboard", async () => {
    const user = setup()
    render(<Toaster />)
    say("Task saved")

    // Tabbing into the stack stops every clock while it is read.
    await user.tab()
    expect(screen.getByRole("button", { name: "Dismiss notification" })).toHaveFocus()
    expect(useToastStore.getState().paused).toBe(true)

    // The focused button leaves with its notice. React runs no blur handler while it commits a
    // removal, so the stack used to stay "focused" and every later notice waited forever.
    await user.keyboard("{Enter}")
    expect(useToastStore.getState().toasts).toHaveLength(0)

    say("Task completed")
    expect(useToastStore.getState().paused).toBe(false)
    expire()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it("lets the next notice expire after one was closed with the mouse", async () => {
    const user = setup()
    render(<Toaster />)
    say("Task saved")

    await user.click(screen.getByRole("button", { name: "Dismiss notification" }))
    await user.unhover(screen.getByRole("region", { name: "Notifications" }))
    say("Task completed")
    expire()

    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it("lets the next notice expire after Escape closed the focused one", async () => {
    const user = setup()
    render(<Toaster />)
    say("Task saved")
    await user.tab()

    await user.keyboard("{Escape}")
    say("Task completed")
    expire()

    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it("keeps the keyboard in the stack, and the clocks stopped, when one of several is closed", async () => {
    const user = setup()
    render(<Toaster />)
    say("First")
    say("Second")

    await user.tab()
    await user.keyboard("{Enter}")

    expect(useToastStore.getState().toasts.map((t) => t.title)).toEqual(["First"])
    // "Second" is still playing its exit; the focus has moved on to the notice that stays.
    const first = screen.getByText("First").closest<HTMLElement>("[data-toast-id]")!
    expect(within(first).getByRole("button", { name: "Dismiss notification" })).toHaveFocus()
    act(() => { vi.advanceTimersByTime(TOAST_DURATIONS.success * 3) })
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })
})
