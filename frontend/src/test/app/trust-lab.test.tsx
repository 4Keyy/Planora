import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TrustLab } from "@/app/_landing/trust-lab"

/**
 * Block 7, driven the way a visitor drives it: an index of six proofs, one stage at a time,
 * a check by every proof that was run, and a way on to the next one.
 */

const SHORT = [
  "Undo sends nothing",
  "Saves as you type",
  "Survives a restart",
  "A fingerprint, not the key",
  "No trackers",
  "Guessing is slow",
]

const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) })
const panelOf = (t: HTMLElement) => document.getElementById(t.getAttribute("aria-controls")!)!
const visiblePanel = () => screen.getByRole("tabpanel")

describe("the reliability and privacy block", () => {
  it("lists six proofs and shows the first one alone", () => {
    render(<TrustLab />)
    const tabs = screen.getAllByRole("tab")
    expect(tabs.map((t) => t.textContent)).toEqual(SHORT)
    expect(tab("Undo sends nothing")).toHaveAttribute("aria-selected", "true")
    // Only the chosen stage is in the accessibility tree; the rest hold the block's height.
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1)
    expect(within(visiblePanel()).getByRole("heading", { name: "Undo sends nothing" })).toBeInTheDocument()
    expect(panelOf(tab("No trackers"))).toHaveAttribute("aria-hidden", "true")
    expect(panelOf(tab("No trackers"))).toHaveClass("invisible")
    expect(screen.getByText("0 of 6 tried")).toBeInTheDocument()
  })

  it("switches the stage when a proof is chosen", () => {
    render(<TrustLab />)
    fireEvent.click(tab("No trackers"))
    expect(tab("No trackers")).toHaveAttribute("aria-selected", "true")
    expect(tab("Undo sends nothing")).toHaveAttribute("aria-selected", "false")
    expect(within(visiblePanel()).getByRole("heading", { name: "No trackers on the line" })).toBeInTheDocument()
    expect(within(visiblePanel()).getByText("5 / 6")).toBeInTheDocument()
  })

  it("moves through the index with the arrow keys, Home and End", () => {
    render(<TrustLab />)
    const first = tab("Undo sends nothing")
    first.focus()
    fireEvent.keyDown(first, { key: "ArrowDown" })
    expect(tab("Saves as you type")).toHaveAttribute("aria-selected", "true")
    expect(tab("Saves as you type")).toHaveFocus()

    fireEvent.keyDown(tab("Saves as you type"), { key: "End" })
    expect(tab("Guessing is slow")).toHaveFocus()
    fireEvent.keyDown(tab("Guessing is slow"), { key: "ArrowRight" })
    expect(tab("Undo sends nothing")).toHaveAttribute("aria-selected", "true")
    fireEvent.keyDown(tab("Undo sends nothing"), { key: "ArrowUp" })
    expect(tab("Guessing is slow")).toHaveAttribute("aria-selected", "true")
    fireEvent.keyDown(tab("Guessing is slow"), { key: "Home" })
    expect(tab("Undo sends nothing")).toHaveFocus()
    fireEvent.keyDown(tab("Undo sends nothing"), { key: "x" })
    expect(tab("Undo sends nothing")).toHaveAttribute("aria-selected", "true")
  })

  it("offers the next proof, and comes round to the first after the last", () => {
    render(<TrustLab />)
    fireEvent.click(within(visiblePanel()).getByRole("button", { name: /Next: Saves as you type/ }))
    expect(tab("Saves as you type")).toHaveAttribute("aria-selected", "true")
    expect(tab("Saves as you type")).toHaveFocus()

    fireEvent.click(tab("Guessing is slow"))
    fireEvent.click(within(visiblePanel()).getByRole("button", { name: /Next: Undo sends nothing/ }))
    expect(tab("Undo sends nothing")).toHaveAttribute("aria-selected", "true")
  })

  it("puts a check by a proof once it has been run", () => {
    render(<TrustLab />)
    fireEvent.click(within(visiblePanel()).getByRole("button", { name: "Delete" }))
    expect(screen.getByText("1 of 6 tried")).toBeInTheDocument()
    expect(tab("Undo sends nothing")).toHaveAccessibleName("Undo sends nothing, tried")

    fireEvent.click(tab("Saves as you type"))
    fireEvent.change(within(visiblePanel()).getByLabelText("Task title"), { target: { value: "Call the landlord now" } })
    expect(screen.getByText("2 of 6 tried")).toBeInTheDocument()

    // Running the same proof again does not count twice.
    fireEvent.change(within(visiblePanel()).getByLabelText("Task title"), { target: { value: "Call the landlord" } })
    expect(screen.getByText("2 of 6 tried")).toBeInTheDocument()
  })

  it("still says the eight other things that are true", () => {
    render(<TrustLab />)
    for (const fact of [
      "An expired sign-in renews itself once and picks up where you were.",
      "A brief database hiccup is retried, up to three times.",
      "Five wrong passwords lock the account for 30 minutes.",
      "You can see where you're signed in and end any session.",
    ]) {
      expect(screen.getByText(fact)).toBeInTheDocument()
    }
    expect(screen.getByText("Also true").nextElementSibling?.children).toHaveLength(8)
  })
})
