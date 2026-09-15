import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CreateTodoPanel } from "@/components/todos/create-todo-panel"
import type { Category } from "@/types/category"

vi.mock("@/hooks/use-friends", () => ({
  useFriends: () => [],
}))

vi.mock("@/lib/api", () => ({
  api: {
    post: vi.fn(),
  },
  parseApiResponse: (response: any) => {
    if (response && typeof response === "object" && "value" in response) return response.value
    if (response && typeof response === "object" && "data" in response) return response.data
    return response
  },
}))

const categories: Category[] = [
  { id: "cat-1", name: "Work", color: "#111827", icon: "Briefcase" },
]

describe("frontend usability contract", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Element.prototype.hasPointerCapture ??= vi.fn(() => false)
    Element.prototype.setPointerCapture ??= vi.fn()
    Element.prototype.releasePointerCapture ??= vi.fn()
    HTMLElement.prototype.scrollIntoView ??= vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("collapsed panel shows 'New task' title and keyboard shortcut hint", () => {
    render(
      <CreateTodoPanel
        isOpen={false}
        onToggle={vi.fn()}
        categories={categories}
        onSubmit={vi.fn()}
        onCreateCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
      />,
    )

    expect(screen.getByText("New task")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open create task panel" })).toHaveAttribute("aria-expanded", "false")

    // The subtitle says what this panel is FOR, and deliberately advertises no key.
    // It used to print "press C to open" — and `C` opens quick capture, which asks
    // for a title and nothing else. A printed key that does something else teaches
    // the wrong binding, and the user only finds out from a surface that disagrees.
    expect(screen.getByText(/Date, category, audience/i)).toBeInTheDocument()
    expect(screen.queryByText(/press/i)).toBeNull()
  })

  it("autofocuses task creation and exposes core controls through accessible roles", () => {
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

    act(() => {
      vi.advanceTimersByTime(220)
    })

    expect(screen.getByPlaceholderText("What needs to be done?")).toHaveFocus()
    expect(screen.getByRole("button", { name: "Close create task panel" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Create task" })).toBeDisabled()
    // The four selector plates are reachable by accessible name
    expect(screen.getByRole("button", { name: "Priority" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Due date" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Category" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Private task" })).toBeInTheDocument()
    expect(screen.queryByText("Visible to all friends")).not.toBeInTheDocument()
  })
})
