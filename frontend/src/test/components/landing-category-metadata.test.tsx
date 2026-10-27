import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { Todo } from "@/types/todo"
import { CATEGORY_COLOR_SWATCHES } from "@/components/todos/edit-todo-modal/utils"

vi.mock("@/components/todos/todo-card", () => ({
  TodoCard: ({ todo }: { todo: Todo }) => (
    <article
      data-testid="task"
      data-category-id={todo.categoryId ?? ""}
      data-category={todo.categoryName ?? ""}
      data-icon={todo.categoryIcon ?? ""}
      data-color={todo.categoryColor ?? ""}
    >
      {todo.title}
    </article>
  ),
}))

import { SHARED_TASK } from "@/app/_landing/fixtures"
import { ViewerSide } from "@/app/_landing/viewer-side"

describe("landing sharing category projection", () => {
  it("uses the Home icon and the landing Home swatch in the shared fixture", () => {
    expect(SHARED_TASK).toMatchObject({
      categoryName: "Home",
      categoryIcon: "Home",
      categoryColor: CATEGORY_COLOR_SWATCHES[1],
    })
  })

  it("keeps categories personal through completion, hiding, revealing and reset", () => {
    render(<ViewerSide />)
    const owner = within(screen.getByRole("region", { name: "Victoria's list" }))
    const viewer = within(screen.getByRole("region", { name: "Your list" }))

    const expectPersonalCategories = () => {
      for (const field of ["category-id", "category", "icon", "color"]) {
        expect(viewer.getByTestId("task")).toHaveAttribute(`data-${field}`, "")
      }
      expect(owner.getByTestId("task")).toHaveAttribute("data-category", "Home")
      expect(owner.getByTestId("task")).toHaveAttribute("data-icon", "Home")
      expect(owner.getByTestId("task")).toHaveAttribute("data-color", CATEGORY_COLOR_SWATCHES[1])
    }

    expectPersonalCategories()
    fireEvent.click(viewer.getByRole("button", { name: "Tick it off for yourself" }))
    expect(viewer.getByText("Done for you")).toBeInTheDocument()
    expectPersonalCategories()
    fireEvent.click(viewer.getByRole("button", { name: "Reopen it for yourself" }))
    expectPersonalCategories()

    fireEvent.click(viewer.getByRole("button", { name: "Hide it from your list" }))
    expect(viewer.getByTestId("task")).toHaveTextContent("Hidden task")
    expectPersonalCategories()

    fireEvent.click(viewer.getByRole("button", { name: "Show it again" }))
    expect(viewer.getByTestId("task")).toHaveTextContent(SHARED_TASK.title)
    expectPersonalCategories()
    fireEvent.click(owner.getByRole("button", { name: "Let Victoria finish it" }))
    expect(viewer.getByText("Done for everyone")).toBeInTheDocument()
    expectPersonalCategories()
    fireEvent.click(screen.getByRole("button", { name: "Start over" }))
    expectPersonalCategories()

    // Completion expands a previously hidden copy too.
    fireEvent.click(viewer.getByRole("button", { name: "Hide it from your list" }))
    fireEvent.click(viewer.getByRole("button", { name: "Tick it off for yourself" }))
    expect(viewer.getByText("Done for you")).toBeInTheDocument()
    expectPersonalCategories()
    fireEvent.click(viewer.getByRole("button", { name: "Reopen it for yourself" }))
    expect(viewer.getByTestId("task")).toHaveTextContent("Hidden task")
    expectPersonalCategories()
    fireEvent.click(owner.getByRole("button", { name: "Let Victoria finish it" }))
    expect(viewer.getByTestId("task")).toHaveTextContent(SHARED_TASK.title)
    expectPersonalCategories()
    fireEvent.click(owner.getByRole("button", { name: "Let Victoria reopen it" }))
    expect(viewer.getByTestId("task")).toHaveTextContent("Hidden task")
    expectPersonalCategories()
    fireEvent.click(screen.getByRole("button", { name: "Start over" }))
    expectPersonalCategories()
  })
})
