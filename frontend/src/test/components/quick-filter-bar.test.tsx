import { useState } from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { QuickFilterBar } from "@/components/todos/quick-filter-bar"
import { CategoryFilterModal } from "@/components/todos/category-filter-modal"
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
  it("opens the category filter on the shared motion path and lets it finish closing", async () => {
    function Filter() {
      const [open, setOpen] = useState(false)
      return <>
        <QuickFilterBar categories={cats} selectedIds={[]} onOpen={() => setOpen(true)} onClear={vi.fn()} />
        <CategoryFilterModal isOpen={open} onClose={() => setOpen(false)} categories={cats} selected={[]} onChange={vi.fn()} />
      </>
    }
    render(<Filter />)
    fireEvent.click(screen.getByRole("button", { name: "Choose categories" }))
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Filter Views by category")
    expect(screen.getByRole("dialog").style.animation).toBe("none")
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "closed")
    expect(screen.getByRole("dialog").parentElement).toHaveClass("pointer-events-none")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  }, 15_000)

  it("idle: shows the hint + F shortcut, no clear button, and opens the category picker", () => {
    const onOpen = vi.fn()
    const onClear = vi.fn()
    render(<QuickFilterBar categories={cats} selectedIds={[]} onOpen={onOpen} onClear={onClear} />)

    expect(screen.getByText(/Filter tasks by category/i)).toBeInTheDocument()
    expect(screen.getByText("F")).toBeInTheDocument()
    expect(screen.queryByLabelText("Clear category filter")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Choose categories" }))
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
