import { describe, expect, it } from "vitest"
import { applyCategoryPatch, putBack } from "@/utils/todo-utils"
import type { Todo } from "@/types/todo"

const base: Todo = {
  id: "t1",
  userId: "u1",
  title: "Task",
  description: null,
  status: "todo",
  categoryId: "cat-1",
  categoryName: "Work",
  categoryColor: "#111",
  categoryIcon: "Briefcase",
  dueDate: null,
  expectedDate: null,
  actualDate: null,
  priority: "medium",
  isPublic: false,
  isCompleted: false,
  hidden: false,
  completedAt: null,
  isOnTime: null,
  delay: null,
  tags: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: null,
  sharedWithUserIds: [],
}

describe("applyCategoryPatch", () => {
  it("returns the original todo unchanged when categoryId is a non-null string", () => {
    const result = applyCategoryPatch({ ...base }, "cat-2")
    expect(result.categoryId).toBe("cat-1")
    expect(result.categoryName).toBe("Work")
    expect(result.categoryColor).toBe("#111")
    expect(result.categoryIcon).toBe("Briefcase")
  })

  it("returns the original todo unchanged when categoryId is undefined", () => {
    const result = applyCategoryPatch({ ...base }, undefined)
    expect(result.categoryId).toBe("cat-1")
    expect(result.categoryName).toBe("Work")
  })

  it("clears all four category fields when categoryId is the empty GUID the editor sends", () => {
    const result = applyCategoryPatch({ ...base }, "00000000-0000-0000-0000-000000000000")
    expect(result.categoryId).toBeNull()
    expect(result.categoryName).toBeNull()
    expect(result.categoryColor).toBeNull()
    expect(result.categoryIcon).toBeNull()
  })

  it("clears all four category fields when categoryId is null", () => {
    const result = applyCategoryPatch({ ...base }, null)
    expect(result.categoryId).toBeNull()
    expect(result.categoryName).toBeNull()
    expect(result.categoryColor).toBeNull()
    expect(result.categoryIcon).toBeNull()
  })

  it("preserves all non-category fields when clearing", () => {
    const result = applyCategoryPatch({ ...base }, null)
    expect(result.id).toBe("t1")
    expect(result.title).toBe("Task")
    expect(result.userId).toBe("u1")
  })

  it("is a no-op when category fields are already null and categoryId is null", () => {
    const noCat: Todo = { ...base, categoryId: null, categoryName: null, categoryColor: null, categoryIcon: null }
    const result = applyCategoryPatch(noCat, null)
    expect(result.categoryId).toBeNull()
    expect(result.categoryName).toBeNull()
  })
})

describe("putBack", () => {
  const a = { ...base, id: "a" }
  const b = { ...base, id: "b" }
  const c = { ...base, id: "c" }
  const ids = (list: Todo[]) => list.map((t) => t.id)

  it("puts a task back at the index it was taken from", () => {
    expect(ids(putBack([a, c], b, 1))).toEqual(["a", "b", "c"])
    expect(ids(putBack([b, c], a, 0))).toEqual(["a", "b", "c"])
  })

  it("puts it at the end when its place is gone or was never known", () => {
    expect(ids(putBack([a], c, 5))).toEqual(["a", "c"])
    expect(ids(putBack([a, b], c, -1))).toEqual(["a", "b", "c"])
  })

  it("leaves a list that already holds the task as it is", () => {
    const list = [a, b]
    expect(putBack(list, b, 0)).toBe(list)
  })

  it("does not change the list it was given", () => {
    const list = [a, c]
    putBack(list, b, 1)
    expect(ids(list)).toEqual(["a", "c"])
  })
})
