import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { CategoryFilterModal } from "@/components/todos/category-filter-modal"
import { TodoSkeleton } from "@/components/todos/todo-skeleton"
import type { Category } from "@/types/category"

const category = (id: string, overrides: Partial<Category> = {}): Category => ({
  id,
  name: `Category ${id}`,
  color: "#007BFF",
  icon: "Folder",
  ...overrides,
})

describe("small todo components", () => {
  it("renders a stable todo skeleton", () => {
    const { container } = render(<TodoSkeleton />)

    expect(container.firstElementChild).toHaveClass("animate-pulse")
  })

  it("renders category filter modal, toggles, resets, and closes by Escape", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onChange = vi.fn()
    const categories = [
      category("cat-1", { name: "Work" }),
      category("cat-2", { name: "Home", icon: "MissingIcon" }),
    ]

    render(
      <CategoryFilterModal
        isOpen
        onClose={onClose}
        categories={categories}
        selected={["cat-1"]}
        onChange={onChange}
      />,
    )

    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    expect(screen.getByText("Work")).toBeInTheDocument()
    expect(screen.getByText("Home")).toBeInTheDocument()
    expect(screen.getByText("1 Selected")).toBeInTheDocument()

    await user.click(screen.getByText("Work"))
    expect(onChange).toHaveBeenCalledWith([])

    await user.click(screen.getByText("Home"))
    expect(onChange).toHaveBeenCalledWith(["cat-1", "cat-2"])

    await user.click(screen.getByText("Reset All"))
    expect(onChange).toHaveBeenCalledWith([])

    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("renders category empty state and show-all action", async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <CategoryFilterModal
        isOpen
        onClose={vi.fn()}
        categories={[]}
        selected={[]}
        onChange={onChange}
      />,
    )

    await waitFor(() => expect(screen.getByText("No categories found")).toBeInTheDocument())

    rerender(
      <CategoryFilterModal
        isOpen
        onClose={vi.fn()}
        categories={[category("cat-1", { name: "Work" })]}
        selected={[]}
        onChange={onChange}
      />,
    )

    await userEvent.click(await screen.findByText("Show All Tasks"))
    expect(onChange).toHaveBeenCalledWith([])
  })
})
