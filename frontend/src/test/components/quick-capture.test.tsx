import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QuickCapture } from "@/components/todos/quick-capture"

type Capture = (title: string) => Promise<void>

/** framer-motion's useReducedMotion reads matchMedia, which jsdom does not implement. */
beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    media: "",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as unknown as typeof window.matchMedia
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const bubble = () => screen.getByRole("button", { name: "New task" })
const field = () => screen.getByRole("textbox", { name: "New task" })
const queryField = () => screen.queryByRole("textbox", { name: "New task" })

/** Press the bubble and wait for the field the expansion exists to provide. */
async function expand(user: ReturnType<typeof userEvent.setup>) {
  await user.click(bubble())
  return await screen.findByRole("textbox", { name: "New task" })
}

// ─── Collapsed ──────────────────────────────────────────────────────────────

describe("QuickCapture, collapsed", () => {
  it("offers one named control and no field to fill in", async () => {
    // Collapsed is the resting state on every screen, so anything rendered here
    // is rendered permanently over the user's list.
    render(<QuickCapture onCapture={vi.fn<Capture>()} />)
    expect(bubble()).toBeInTheDocument()
    expect(queryField()).toBeNull()
  })

  it("expands into a labelled form and puts the caret in the field", async () => {
    // Expanding and then making the user tap the input costs the second tap the
    // whole control exists to save.
    const user = userEvent.setup()
    render(<QuickCapture onCapture={vi.fn<Capture>()} />)

    const input = await expand(user)
    expect(screen.getByRole("form", { name: "Quick capture" })).toBeInTheDocument()
    await waitFor(() => expect(input).toHaveFocus())
  })
})

// ─── Capture ────────────────────────────────────────────────────────────────

describe("QuickCapture, submitting", () => {
  it("captures the trimmed title once", async () => {
    const user = userEvent.setup()
    const onCapture = vi.fn<Capture>().mockResolvedValue(undefined)
    render(<QuickCapture onCapture={onCapture} />)

    await expand(user)
    await user.keyboard("  Buy milk  {Enter}")

    await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(1))
    expect(onCapture).toHaveBeenCalledWith("Buy milk")
  })

  it("creates one task when Enter is pressed twice on a slow request", async () => {
    // The bug this prevents: two identical tasks from one thought. A second Enter
    // lands while the first request is still open, and the user cannot tell the
    // difference until the list comes back with a duplicate in it.
    const user = userEvent.setup()
    let release: () => void = () => undefined
    const onCapture = vi.fn<Capture>().mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    render(<QuickCapture onCapture={onCapture} />)

    await expand(user)
    await user.keyboard("Call the dentist{Enter}{Enter}")

    expect(onCapture).toHaveBeenCalledTimes(1)
    release()
    await waitFor(() => expect(queryField()).toBeNull())
  })

  it("refuses a second submit that lands in the same tick as the first", async () => {
    // The re-render that disables the button has not happened yet at this point,
    // so only the synchronous in-flight guard can stop the duplicate.
    const user = userEvent.setup()
    let release: () => void = () => undefined
    const onCapture = vi.fn<Capture>().mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    render(<QuickCapture onCapture={onCapture} />)

    await expand(user)
    await user.keyboard("Book the train")

    const form = screen.getByRole("form", { name: "Quick capture" })
    fireEvent.submit(form)
    fireEvent.submit(form)

    expect(onCapture).toHaveBeenCalledTimes(1)
    release()
    await waitFor(() => expect(queryField()).toBeNull())
  })

  it("treats a field holding only whitespace as nothing to capture", async () => {
    // Not an error either: the user has not done anything wrong by pressing Enter.
    const user = userEvent.setup()
    const onCapture = vi.fn<Capture>().mockResolvedValue(undefined)
    render(<QuickCapture onCapture={onCapture} />)

    await expand(user)
    await user.keyboard("   {Enter}")

    expect(onCapture).not.toHaveBeenCalled()
    expect(queryField()).toBeInTheDocument()
  })

  it("clears the field and closes once the task exists", async () => {
    const user = userEvent.setup()
    const onCapture = vi.fn<Capture>().mockResolvedValue(undefined)
    render(<QuickCapture onCapture={onCapture} />)

    await expand(user)
    await user.keyboard("Water the plants{Enter}")

    await waitFor(() => expect(queryField()).toBeNull())
    expect(bubble()).toBeInTheDocument()

    // Reopening starts clean rather than handing back the sentence just captured.
    const reopened = await expand(user)
    expect(reopened).toHaveValue("")
  })

  it("does not need navigator.vibrate to exist", async () => {
    // jsdom has no vibrate; the haptics module must keep the capture path from
    // throwing on every desktop and iOS browser that also lacks it.
    expect(navigator.vibrate).toBeUndefined()
    const user = userEvent.setup()
    const onCapture = vi.fn<Capture>().mockResolvedValue(undefined)
    render(<QuickCapture onCapture={onCapture} />)

    await expand(user)
    await user.keyboard("Renew the passport{Enter}")

    await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(1))
  })
})

// ─── Failure ────────────────────────────────────────────────────────────────

describe("QuickCapture, when the request fails", () => {
  it("keeps the typed text and says what went wrong", async () => {
    // The server has no copy and neither would the user: clearing the field on a
    // rejection destroys the only record of the thought.
    const user = userEvent.setup()
    const onCapture = vi.fn<Capture>().mockRejectedValue(new Error("Offline — nothing was saved"))
    render(<QuickCapture onCapture={onCapture} />)

    await expand(user)
    await user.keyboard("Renew the lease{Enter}")

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Offline — nothing was saved")
    expect(field()).toHaveValue("Renew the lease")
    expect(screen.getByRole("form", { name: "Quick capture" })).toBeInTheDocument()
  })

  it("returns focus to the field so the retry is one keystroke away", async () => {
    const user = userEvent.setup()
    const onCapture = vi.fn<Capture>().mockRejectedValue(new Error("Offline"))
    render(<QuickCapture onCapture={onCapture} />)

    await expand(user)
    await user.keyboard("Renew the lease{Enter}")

    await screen.findByRole("alert")
    await waitFor(() => expect(field()).toHaveFocus())
  })

  it("drops the message as soon as the text it described changes", async () => {
    // A stale error under freshly typed text reads as a second, new failure.
    const user = userEvent.setup()
    const onCapture = vi.fn<Capture>().mockRejectedValue(new Error("Offline"))
    render(<QuickCapture onCapture={onCapture} />)

    await expand(user)
    await user.keyboard("Renew the lease{Enter}")
    await screen.findByRole("alert")

    await user.keyboard("s")
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
  })

  it("falls back to a readable message when the rejection carries none", async () => {
    const user = userEvent.setup()
    const onCapture = vi.fn<Capture>().mockRejectedValue(new Error(""))
    render(<QuickCapture onCapture={onCapture} />)

    await expand(user)
    await user.keyboard("Renew the lease{Enter}")

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not add that task. Try again.")
  })
})

// ─── Dismissal ──────────────────────────────────────────────────────────────

describe("QuickCapture, closing", () => {
  it("discards the draft on Escape, as documented", async () => {
    // The component's own comment: a half-typed line that reappears later is a
    // surprise to read and delete before capturing the thing you opened it for.
    const user = userEvent.setup()
    render(<QuickCapture onCapture={vi.fn<Capture>()} />)

    await expand(user)
    await user.keyboard("half a thought{Escape}")

    await waitFor(() => expect(queryField()).toBeNull())
    expect(bubble()).toBeInTheDocument()

    const reopened = await expand(user)
    expect(reopened).toHaveValue("")
  })

  it("closes on the cancel control too", async () => {
    const user = userEvent.setup()
    render(<QuickCapture onCapture={vi.fn<Capture>()} />)

    await expand(user)
    await user.click(screen.getByRole("button", { name: "Cancel new task" }))

    await waitFor(() => expect(queryField()).toBeNull())
  })

  it("leaves nothing behind to tab into when hidden", async () => {
    // A modal owns the screen; a focusable control still mounted underneath it is
    // reachable by Tab and invisible to the person pressing it.
    const { rerender } = render(<QuickCapture onCapture={vi.fn<Capture>()} hidden />)
    expect(screen.queryByRole("button")).toBeNull()
    expect(queryField()).toBeNull()

    rerender(<QuickCapture onCapture={vi.fn<Capture>()} />)
    expect(bubble()).toBeInTheDocument()
  })

  it("closes an open capture when a modal takes the screen", async () => {
    const user = userEvent.setup()
    const onCapture = vi.fn<Capture>()
    const { rerender } = render(<QuickCapture onCapture={onCapture} />)

    await expand(user)
    await user.keyboard("half a thought")
    rerender(<QuickCapture onCapture={onCapture} hidden />)

    expect(screen.queryByRole("button")).toBeNull()

    rerender(<QuickCapture onCapture={onCapture} />)
    expect(queryField()).toBeNull()
    expect(bubble()).toBeInTheDocument()
  })
})

// ─── The keyboard shortcut ──────────────────────────────────────────────────

describe("QuickCapture, the c shortcut", () => {
  it("opens from anywhere on the page", async () => {
    const user = userEvent.setup()
    render(<QuickCapture onCapture={vi.fn<Capture>()} />)

    await user.keyboard("c")

    expect(await screen.findByRole("textbox", { name: "New task" })).toBeInTheDocument()
  })

  it("stays out of the way while someone is typing in another field", async () => {
    // Otherwise the letter c in any search box on the page launches a task form
    // over what is being typed.
    const user = userEvent.setup()
    render(
      <>
        <input aria-label="Search" />
        <QuickCapture onCapture={vi.fn<Capture>()} />
      </>,
    )

    const search = screen.getByRole("textbox", { name: "Search" })
    await user.click(search)
    await user.keyboard("c")

    expect(search).toHaveValue("c")
    expect(queryField()).toBeNull()
  })

  it("leaves Ctrl+C alone", async () => {
    const user = userEvent.setup()
    render(<QuickCapture onCapture={vi.fn<Capture>()} />)

    await user.keyboard("{Control>}c{/Control}")

    expect(queryField()).toBeNull()
  })

  it("is unbound while hidden", async () => {
    // A shortcut that opens a control behind an open modal is a trap.
    const user = userEvent.setup()
    render(<QuickCapture onCapture={vi.fn<Capture>()} hidden />)

    await user.keyboard("c")

    expect(queryField()).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
  })
})

// ─── Placement ──────────────────────────────────────────────────────────────

describe("QuickCapture placement", () => {
  it.each(["responsive", "corner", "center"] as const)("renders the %s variant", (placement) => {
    render(<QuickCapture onCapture={vi.fn<Capture>()} placement={placement} />)
    expect(bubble()).toBeInTheDocument()
  })
})
