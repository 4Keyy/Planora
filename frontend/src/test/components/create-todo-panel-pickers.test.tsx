import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CreateTodoPanel } from "@/components/todos/create-todo-panel"
import type { Category } from "@/types/category"

vi.mock("@/hooks/use-friends", () => ({
  useFriends: () => [
    { id: "friend-1", email: "ada@example.com", firstName: "Ada", lastName: "Lovelace", friendsSince: "2026-05-01T00:00:00.000Z" },
  ],
}))

const categories: Category[] = [{ id: "cat-1", name: "Work", color: "#2563eb", icon: "Briefcase" }]

/** A plate as a browser lays it out at 1440px: the second of four, 251px wide. */
const PLATE = { left: 459, width: 251, top: 416, height: 66 }

beforeEach(() => {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(1440)
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(900)
  // jsdom has no layout. Every element answers with the plate's box, which is all the
  // portal popover reads: the rect of the plate wrapper it is anchored to.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: PLATE.left,
    right: PLATE.left + PLATE.width,
    top: PLATE.top,
    bottom: PLATE.top + PLATE.height,
    width: PLATE.width,
    height: PLATE.height,
    x: PLATE.left,
    y: PLATE.top,
    toJSON: () => ({}),
  } as DOMRect)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("CreateTodoPanel pickers", () => {
  it.each([
    ["Priority", "Priority"],
    ["Due date", "Due date"],
    ["Category", "Category"],
    ["Share", "Private task"],
  ])("opens the %s picker centred under its plate", async (_, plateName) => {
    render(
      <CreateTodoPanel
        isOpen
        onToggle={vi.fn()}
        categories={categories}
        onSubmit={vi.fn()}
        onCreateCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: plateName }))

    const surface = await waitFor(() => {
      const el = document.querySelector<HTMLElement>("body > .dropdown-surface")
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    const left = parseFloat(surface.style.left)
    const width = parseFloat(surface.style.width)
    // The popover's centre is the plate's centre: it used to hang off the plate's left
    // edge (or, for Share, its right edge) and sit visibly off to one side.
    expect(left + width / 2).toBeCloseTo(PLATE.left + PLATE.width / 2, 5)
    expect(surface.style.transformOrigin).toBe("top center")
  })
})
