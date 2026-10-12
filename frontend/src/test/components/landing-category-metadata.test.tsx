import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { Todo } from "@/types/todo"
import { CATEGORY_COLOR_SWATCHES } from "@/components/todos/edit-todo-modal/utils"

vi.mock("@/components/todos/todo-card", () => ({
  TodoCard: ({ todo }: { todo: Todo }) => (
    <article
      data-testid="task"
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

  it("clears all owner category fields from the hidden viewer and restores them on reveal", () => {
    render(<ViewerSide />)
    const owner = within(screen.getByRole("region", { name: "Victoria's list" }))
    const viewer = within(screen.getByRole("region", { name: "Your list" }))
    expect(viewer.getByTestId("task")).toHaveAttribute("data-icon", "Home")
    expect(viewer.getByTestId("task")).toHaveAttribute("data-color", CATEGORY_COLOR_SWATCHES[1])

    fireEvent.click(viewer.getByRole("button", { name: "Hide it from your list" }))
    expect(viewer.getByTestId("task")).toHaveTextContent("Hidden task")
    for (const field of ["category", "icon", "color"]) {
      expect(viewer.getByTestId("task")).toHaveAttribute(`data-${field}`, "")
    }
    expect(owner.getByTestId("task")).toHaveAttribute("data-icon", "Home")
    expect(owner.getByTestId("task")).toHaveAttribute("data-color", CATEGORY_COLOR_SWATCHES[1])

    fireEvent.click(viewer.getByRole("button", { name: "Show it again" }))
    expect(viewer.getByTestId("task")).toHaveAttribute("data-icon", "Home")
    expect(viewer.getByTestId("task")).toHaveAttribute("data-color", CATEGORY_COLOR_SWATCHES[1])
  })
})
