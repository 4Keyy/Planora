import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useId } from "react"
import { KEY_HINTS_PREFERENCE, KeyHintsPanel, KeyHintsToggle, useKeyHints } from "@/components/todos/keyboard-hints"
import { OPEN_SHORTCUTS_EVENT } from "@/components/ui/shortcuts-overlay"
import { echoKey } from "@/lib/key-echo"

/** The heading's cap and the panel it folds, wired the way the dashboard wires them. */
function Dashboardish() {
  const hints = useKeyHints()
  const id = useId()
  return (
    <>
      <KeyHintsToggle open={hints.open} onToggle={hints.toggle} controls={id} />
      <KeyHintsPanel id={id} open={hints.open} restoring={hints.restoring} />
    </>
  )
}

const panelOf = (toggle: HTMLElement) => document.getElementById(toggle.getAttribute("aria-controls")!)!
const rowFor = (does: string) => screen.getByText(does).closest("div")!

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("the dashboard's key panel", () => {
  it("starts folded, out of the tab order and the accessibility tree", () => {
    render(<Dashboardish />)
    const toggle = screen.getByRole("button", { name: "Keys" })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    const panel = panelOf(toggle)
    expect(panel).toHaveAttribute("aria-hidden", "true")
    expect(panel).toHaveAttribute("inert")
    expect(panel.style.gridTemplateRows).toBe("0fr")
  })

  it("opens from its cap, and says the keys work on every task card", () => {
    render(<Dashboardish />)
    const toggle = screen.getByRole("button", { name: "Keys" })
    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute("aria-expanded", "true")
    const panel = panelOf(toggle)
    expect(panel).not.toHaveAttribute("inert")
    expect(panel.style.gridTemplateRows).toBe("1fr")
    expect(screen.getByText("These keys work on every task card, wherever you find one.")).toBeInTheDocument()
  })

  it("lists the landing page's eight keys, in its words", () => {
    render(<Dashboardish />)
    fireEvent.click(screen.getByRole("button", { name: "Keys" }))
    for (const does of [
      "Move the cursor",
      "Open the branch",
      "Edit the title in place",
      "Complete the task",
      "Set priority",
      "Delete, with five seconds to undo",
      "The command palette",
      "The keyboard map itself",
    ]) {
      expect(screen.getByText(does)).toBeInTheDocument()
    }
    expect(screen.getByText("Point at a card, or move to it")).toBeInTheDocument()
  })

  it("pours its rows in on every opening", () => {
    render(<Dashboardish />)
    const toggle = screen.getByRole("button", { name: "Keys" })
    fireEvent.click(toggle)
    expect(rowFor("Move the cursor").className).toContain("animate-fade-in")
    expect(rowFor("The keyboard map itself").style.animationDelay).toBe(`${60 + 25 * 7}ms`)

    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(rowFor("Move the cursor").className).toContain("animate-fade-in")
  })

  it("remembers being open on this device, and comes back open without replaying anything", () => {
    const first = render(<Dashboardish />)
    fireEvent.click(screen.getByRole("button", { name: "Keys" }))
    expect(window.localStorage.getItem(`planora:pref:${KEY_HINTS_PREFERENCE}`)).toBe("1")
    first.unmount()

    render(<Dashboardish />)
    const toggle = screen.getByRole("button", { name: "Keys" })
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(panelOf(toggle).style.transition).toContain("0.01s")
    expect(rowFor("Move the cursor").className).not.toContain("animate-fade-in")
  })

  it("forgets it once folded again", () => {
    render(<Dashboardish />)
    const toggle = screen.getByRole("button", { name: "Keys" })
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(window.localStorage.getItem(`planora:pref:${KEY_HINTS_PREFERENCE}`)).toBeNull()
  })

  it("lights the row of a key that just did something, and lets it go", () => {
    vi.useFakeTimers()
    render(<Dashboardish />)
    fireEvent.click(screen.getByRole("button", { name: "Keys" }))

    act(() => echoKey("1–5"))
    expect(screen.getByText("Set priority").closest("dd")).toHaveClass("text-ink")

    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(screen.getByText("Set priority").closest("dd")).toHaveClass("text-ink-muted")
  })

  it("stays dark while folded", () => {
    render(<Dashboardish />)
    act(() => echoKey("Space"))
    expect(screen.getByText("Complete the task").closest("dd")).toHaveClass("text-ink-muted")
  })

  it("opens the whole map from its link", () => {
    render(<Dashboardish />)
    fireEvent.click(screen.getByRole("button", { name: "Keys" }))
    const heard = vi.fn()
    window.addEventListener(OPEN_SHORTCUTS_EVENT, heard)
    fireEvent.click(screen.getByRole("button", { name: /every shortcut/i }))
    window.removeEventListener(OPEN_SHORTCUTS_EVENT, heard)
    expect(heard).toHaveBeenCalledTimes(1)
  })
})
