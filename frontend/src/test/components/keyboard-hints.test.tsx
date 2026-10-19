import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { KeyHintsDock } from "@/components/todos/keyboard-hints"
import { OPEN_SHORTCUTS_EVENT } from "@/components/ui/shortcuts-overlay"
import { echoKey } from "@/lib/key-echo"

const trigger = () => screen.getByRole("button", { name: "Keyboard shortcuts" })
const panel = () => screen.queryByRole("region", { name: "Keyboard shortcuts" })
const rowFor = (does: string) => screen.getByText(does).closest("div")!

async function openDock() {
  fireEvent.click(trigger())
  await waitFor(() => expect(panel()).not.toBeNull())
  return panel()!
}

afterEach(() => {
  vi.useRealTimers()
})

describe("the dashboard's key dock", () => {
  it("rests as a droplet that names itself, with no panel yet", () => {
    render(<KeyHintsDock />)
    expect(trigger()).toHaveAttribute("aria-expanded", "false")
    expect(panel()).toBeNull()
    // Hover-capable devices only: a phone has no keyboard to teach.
    expect(trigger().closest("div.fixed")).toHaveClass("hidden", "[@media(hover:hover)]:flex")
  })

  it("says what it is when pointed at, and stops saying it when left", () => {
    render(<KeyHintsDock />)
    expect(screen.queryByText("Shortcuts")).toBeNull()
    fireEvent.pointerEnter(trigger())
    expect(screen.getByText("Shortcuts")).toBeInTheDocument()
    fireEvent.pointerLeave(trigger())
    expect(screen.queryByText("Shortcuts")).toBeNull()
  })

  it("opens into the panel, which takes focus without being a dialog", async () => {
    render(<KeyHintsDock />)
    const region = await openDock()
    expect(region).toHaveFocus()
    // A dialog would swallow the priority keys this panel exists to teach.
    expect(region.closest("[role='dialog']")).toBeNull()
    expect(screen.getByText("They work on every task card.")).toBeInTheDocument()
  })

  it("lists the landing page's eight keys, in its words", async () => {
    render(<KeyHintsDock />)
    await openDock()
    for (const does of [
      "Move the cursor",
      "Open the branch",
      "Edit the title in place",
      "Complete the task",
      "Set priority",
      "Delete, with five seconds to undo",
      "The command palette",
      "The keyboard map itself",
      "New task",
    ]) {
      expect(screen.getByText(does)).toBeInTheDocument()
    }
    expect(screen.getByText("Point at a card, or move to it")).toBeInTheDocument()
  })

  it("pours its rows in one after another", async () => {
    render(<KeyHintsDock />)
    await openDock()
    expect(rowFor("Move the cursor").className).toContain("animate-fade-in")
    expect(rowFor("Move the cursor").style.animationDelay).toBe("90ms")
    expect(rowFor("The keyboard map itself").style.animationDelay).toBe(`${90 + 25 * 7}ms`)
  })

  it("lights the row of a key that just did something, and lets it go", async () => {
    render(<KeyHintsDock />)
    await openDock()
    vi.useFakeTimers()

    act(() => echoKey("1–5"))
    expect(screen.getByText("Set priority").closest("dd")).toHaveClass("text-ink")

    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(screen.getByText("Set priority").closest("dd")).toHaveClass("text-ink-muted")
  })

  it("closes from its ✕ and hands focus back to the droplet", async () => {
    render(<KeyHintsDock />)
    await openDock()
    fireEvent.click(screen.getByRole("button", { name: "Close keyboard shortcuts" }))
    await waitFor(() => expect(panel()).toBeNull())
    expect(trigger()).toHaveFocus()
  })

  it("closes on Escape while focus is inside it", async () => {
    render(<KeyHintsDock />)
    const region = await openDock()
    const outer = vi.fn()
    window.addEventListener("keydown", outer)
    fireEvent.keyDown(region, { key: "Escape" })
    window.removeEventListener("keydown", outer)
    await waitFor(() => expect(panel()).toBeNull())
    // The panel's Escape is the panel's: the list's own Escape does not run as well.
    expect(outer).not.toHaveBeenCalled()
  })

  it("ignores every other key, which belongs to the cards", async () => {
    render(<KeyHintsDock />)
    const region = await openDock()
    fireEvent.keyDown(region, { key: "j" })
    expect(panel()).not.toBeNull()
  })

  it("opens the whole map from its link", async () => {
    render(<KeyHintsDock />)
    await openDock()
    const heard = vi.fn()
    window.addEventListener(OPEN_SHORTCUTS_EVENT, heard)
    fireEvent.click(screen.getByRole("button", { name: /all shortcuts/i }))
    window.removeEventListener(OPEN_SHORTCUTS_EVENT, heard)
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it("is not there while a dialog owns the screen, and keeps its state for when it is back", async () => {
    const { rerender } = render(<KeyHintsDock />)
    await openDock()
    rerender(<KeyHintsDock hidden />)
    expect(screen.queryByRole("button", { name: "Keyboard shortcuts" })).toBeNull()
    expect(panel()).toBeNull()
    rerender(<KeyHintsDock />)
    expect(panel()).not.toBeNull()
  })
})
