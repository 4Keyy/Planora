import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  Kbd,
  KeyCombo,
  MOD,
  SHORTCUT_GROUPS,
  ShortcutsOverlay,
  formatKey,
  useShortcutsOverlay,
} from "@/components/ui/shortcuts-overlay"

/** jsdom reports no platform of its own, so the Ctrl spelling is the default here. */
function pretendApplePlatform() {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true })
}

beforeEach(() => {
  Object.defineProperty(window.navigator, "platform", { value: "Win32", configurable: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── SHORTCUT_GROUPS ────────────────────────────────────────────────────────

describe("SHORTCUT_GROUPS", () => {
  it("is the only list, so nothing can print a key the app does not answer to", () => {
    // Exported for the command palette and the row menus. If this shrinks to a
    // private const, three hand-written copies grow back.
    expect(SHORTCUT_GROUPS.map((g) => g.title)).toEqual(["Anywhere", "The list", "A branch"])
    for (const group of SHORTCUT_GROUPS) {
      expect(group.shortcuts.length).toBeGreaterThan(0)
      for (const shortcut of group.shortcuts) {
        expect(shortcut.keys.length).toBeGreaterThan(0)
        expect(shortcut.description.trim()).not.toBe("")
      }
    }
  })

  it("stores the chord key as a platform-free sentinel", () => {
    // A literal "⌘" in the data would be wrong on Windows before a single
    // component had a chance to fix it.
    const palette = SHORTCUT_GROUPS[0].shortcuts[0]
    expect(palette.keys).toEqual([MOD, "K"])
    const everyKey = SHORTCUT_GROUPS.flatMap((g) => g.shortcuts.flatMap((s) => s.keys))
    expect(everyKey).not.toContain("⌘")
    expect(everyKey).not.toContain("Ctrl")
  })
})

// ─── formatKey ──────────────────────────────────────────────────────────────

describe("formatKey", () => {
  it("spells the chord key for the platform in front of the user", () => {
    expect(formatKey(MOD, true)).toBe("⌘")
    expect(formatKey(MOD, false)).toBe("Ctrl")
  })

  it("leaves every other cap alone", () => {
    expect(formatKey("K", true)).toBe("K")
    expect(formatKey("Shift", false)).toBe("Shift")
  })
})

// ─── Kbd / KeyCombo ─────────────────────────────────────────────────────────

describe("Kbd", () => {
  it("renders a real <kbd>, so the markup says what it is", () => {
    const { container } = render(<Kbd>K</Kbd>)
    expect(container.querySelector("kbd")).toHaveTextContent("K")
  })
})

describe("KeyCombo", () => {
  it("says the chord once, in words, rather than one node per glyph", () => {
    // "⌘" is read aloud as "place of interest sign" by more than one screen
    // reader; "↑" often as nothing at all.
    const { container } = render(<KeyCombo keys={["Shift", "↑"]} />)
    expect(container.querySelector(".sr-only")).toHaveTextContent("Shift plus Arrow Up")
  })

  it("keeps the caps themselves out of the accessibility tree", () => {
    const { container } = render(<KeyCombo keys={["Shift", "↑"]} />)
    const caps = container.querySelector('[aria-hidden="true"]')
    expect(caps).not.toBeNull()
    expect(caps?.querySelectorAll("kbd")).toHaveLength(2)
  })

  it("reads a sequence as a sequence, not as a chord", () => {
    // "G then G" and "G plus G" are different instructions and only one of them
    // is possible.
    const { container } = render(<KeyCombo keys={["G", "then", "G"]} />)
    expect(container.querySelector(".sr-only")).toHaveTextContent("G then G")
    expect(container.querySelector(".sr-only")).not.toHaveTextContent("plus")
    // The connector is a word, not a cap.
    expect(container.querySelectorAll("kbd")).toHaveLength(2)
  })

  it("reads a choice as a choice", () => {
    const { container } = render(<KeyCombo keys={["J", "or", "K"]} />)
    expect(container.querySelector(".sr-only")).toHaveTextContent("J or K")
  })

  it("joins a connector to the keys on both sides without a stray plus", () => {
    const { container } = render(<KeyCombo keys={["Shift", "↑", "or", "↓"]} />)
    expect(container.querySelector(".sr-only")).toHaveTextContent(
      "Shift plus Arrow Up or Arrow Down",
    )
  })

  it("prints the Ctrl spelling before it knows the platform", () => {
    // The server has no `navigator`. Reading it during render makes the server
    // emit one spelling and the client another, and React discards the whole
    // server pass as a mismatch — so the first paint is deliberately Ctrl.
    const { container } = render(<KeyCombo keys={[MOD, "K"]} />)
    expect(container.querySelector(".sr-only")).toHaveTextContent("Control plus K")
  })

  it("switches to ⌘ after mount on an Apple keyboard", async () => {
    pretendApplePlatform()
    const { container } = render(<KeyCombo keys={[MOD, "K"]} />)
    await waitFor(() => expect(container.querySelector(".sr-only")).toHaveTextContent("Command plus K"))
    expect(container.querySelector("kbd")).toHaveTextContent("⌘")
  })
})

// ─── ShortcutsOverlay ───────────────────────────────────────────────────────

describe("ShortcutsOverlay", () => {
  it("renders nothing while closed", () => {
    render(<ShortcutsOverlay open={false} onClose={vi.fn()} />)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("is a dialog named by its own heading", () => {
    render(<ShortcutsOverlay open onClose={vi.fn()} />)
    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveAttribute("aria-modal", "true")
    expect(dialog).toHaveAccessibleName("Keyboard shortcuts")
    expect(screen.getByRole("heading", { level: 2, name: "Keyboard shortcuts" })).toBeInTheDocument()
  })

  it("lists every group and every shortcut in the source of truth", () => {
    render(<ShortcutsOverlay open onClose={vi.fn()} />)
    for (const group of SHORTCUT_GROUPS) {
      expect(screen.getByRole("heading", { level: 3, name: group.title })).toBeInTheDocument()
      for (const shortcut of group.shortcuts) {
        expect(screen.getAllByText(shortcut.description).length).toBeGreaterThan(0)
      }
    }
  })

  it("pairs each description with its keys as a term and a definition", () => {
    // A row of two loose spans tells assistive tech nothing about which key
    // belongs to which action.
    render(<ShortcutsOverlay open onClose={vi.fn()} />)
    const total = SHORTCUT_GROUPS.reduce((n, g) => n + g.shortcuts.length, 0)
    // `document.body`, not the render container: Overlay portals out of the tree
    // React rendered into, so a container query finds an empty div and reports
    // zero — which reads as "the overlay renders no pairs" rather than "the
    // query looked in the wrong document subtree".
    expect(document.body.querySelectorAll("dt")).toHaveLength(total)
    expect(document.body.querySelectorAll("dd")).toHaveLength(total)
  })

  it("closes from the close button, which has a name and a hit area", async () => {
    const onClose = vi.fn()
    render(<ShortcutsOverlay open onClose={onClose} />)
    const close = screen.getByRole("button", { name: "Close keyboard shortcuts" })
    // `touch-target` is the utility that guarantees 44x44 without changing how
    // the control looks; jsdom has no layout, so the class is the assertion.
    expect(close).toHaveClass("touch-target")
    await userEvent.click(close)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("closes on Escape, like every other overlay in the product", async () => {
    const onClose = vi.fn()
    render(<ShortcutsOverlay open onClose={onClose} />)
    await userEvent.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("never hard-codes a focus indicator away", () => {
    // `focus:outline-none` compiles to a transparent 2px outline in Tailwind,
    // which wins over the global :focus-visible rule and silently removes the
    // ring for keyboard users — the exact audience of this dialog.
    const { container } = render(<ShortcutsOverlay open onClose={vi.fn()} />)
    expect(container.ownerDocument.querySelector(".focus\\:outline-none")).toBeNull()
  })
})

// ─── useShortcutsOverlay ────────────────────────────────────────────────────

function Harness() {
  const { open, setOpen } = useShortcutsOverlay()
  return (
    <>
      <input aria-label="title" />
      <textarea aria-label="notes" />
      <div aria-label="rich" contentEditable suppressContentEditableWarning />
      <span data-testid="state">{open ? "open" : "closed"}</span>
      <ShortcutsOverlay open={open} onClose={() => setOpen(false)} />
    </>
  )
}

describe("useShortcutsOverlay", () => {
  it("opens on ? and closes on a second press", async () => {
    render(<Harness />)
    expect(screen.getByTestId("state")).toHaveTextContent("closed")
    await userEvent.keyboard("?")
    expect(screen.getByTestId("state")).toHaveTextContent("open")
    await userEvent.keyboard("?")
    expect(screen.getByTestId("state")).toHaveTextContent("closed")
  })

  it("matches the character, not the physical key", async () => {
    // `?` is unshifted on some layouts and lives on a different key on most
    // non-US ones; a keyCode check ships a shortcut that only exists on ANSI
    // hardware. Dispatching the key with no Shift must still open it.
    render(<Harness />)
    await userEvent.keyboard("{?>}")
    expect(screen.getByTestId("state")).toHaveTextContent("open")
  })

  it("stays shut while the user is typing a question", async () => {
    // "Why?" in a task title must not open the shortcut map mid-word.
    render(<Harness />)
    await userEvent.click(screen.getByLabelText("title"))
    await userEvent.keyboard("Why?")
    expect(screen.getByTestId("state")).toHaveTextContent("closed")
  })

  it("stays shut in a textarea and in a contenteditable too", async () => {
    render(<Harness />)
    await userEvent.click(screen.getByLabelText("notes"))
    await userEvent.keyboard("?")
    expect(screen.getByTestId("state")).toHaveTextContent("closed")

    screen.getByLabelText("rich").focus()
    await userEvent.keyboard("?")
    expect(screen.getByTestId("state")).toHaveTextContent("closed")
  })

  it("leaves a modified ? to the browser", async () => {
    render(<Harness />)
    await userEvent.keyboard("{Control>}?{/Control}")
    expect(screen.getByTestId("state")).toHaveTextContent("closed")
  })

  it("stops listening once it unmounts", async () => {
    const view = render(<Harness />)
    view.unmount()
    // No handler left behind means no state update on an unmounted tree.
    await userEvent.keyboard("?")
    expect(screen.queryByTestId("state")).toBeNull()
  })
})
