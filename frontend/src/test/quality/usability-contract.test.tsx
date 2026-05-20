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
        shortcutHint="c"
      />,
    )

    expect(screen.getByText("New task")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open create task panel" })).toHaveAttribute("aria-expanded", "false")
    // shortcut hint rendered as kbd element inside the subtitle
    expect(screen.getByText("C")).toBeInTheDocument()
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
    expect(screen.getByRole("button", { name: "Create Task" })).toBeDisabled()
    expect(screen.getByRole("combobox")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Private task" })).toBeInTheDocument()
    expect(screen.queryByText("Visible to all friends")).not.toBeInTheDocument()
  })
})
