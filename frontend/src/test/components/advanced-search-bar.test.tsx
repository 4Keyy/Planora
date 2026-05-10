import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AdvancedSearchBar } from "@/components/todos/advanced-search-bar"
import { TodoPriority, TodoStatus, type Todo } from "@/types/todo"

const todo = (id: string, overrides: Partial<Todo> = {}): Todo => ({
  id,
  userId: "user-1",
  title: `Task ${id}`,
  status: TodoStatus.Pending,
  priority: TodoPriority.Medium,
  isPublic: false,
  isCompleted: false,
  tags: [],
  createdAt: "2026-05-01T00:00:00.000Z",
  ...overrides,
})

const defaultProps = {
  todos: [
    todo("1", { title: "Write tests", description: "Cover frontend", categoryName: "Work" }),
    todo("2", { title: "Cook dinner", priority: TodoPriority.Low, categoryName: "Home" }),
    todo("3", { title: "Release", priority: TodoPriority.Urgent }),
  ],
  value: "",
  onChange: vi.fn(),
  onStatusChange: vi.fn(),
  onPriorityChange: vi.fn(),
  onCategoryChange: vi.fn(),
  categories: [
    { id: "cat-1", name: "Work", color: "#007BFF" },
    { id: "cat-2", name: "Home", color: "#28A745" },
  ],
  currentStatus: "all",
  currentPriority: "all",
  currentCategory: "all",
}

describe("AdvancedSearchBar", () => {
  beforeEach(() => {
    localStorage.clear()
    Object.values(defaultProps).forEach((value) => {
      if (typeof value === "function") value.mockClear()
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("reports search changes and clears by Escape", () => {
    render(<AdvancedSearchBar {...defaultProps} />)

    fireEvent.change(screen.getByPlaceholderText(/Search tasks/), { target: { value: "release" } })
    expect(defaultProps.onChange).toHaveBeenLastCalledWith("release")

    fireEvent.keyDown(screen.getByPlaceholderText(/Search tasks/), { key: "Escape" })
    expect(defaultProps.onChange).toHaveBeenLastCalledWith("")
  })

  it("changes quick status filters", () => {
    render(<AdvancedSearchBar {...defaultProps} />)

    fireEvent.click(screen.getByRole("button", { name: "Active" }))
    fireEvent.click(screen.getByRole("button", { name: "Completed" }))

    expect(defaultProps.onStatusChange).toHaveBeenCalledWith("Todo,InProgress")
    expect(defaultProps.onStatusChange).toHaveBeenCalledWith("Done")
  })

  it("opens advanced filters and changes priority and category", () => {
    render(<AdvancedSearchBar {...defaultProps} />)

    fireEvent.click(screen.getByRole("button", { name: /Advanced/ }))
    fireEvent.click(screen.getByRole("button", { name: "All Categories" }))
    fireEvent.click(screen.getByRole("button", { name: "Urgent" }))
    fireEvent.click(screen.getByRole("button", { name: "Work" }))

    expect(defaultProps.onCategoryChange).toHaveBeenCalledWith("all")
    expect(defaultProps.onPriorityChange).toHaveBeenCalledWith("Urgent")
    expect(defaultProps.onCategoryChange).toHaveBeenCalledWith("cat-1")
    expect(screen.getByText("3 tasks found")).toBeInTheDocument()
  })

  it("uses the debounced value for match counts", () => {
    vi.useFakeTimers()
    const { rerender } = render(<AdvancedSearchBar {...defaultProps} value="" />)

    fireEvent.click(screen.getByRole("button", { name: /Advanced/ }))
    rerender(<AdvancedSearchBar {...defaultProps} value="write" />)

    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(screen.getByText("1 tasks found")).toBeInTheDocument()
  })

  it("clears search through the advanced clear action", () => {
    render(<AdvancedSearchBar {...defaultProps} value="work" />)

    fireEvent.click(screen.getByRole("button", { name: /Advanced/ }))
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }))

    expect(defaultProps.onChange).toHaveBeenCalledWith("")
  })

  it("loads recent searches defensively from localStorage", () => {
    localStorage.setItem("todoRecentSearches", JSON.stringify(["work", "home"]))

    render(<AdvancedSearchBar {...defaultProps} />)

    fireEvent.click(screen.getByRole("button", { name: /Advanced/ }))

    expect(screen.getByText("3 tasks found")).toBeInTheDocument()
  })
})
