import type { ReactNode } from "react"
import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  useListNavigation,
  type ListNavigation,
  type ListNavigationOptions,
} from "@/hooks/use-list-navigation"

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
  // jsdom has no layout, so it has no scrollIntoView; the cursor effect calls it
  // on every move and would throw on the first `j` without this.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── Harness ────────────────────────────────────────────────────────────────

/**
 * Real rows, not a bare `renderHook`: `getRowProps` hands out a callback ref and
 * a roving tabindex, and neither is honestly covered unless React actually
 * attaches them to nodes.
 */
type NavBox = { current: ListNavigation | null }

function Harness({ navBox, extras, ...options }: ListNavigationOptions & { navBox: NavBox; extras?: ReactNode }) {
  const nav = useListNavigation(options)
  navBox.current = nav
  return (
    <>
      {extras}
      <ul aria-label="rows">
        {options.ids.map((id) => (
          <li key={id} data-testid="row" {...nav.getRowProps(id)}>
            {id}
          </li>
        ))}
      </ul>
    </>
  )
}

function renderList(options: ListNavigationOptions, extras?: ReactNode) {
  const navBox: NavBox = { current: null }
  const view = render(<Harness navBox={navBox} extras={extras} {...options} />)
  const nav = (): ListNavigation => {
    if (!navBox.current) throw new Error("harness never rendered")
    return navBox.current
  }
  const update = (next: ListNavigationOptions) =>
    view.rerender(<Harness navBox={navBox} extras={extras} {...next} />)
  return { nav, update, rows: () => screen.getAllByTestId("row") }
}

/**
 * A real event, dispatched by hand, for the assertions userEvent cannot make:
 * whether the hook called `preventDefault`, and what happened at a Date.now the
 * test chose.
 */
function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

const IDS = ["a", "b", "c"]

// ─── Moving the cursor ──────────────────────────────────────────────────────

describe("moving the cursor", () => {
  it("moves down on j and on ArrowDown", async () => {
    const { nav } = renderList({ ids: IDS })
    await userEvent.keyboard("j")
    expect(nav().activeId).toBe("a")
    await userEvent.keyboard("{ArrowDown}")
    expect(nav().activeId).toBe("b")
  })

  it("moves up on k and on ArrowUp", async () => {
    const { nav } = renderList({ ids: IDS })
    await userEvent.keyboard("G")
    await userEvent.keyboard("k")
    expect(nav().activeId).toBe("b")
    await userEvent.keyboard("{ArrowUp}")
    expect(nav().activeId).toBe("a")
  })

  it("lands the first j on the first row", async () => {
    // With no cursor yet the move has to start from the edge it came from, or the
    // list opens by jumping the reader into the middle of itself.
    const { nav } = renderList({ ids: IDS })
    await userEvent.keyboard("j")
    expect(nav().activeId).toBe("a")
  })

  it("lands the first k on the last row", async () => {
    const { nav } = renderList({ ids: IDS })
    await userEvent.keyboard("k")
    expect(nav().activeId).toBe("c")
  })

  it("clamps at the first row instead of wrapping to the last", async () => {
    // Wrapping teleports the reader to the far end of a long list and makes them
    // hunt for the cursor again.
    const { nav } = renderList({ ids: IDS })
    await userEvent.keyboard("j")
    await userEvent.keyboard("k")
    expect(nav().activeId).toBe("a")
  })

  it("clamps at the last row instead of wrapping to the first", async () => {
    const { nav } = renderList({ ids: IDS })
    await userEvent.keyboard("G")
    await userEvent.keyboard("j")
    expect(nav().activeId).toBe("c")
  })

  it("prevents the arrow keys' own scroll, which would fight the cursor's", () => {
    renderList({ ids: IDS })
    expect(press("ArrowDown").defaultPrevented).toBe(true)
    expect(press("ArrowUp").defaultPrevented).toBe(true)
  })

  it("does nothing at all when there are no rows to move through", async () => {
    const { nav } = renderList({ ids: [] })
    await userEvent.keyboard("jkG")
    expect(nav().activeId).toBeNull()
  })
})

// ─── Jumps ──────────────────────────────────────────────────────────────────

describe("gg and G", () => {
  it("jumps to the first row when the two g presses are close enough together", async () => {
    const { nav } = renderList({ ids: IDS })
    await userEvent.keyboard("G")
    expect(nav().activeId).toBe("c")
    await userEvent.keyboard("gg")
    expect(nav().activeId).toBe("a")
  })

  it("treats two g presses further apart than the chord window as two g presses", async () => {
    // Otherwise a `g` pressed and abandoned minutes ago would hijack the next one.
    const now = vi.spyOn(Date, "now")
    now.mockReturnValue(1_000)
    const { nav } = renderList({ ids: IDS })
    await userEvent.keyboard("G")

    press("g")
    now.mockReturnValue(1_000 + 600)
    press("g")
    expect(nav().activeId).toBe("c")
  })

  it("cancels a pending g when any other key is pressed between the two", async () => {
    // `g` then `k` then `g` is a move and a fresh half-chord, not a jump to the top.
    const { nav } = renderList({ ids: IDS })
    await userEvent.keyboard("G")
    await userEvent.keyboard("g")
    await userEvent.keyboard("k")
    expect(nav().activeId).toBe("b")
    await userEvent.keyboard("g")
    expect(nav().activeId).toBe("b")
  })

  it("jumps to the last row on G", async () => {
    const { nav } = renderList({ ids: IDS })
    await userEvent.keyboard("G")
    expect(nav().activeId).toBe("c")
  })
})

// ─── Acting on the active row ───────────────────────────────────────────────

describe("acting on the active row", () => {
  const callbacks = () => ({
    onActivate: vi.fn(),
    onToggleComplete: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onPriority: vi.fn(),
  })

  it("opens the active row on Enter", async () => {
    const cb = callbacks()
    renderList({ ids: IDS, ...cb })
    await userEvent.keyboard("jj{Enter}")
    expect(cb.onActivate).toHaveBeenCalledWith("b")
  })

  it("edits the active row on e", async () => {
    const cb = callbacks()
    renderList({ ids: IDS, ...cb })
    await userEvent.keyboard("je")
    expect(cb.onEdit).toHaveBeenCalledWith("a")
  })

  it("deletes the active row on Delete and on Backspace", async () => {
    const cb = callbacks()
    renderList({ ids: IDS, ...cb })
    await userEvent.keyboard("G{Delete}")
    expect(cb.onDelete).toHaveBeenCalledWith("c")
    await userEvent.keyboard("{Backspace}")
    expect(cb.onDelete).toHaveBeenCalledTimes(2)
  })

  it("prevents Backspace, which still means 'back' in some browsers", () => {
    const cb = callbacks()
    renderList({ ids: IDS, ...cb })
    press("G", { shiftKey: true })
    expect(press("Backspace").defaultPrevented).toBe(true)
  })

  it("sets a priority from 1 to 5 on the active row", async () => {
    const cb = callbacks()
    renderList({ ids: IDS, ...cb })
    await userEvent.keyboard("j1")
    expect(cb.onPriority).toHaveBeenCalledWith("a", 1)
    await userEvent.keyboard("5")
    expect(cb.onPriority).toHaveBeenLastCalledWith("a", 5)
  })

  it("ignores digits outside the priority range", async () => {
    const cb = callbacks()
    renderList({ ids: IDS, ...cb })
    await userEvent.keyboard("j06")
    expect(cb.onPriority).not.toHaveBeenCalled()
  })

  it("completes the active row on Space and swallows the page-down that Space means", () => {
    // Without preventDefault the page jumps a screenful on every completion.
    const cb = callbacks()
    renderList({ ids: IDS, ...cb })
    press("j")
    const event = press(" ")
    expect(cb.onToggleComplete).toHaveBeenCalledWith("a")
    expect(event.defaultPrevented).toBe(true)
  })

  it("does nothing when there is no cursor to act on", async () => {
    const cb = callbacks()
    renderList({ ids: IDS, ...cb })
    await userEvent.keyboard("{Enter}e{Delete}3")
    expect(cb.onActivate).not.toHaveBeenCalled()
    expect(cb.onEdit).not.toHaveBeenCalled()
    expect(cb.onDelete).not.toHaveBeenCalled()
    expect(cb.onPriority).not.toHaveBeenCalled()
  })

  it("stands down for a key another handler has already claimed", () => {
    const cb = callbacks()
    renderList({ ids: IDS, ...cb })
    press("j")
    const event = new KeyboardEvent("keydown", { key: "e", bubbles: true, cancelable: true })
    event.preventDefault()
    act(() => {
      window.dispatchEvent(event)
    })
    expect(cb.onEdit).not.toHaveBeenCalled()
  })
})

// ─── Keys that belong to somebody else ──────────────────────────────────────

describe("keys typed into a text field belong to the text field", () => {
  const callbacks = () => ({
    onActivate: vi.fn(),
    onToggleComplete: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onPriority: vi.fn(),
  })

  const nothingFired = (cb: ReturnType<typeof callbacks>) => {
    expect(cb.onActivate).not.toHaveBeenCalled()
    expect(cb.onToggleComplete).not.toHaveBeenCalled()
    expect(cb.onEdit).not.toHaveBeenCalled()
    expect(cb.onDelete).not.toHaveBeenCalled()
    expect(cb.onPriority).not.toHaveBeenCalled()
  }

  it("leaves an input alone", async () => {
    // Typing "extra jam" into the composer must not edit a task, toggle three
    // others and delete one.
    const cb = callbacks()
    const { nav } = renderList({ ids: IDS, ...cb }, <input aria-label="title" />)
    await userEvent.keyboard("j")
    await userEvent.type(screen.getByLabelText("title"), "ejx 1")
    expect(screen.getByLabelText("title")).toHaveValue("ejx 1")
    nothingFired(cb)
    expect(nav().activeId).toBe("a")
  })

  it("leaves a textarea alone", async () => {
    const cb = callbacks()
    renderList({ ids: IDS, ...cb }, <textarea aria-label="notes" />)
    await userEvent.keyboard("j")
    await userEvent.type(screen.getByLabelText("notes"), "ejx 1")
    nothingFired(cb)
  })

  it("leaves a contenteditable region alone", async () => {
    // jsdom does not implement isContentEditable, which is exactly the gap the
    // closest("[contenteditable]") fallback exists to cover.
    const cb = callbacks()
    renderList(
      { ids: IDS, ...cb },
      <div contentEditable suppressContentEditableWarning tabIndex={0} data-testid="rich" />,
    )
    await userEvent.keyboard("j")
    act(() => {
      screen.getByTestId("rich").focus()
    })
    await userEvent.keyboard("ejx 1")
    nothingFired(cb)
  })

  it("leaves Enter and Space to a focused button inside a row", async () => {
    // The row carries a checkbox and an overflow menu; one Enter on the checkbox
    // used to both complete the task and open it.
    const cb = callbacks()
    renderList({ ids: IDS, ...cb }, <button type="button">toggle</button>)
    await userEvent.keyboard("j")
    act(() => {
      screen.getByRole("button", { name: "toggle" }).focus()
    })
    await userEvent.keyboard("{Enter}")
    await userEvent.keyboard(" ")
    expect(cb.onActivate).not.toHaveBeenCalled()
    expect(cb.onToggleComplete).not.toHaveBeenCalled()
  })

  it("still answers e and Delete while a button has focus — only Enter and Space are the control's", async () => {
    const cb = callbacks()
    renderList({ ids: IDS, ...cb }, <button type="button">toggle</button>)
    await userEvent.keyboard("j")
    act(() => {
      screen.getByRole("button", { name: "toggle" }).focus()
    })
    await userEvent.keyboard("e")
    expect(cb.onEdit).toHaveBeenCalledWith("a")
  })
})

describe("modifiers the browser owns", () => {
  it("ignores Ctrl+D rather than deleting the active row", async () => {
    const onDelete = vi.fn()
    renderList({ ids: IDS, onDelete })
    await userEvent.keyboard("j")
    press("d", { ctrlKey: true })
    press("Backspace", { ctrlKey: true })
    press("Delete", { metaKey: true })
    expect(onDelete).not.toHaveBeenCalled()
  })

  it("ignores Alt combinations", async () => {
    const onEdit = vi.fn()
    const { nav } = renderList({ ids: IDS, onEdit })
    await userEvent.keyboard("j")
    press("e", { altKey: true })
    press("j", { altKey: true })
    expect(onEdit).not.toHaveBeenCalled()
    expect(nav().activeId).toBe("a")
  })
})

// ─── enabled ────────────────────────────────────────────────────────────────

describe("enabled: false", () => {
  it("is completely inert while something else owns the keyboard", async () => {
    const onEdit = vi.fn()
    const { nav, update } = renderList({ ids: IDS, onEdit })
    await userEvent.keyboard("j")

    update({ ids: IDS, onEdit, enabled: false })
    await userEvent.keyboard("jjeG")
    expect(onEdit).not.toHaveBeenCalled()
    expect(nav().activeId).toBe("a")
  })

  it("does not swallow keys it is not listening to", () => {
    const { update } = renderList({ ids: IDS })
    update({ ids: IDS, enabled: false })
    expect(press("ArrowDown").defaultPrevented).toBe(false)
  })

  it("returns the user to the row they left when it is enabled again", async () => {
    // Closing a dialog should not also cost you the place you were reading.
    const { nav, update } = renderList({ ids: IDS })
    await userEvent.keyboard("jj")
    expect(nav().activeId).toBe("b")

    update({ ids: IDS, enabled: false })
    update({ ids: IDS, enabled: true })
    expect(nav().activeId).toBe("b")

    await userEvent.keyboard("j")
    expect(nav().activeId).toBe("c")
  })

  it("does not let a g left pending across a disabled spell complete a chord", async () => {
    const { nav, update } = renderList({ ids: IDS })
    await userEvent.keyboard("G")
    await userEvent.keyboard("g")

    update({ ids: IDS, enabled: false })
    update({ ids: IDS, enabled: true })
    await userEvent.keyboard("g")
    expect(nav().activeId).toBe("c")
  })
})

// ─── The list changing under the cursor ─────────────────────────────────────

describe("the id list changing under the cursor", () => {
  it("moves the cursor to the nearest surviving row when its own row is removed", async () => {
    // Losing your place entirely is what makes keyboard navigation feel broken.
    const { nav, update } = renderList({ ids: IDS })
    await userEvent.keyboard("G")
    expect(nav().activeId).toBe("c")

    update({ ids: ["a", "b"] })
    expect(nav().activeId).toBe("b")
  })

  it("keeps the cursor on its own row when the list merely reorders", async () => {
    // The cursor is an id, not an index: a realtime reorder must not hand the
    // user a different task than the one they were reading.
    const { nav, update } = renderList({ ids: IDS })
    await userEvent.keyboard("jj")
    expect(nav().activeId).toBe("b")

    update({ ids: ["c", "b", "a"] })
    expect(nav().activeId).toBe("b")
  })

  it("has no cursor once the list is empty", async () => {
    const { nav, update } = renderList({ ids: IDS })
    await userEvent.keyboard("j")
    update({ ids: [] })
    expect(nav().activeId).toBeNull()
  })

  it("drops removed ids from the selection", async () => {
    // A bulk action sent for a task that is already deleted is a 404 per row.
    const { nav, update } = renderList({ ids: IDS })
    await userEvent.keyboard("jx")
    await userEvent.keyboard("jx")
    expect(nav().selectedIds).toEqual(["a", "b"])

    update({ ids: ["a", "c"] })
    expect(nav().selectedIds).toEqual(["a"])
  })
})

// ─── Selection ──────────────────────────────────────────────────────────────

describe("the selection", () => {
  it("toggles the active row in and out on x", async () => {
    const { nav } = renderList({ ids: IDS })
    await userEvent.keyboard("jx")
    expect(nav().selectedIds).toEqual(["a"])
    await userEvent.keyboard("x")
    expect(nav().selectedIds).toEqual([])
  })

  it("comes back in list order, not in the order the rows were picked", async () => {
    // The caller renders and submits this array; out of order it reads as a
    // shuffled list to anyone reviewing a bulk action before confirming it.
    const { nav } = renderList({ ids: IDS })
    await userEvent.keyboard("G")
    await userEvent.keyboard("x")
    await userEvent.keyboard("gg")
    await userEvent.keyboard("x")
    expect(nav().selectedIds).toEqual(["a", "c"])
  })

  it("extends on Shift+ArrowDown", async () => {
    const { nav } = renderList({ ids: IDS })
    await userEvent.keyboard("j")
    await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}")
    expect(nav().selectedIds).toEqual(["a", "b"])
    expect(nav().activeId).toBe("b")
  })

  it("extends on Shift+J, which arrives as the character 'J'", async () => {
    // Shift rewrites the character it produces, so reading event.shiftKey on the
    // 'j' branch matched nothing and the vim binding was dead code that compiled.
    const { nav } = renderList({ ids: IDS })
    await userEvent.keyboard("j")
    await userEvent.keyboard("{Shift>}J{/Shift}")
    expect(nav().selectedIds).toEqual(["a", "b"])
    expect(nav().activeId).toBe("b")
  })

  it("shrinks again when the extension is walked back", async () => {
    const { nav } = renderList({ ids: IDS })
    await userEvent.keyboard("j")
    await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}")
    await userEvent.keyboard("{Shift>}K{/Shift}")
    expect(nav().selectedIds).toEqual(["a"])
  })

  it("selects everything on Ctrl+A and keeps the browser out of it", () => {
    // Leaving ⌘A to select the page's text inside a task list is technically the
    // browser default and practically a bug.
    const { nav } = renderList({ ids: IDS })
    const event = press("a", { ctrlKey: true })
    expect(nav().selectedIds).toEqual(IDS)
    expect(event.defaultPrevented).toBe(true)
  })

  it("selects everything on Meta+A too, shifted or not", () => {
    const { nav } = renderList({ ids: IDS })
    const event = press("A", { metaKey: true, shiftKey: true })
    expect(nav().selectedIds).toEqual(IDS)
    expect(event.defaultPrevented).toBe(true)
  })

  it("gives the browser its select-all back when there is nothing to select", () => {
    // An empty list has no selection to make, so ⌘A should still select the page.
    const { nav } = renderList({ ids: [] })
    const event = press("a", { ctrlKey: true })
    expect(nav().selectedIds).toEqual([])
    expect(event.defaultPrevented).toBe(false)
  })

  it("clears the selection on the first Escape and the cursor only on the second", async () => {
    // Cancelling a ten-row selection must not also cost the ten presses it took
    // to reach the row you were on.
    const { nav } = renderList({ ids: IDS })
    await userEvent.keyboard("jx")
    await userEvent.keyboard("jx")

    await userEvent.keyboard("{Escape}")
    expect(nav().selectedIds).toEqual([])
    expect(nav().activeId).toBe("b")

    await userEvent.keyboard("{Escape}")
    expect(nav().activeId).toBeNull()
  })

  it("leaves Escape unprevented for whatever layer is outside the list", async () => {
    renderList({ ids: IDS })
    await userEvent.keyboard("j")
    expect(press("Escape").defaultPrevented).toBe(false)
  })

  it("is cleared by clearSelection without disturbing the cursor", async () => {
    const { nav } = renderList({ ids: IDS })
    await userEvent.keyboard("jx")
    act(() => nav().clearSelection())
    expect(nav().selectedIds).toEqual([])
    expect(nav().activeId).toBe("a")
  })
})

describe("onSelectionChange", () => {
  it("is not called with the empty selection every list starts with", () => {
    // A bulk-action bar that flickers open on mount is worse than a missed call.
    const onSelectionChange = vi.fn()
    renderList({ ids: IDS, onSelectionChange })
    expect(onSelectionChange).not.toHaveBeenCalled()
  })

  it("is called on a real change", async () => {
    const onSelectionChange = vi.fn()
    renderList({ ids: IDS, onSelectionChange })
    await userEvent.keyboard("jx")
    expect(onSelectionChange).toHaveBeenCalledWith(["a"])
  })

  it("is called with the empty array once a selection has been emptied again", async () => {
    const onSelectionChange = vi.fn()
    renderList({ ids: IDS, onSelectionChange })
    await userEvent.keyboard("jx")
    await userEvent.keyboard("{Escape}")
    expect(onSelectionChange).toHaveBeenLastCalledWith([])
  })
})

// ─── getRowProps ────────────────────────────────────────────────────────────

describe("getRowProps", () => {
  it("puts exactly one row in the tab order", async () => {
    const { rows } = renderList({ ids: IDS })
    await userEvent.keyboard("jj")
    expect(rows().filter((row) => row.tabIndex === 0)).toHaveLength(1)
    expect(rows()[1].tabIndex).toBe(0)
  })

  it("makes the first row tabbable before any cursor exists, so Tab can enter the list", () => {
    // A list where every row is tabIndex -1 is unreachable by keyboard, which is
    // the exact failure the roving pattern is usually introduced to cause.
    const { rows } = renderList({ ids: IDS })
    expect(rows()[0].tabIndex).toBe(0)
    expect(rows()[1].tabIndex).toBe(-1)
    expect(rows()[2].tabIndex).toBe(-1)
  })

  it("marks the active row for styling", async () => {
    const { rows } = renderList({ ids: IDS })
    await userEvent.keyboard("j")
    expect(rows()[0]).toHaveAttribute("data-active", "")
    expect(rows()[1]).not.toHaveAttribute("data-active")
  })

  it("names the cursor to assistive technology with aria-current, on one row only", async () => {
    // aria-selected would be illegal here: it needs option/row semantics, and an
    // option may not contain the checkbox and menu every row in this product has.
    const { rows } = renderList({ ids: IDS })
    for (const row of rows()) expect(row).not.toHaveAttribute("aria-current")

    await userEvent.keyboard("jj")
    expect(rows().filter((row) => row.getAttribute("aria-current") === "true")).toHaveLength(1)
    expect(rows()[1]).toHaveAttribute("aria-current", "true")
  })

  it("marks selected rows with data-selected and leaves the unselected ones bare", async () => {
    // Valueless and absent rather than "false": the selection is spoken by the
    // bulk-action bar's count, and a row carrying an invalid ARIA attribute would
    // only look handled.
    const { rows } = renderList({ ids: IDS })
    await userEvent.keyboard("jx")
    expect(rows()[0]).toHaveAttribute("data-selected", "")
    expect(rows()[1]).not.toHaveAttribute("data-selected")
  })

  it("makes a row active when it takes focus", async () => {
    const { nav, rows } = renderList({ ids: IDS })
    await userEvent.tab()
    expect(rows()[0]).toHaveFocus()
    expect(nav().activeId).toBe("a")
  })

  it("moves the cursor on setActiveId", () => {
    const { nav, rows } = renderList({ ids: IDS })
    act(() => nav().setActiveId("c"))
    expect(nav().activeId).toBe("c")
    expect(rows()[2].tabIndex).toBe(0)
  })

  it("hands back the mounted node for a row, so a keyboard open can animate from the same rect a click would", () => {
    const { nav, rows } = renderList({ ids: IDS })
    expect(nav().getRowNode("b")).toBe(rows()[1])
  })

  it("has no node for a row that is not in the list", () => {
    const { nav } = renderList({ ids: IDS })
    expect(nav().getRowNode("nope")).toBeNull()
  })

  it("forgets the node of a row that has left the list", async () => {
    // A long session must not accumulate a detached node per task it ever showed.
    const { nav, update } = renderList({ ids: IDS })
    await userEvent.keyboard("j")
    update({ ids: ["b", "c"] })
    expect(nav().getRowNode("a")).toBeNull()
  })

  it("scrolls the active row into view only as far as it has to", async () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView")
    renderList({ ids: IDS })
    await userEvent.keyboard("j")
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "nearest" }))
  })
})
