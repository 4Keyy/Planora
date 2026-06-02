import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { QuickFilterBar } from "@/components/todos/quick-filter-bar"
import type { Category } from "@/types/category"

const cat = (id: string, overrides: Partial<Category> = {}): Category => ({
  id,
  name: `Cat ${id}`,
  color: "#ff0000",
  icon: "Briefcase",
  ...overrides,
})

// Mix of icon variants to exercise every chip branch:
//  a → known icon, b → no icon + no colour (fallback dot + default colour),
//  c → unknown icon key (ICON_MAP miss → fallback dot), d/e → known icons.
const cats: Category[] = [
  cat("a"),
  cat("b", { icon: null, color: null }),
  cat("c", { icon: "NopeUnknownIcon" }),
  cat("d"),
  cat("e"),
]

describe("QuickFilterBar", () => {
  it("idle: shows the hint + F shortcut, no clear button, and opens the menu", () => {
    const onOpen = vi.fn()
    const onClear = vi.fn()
    render(<QuickFilterBar categories={cats} selectedIds={[]} onOpen={onOpen} onClear={onClear} />)

    expect(screen.getByText(/Filter your tasks by categories/i)).toBeInTheDocument()
    expect(screen.getByText("F")).toBeInTheDocument()
    expect(screen.queryByLabelText("Clear category filter")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /Open Menu/i }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onClear).not.toHaveBeenCalled()
  })

  it("active (single): summarises as '1 category' and clears", () => {
    const onClear = vi.fn()
    const { container } = render(
      <QuickFilterBar categories={cats} selectedIds={["a"]} onOpen={vi.fn()} onClear={onClear} />,
    )

    expect(container.textContent).toContain("1 category")
    fireEvent.click(screen.getByLabelText("Clear category filter"))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it("active (many): pluralises, caps chips at 4, and shows a +N overflow", () => {
    const { container } = render(
      <QuickFilterBar
        categories={cats}
        selectedIds={["a", "b", "c", "d", "e"]}
        onOpen={vi.fn()}
        onClear={vi.fn()}
      />,
    )

    expect(container.textContent).toContain("categories")
    // 5 selected − 4 shown chips = +1 overflow
    expect(container.textContent).toContain("+1")
  })

  it("ignores selected ids that are not present in the categories list", () => {
    const { container } = render(
      <QuickFilterBar categories={cats} selectedIds={["does-not-exist"]} onOpen={vi.fn()} onClear={vi.fn()} />,
    )
    // Still in the active branch (an id is selected) but renders no chips.
    expect(screen.getByLabelText("Clear category filter")).toBeInTheDocument()
    expect(container.querySelectorAll("[title]").length).toBe(0)
  })
})
