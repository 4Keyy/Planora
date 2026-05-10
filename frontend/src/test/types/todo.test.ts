import { describe, expect, it } from "vitest"
import {
  isCompletedTodoStatus,
  TodoPriorityLabels,
  TodoPriorityOrder,
  TodoStatus,
  TodoStatusLabels,
  toApiTodoStatus,
} from "@/types/todo"
import { toCategoryList } from "@/types/category"

describe("todo status normalization", () => {
  it.each([
    [TodoStatus.Pending, "todo"],
    ["pending", "todo"],
    ["todo", "todo"],
    [TodoStatus.InProgress, "inprogress"],
    ["in progress", "inprogress"],
    [TodoStatus.Done, "done"],
    [TodoStatus.Completed, "done"],
    ["unknown", "todo"],
    [null, "todo"],
  ] as const)("normalizes %s to API status %s", (input, expected) => {
    expect(toApiTodoStatus(input)).toBe(expected)
  })

  it("detects both active backend completion aliases", () => {
    expect(isCompletedTodoStatus("done")).toBe(true)
    expect(isCompletedTodoStatus("completed")).toBe(true)
    expect(isCompletedTodoStatus("inprogress")).toBe(false)
  })

  it("keeps labels and priority order compatible with legacy backend values", () => {
    expect(TodoStatusLabels.Completed).toBe("Done")
    expect(TodoPriorityLabels.Critical).toBe("Urgent")
    expect(TodoPriorityLabels["5"]).toBe("Urgent")
    expect(TodoPriorityOrder.Critical).toBe(5)
    expect(TodoPriorityOrder["1"]).toBe(1)
  })
})

describe("category list normalization", () => {
  it("supports raw arrays, wrapped item arrays, null items, and empty responses", () => {
    const categories = [{ id: "cat-1", name: "Work" }]

    expect(toCategoryList(categories)).toBe(categories)
    expect(toCategoryList({ items: categories })).toBe(categories)
    expect(toCategoryList({ items: null })).toEqual([])
    expect(toCategoryList(undefined)).toEqual([])
  })
})
