import { beforeEach, describe, expect, it } from "vitest"
import type { InternalAxiosRequestConfig } from "axios"
import type { Todo } from "@/types/todo"
import type { Category } from "@/types/category"
import { demoAdapter } from "@/lib/demo/adapter"
import { demo, DEMO_FRIENDS, DEMO_USER } from "@/lib/demo/state"
import { ICON_MAP } from "@/lib/icon-map"

const ROOT = "/todos/api/v1/todos"

async function call(path = "", method = "get", data?: unknown, params?: Record<string, unknown>) {
  return demoAdapter({
    url: ROOT + path,
    method,
    headers: {} as InternalAxiosRequestConfig["headers"],
    data: data === undefined ? undefined : JSON.stringify(data),
    params,
  } as InternalAxiosRequestConfig)
}

function expectCategory(todo: Todo, categoryId: string | null) {
  const category = demo.categories().find((c) => c.id === categoryId)
  expect(todo).toMatchObject({
    categoryId,
    categoryName: category?.name ?? null,
    categoryColor: category?.color ?? null,
    categoryIcon: category?.icon ?? null,
  })
}

beforeEach(() => demo.reset())

describe("demo task category metadata", () => {
  it("uses an existing icon key for every seeded category", () => {
    for (const category of demo.categories()) {
      expect(ICON_MAP[category.icon ?? ""], category.name).toBeDefined()
    }
  })

  it("enriches every list result from its category", async () => {
    const { items } = (await call()).data as { items: Todo[] }
    expect(items).toHaveLength(3)
    for (const todo of items) expectCategory(todo, todo.categoryId ?? null)
  })

  it.each(["dt-1", "dt-2", "dt-3", "dst-1"])("enriches the detail of %s", async (id) => {
    const todo = (await call(`/${id}`)).data as Todo
    expectCategory(todo, todo.categoryId ?? null)
  })

  it("reads current category data rather than stale task labels", async () => {
    const category = demo.categories().find((c) => c.id === "dc-1") as Category
    category.name = "Trips"
    category.color = "#123456"
    category.icon = "Car"
    const todo = (await call("/dt-1")).data as Todo
    expectCategory(todo, "dc-1")
  })

  it("enriches a created task and does not trust copied metadata", async () => {
    const created = (await call("", "post", {
      title: "Pack chargers",
      categoryId: "dc-1",
      categoryName: "Old category",
      categoryColor: "#000000",
      categoryIcon: "home",
    })).data as Todo
    expectCategory(created, "dc-1")
    const nextRead = (await call(`/${created.id}`)).data as Todo
    expectCategory(nextRead, "dc-1")
  })

  it.each(["put", "patch"])("refreshes category metadata after a %s", async (method) => {
    const updated = (await call("/dt-1", method, { categoryId: "dc-2" })).data as Todo
    expectCategory(updated, "dc-2")
    const nextRead = (await call("/dt-1")).data as Todo
    expectCategory(nextRead, "dc-2")
  })

  it.each([null, "missing-category"])("clears stale metadata for category %s", async (categoryId) => {
    const updated = (await call("/dt-1", "put", { categoryId })).data as Todo
    expectCategory(updated, categoryId)
  })

  it("enriches a duplicate and join response", async () => {
    const copy = (await call("/dt-1/duplicate", "post")).data as Todo
    expectCategory(copy, "dc-1")
    expect(copy.id).not.toBe("dt-1")
    const joined = (await call("/dt-2/join", "post")).data as Todo
    expectCategory(joined, "dc-2")
  })

  it.each([["dt-1", "dc-1"], ["dt-2", "dc-2"]])("enriches seeded and new subtasks of %s", async (parentId, categoryId) => {
    const seeded = (await call(`/${parentId}/subtasks`)).data as Todo[]
    for (const todo of seeded) expectCategory(todo, categoryId)
    const created = (await call(`/${parentId}/subtasks`, "post", { title: "Pack passport" })).data as Todo
    expectCategory(created, categoryId)
    expect(created.parentTodoId).toBe(parentId)
    const nextRead = (await call(`/${created.id}`)).data as Todo
    expectCategory(nextRead, categoryId)
  })

  it("retains the owner's category in masked shared task responses, then restores the task", async () => {
    const original = demo.todo("dt-1") as Todo
    await call("/dt-1/hidden", "patch", { hidden: true })
    const hidden = (await call("/dt-1")).data as Todo
    expect(hidden).toMatchObject({ title: "Hidden task", hidden: true, userId: DEMO_USER.userId })
    expectCategory(hidden, "dc-1")
    expect(hidden.description).toBeNull()
    const listed = (await call()).data as { items: Todo[] }
    expect(listed.items.find((todo) => todo.id === "dt-1")).toMatchObject(hidden)
    await call("/dt-1/hidden", "patch", { hidden: false })
    const restored = (await call("/dt-1")).data as Todo
    expect(restored.title).toBe(original.title)
    expect(restored.description).toBe(original.description)
    expectCategory(restored, "dc-1")
  })

  it("does not carry the owner's category into a hidden viewer response", async () => {
    demo.patchTodo("dt-1", {
      userId: DEMO_FRIENDS[0].id,
      hidden: true,
      authorCategoryName: "Travel",
      authorCategoryColor: "#0369a1",
      authorCategoryIcon: "Plane",
    })
    const hidden = (await call("/dt-1")).data as Todo
    expect(hidden).toMatchObject({ title: "Hidden task", hidden: true, userId: "00000000-0000-0000-0000-000000000000" })
    expectCategory(hidden, null)
    expect(hidden.authorCategoryName ?? null).toBeNull()
    expect(hidden.authorCategoryColor ?? null).toBeNull()
    expect(hidden.authorCategoryIcon ?? null).toBeNull()
  })


  it("preserves a viewer's own category on a masked task without exposing the author's", async () => {
    demo.patchTodo("dt-1", { userId: DEMO_FRIENDS[0].id })
    await call("/dt-1/viewer-preferences", "patch", {
      updateViewerCategory: true,
      viewerCategoryId: "dc-2",
      hiddenByViewer: true,
    })
    const hidden = (await call("/dt-1")).data as Todo
    expect(hidden.title).toBe("Hidden task")
    expectCategory(hidden, "dc-2")

    await call("/dt-1/viewer-preferences", "patch", {
      updateViewerCategory: true,
      viewerCategoryId: null,
    })
    expectCategory((await call("/dt-1")).data as Todo, null)
  })
  it.each([undefined, false, "false", true, "true"])("reveals hidden list data only for opt-in %s", async (revealHidden) => {
    const original = demo.todo("dt-1") as Todo
    demo.patchTodo("dt-1", { hidden: true })
    const { items } = (await call("", "get", undefined, { revealHidden })).data as { items: Todo[] }
    const listed = items.find((todo) => todo.id === "dt-1") as Todo
    const reveal = revealHidden === true || revealHidden === "true"
    expect(listed.hidden).toBe(true)
    expect(listed.title).toBe(reveal ? original.title : "Hidden task")
    expect(listed.description).toBe(reveal ? original.description : null)
    expectCategory(listed, "dc-1")
  })

  it("keeps the viewer's effective category in an opt-in hidden list response", async () => {
    const original = demo.todo("dt-1") as Todo
    demo.patchTodo("dt-1", { userId: DEMO_FRIENDS[0].id })
    await call("/dt-1/viewer-preferences", "patch", {
      updateViewerCategory: true,
      viewerCategoryId: "dc-2",
      hiddenByViewer: true,
    })
    const { items } = (await call("", "get", undefined, { revealHidden: true })).data as { items: Todo[] }
    const listed = items.find((todo) => todo.id === "dt-1") as Todo
    expect(listed).toMatchObject({ hidden: true, title: original.title, description: original.description })
    expectCategory(listed, "dc-2")
  })

  it("keeps detail and subtask reads masked even when revealHidden is supplied", async () => {
    demo.patchTodo("dt-1", { hidden: true })
    const detail = (await call("/dt-1", "get", undefined, { revealHidden: true })).data as Todo
    expect(detail.title).toBe("Hidden task")
    expectCategory(detail, "dc-1")

    demo.patchTodo("dst-2", { hidden: true, hasSharedAudience: true })
    const subtasks = (await call("/dt-1/subtasks", "get", undefined, { revealHidden: true })).data as Todo[]
    expect(subtasks.find((todo) => todo.id === "dst-2")?.title).toBe("Hidden task")
  })
  it.each([undefined, false, true])("returns private hidden list projection for revealHidden=%s", async (revealHidden) => {
    const description = "Private note"
    const dueDate = "2026-11-12T12:00:00.000Z"
    const dueDateStart = "2026-11-10T12:00:00.000Z"
    const expectedDate = "2026-11-09T12:00:00.000Z"
    const original = demo.patchTodo("dt-2", {
      hidden: true,
      description,
      dueDate,
      dueDateStart,
      expectedDate,
      tags: ["private"],
    }) as Todo
    const { items } = (await call("", "get", undefined, { revealHidden })).data as { items: Todo[] }
    const listed = items.find((todo) => todo.id === "dt-2") as Todo
    expect(listed).toMatchObject({ hidden: true, title: original.title, createdAt: original.createdAt })
    expectCategory(listed, "dc-2")
    if (revealHidden === true) {
      expect(listed).toMatchObject({ description, dueDate, dueDateStart, expectedDate, tags: ["private"] })
    } else {
      for (const field of ["description", "dueDate", "dueDateStart", "expectedDate"] as const) {
        expect(listed[field] ?? null, field).toBeNull()
      }
      expect(listed.tags).toEqual([])
      expect(listed.ownerCompleted).toBe(false)
    }

    const detail = (await call("/dt-2")).data as Todo
    expect(detail).toMatchObject({ description, dueDate, dueDateStart, expectedDate, tags: ["private"] })
    expectCategory(detail, "dc-2")
  })
  it("keeps a private owner's hidden task readable with its category", async () => {
    await call("/dt-2/hidden", "patch", { hidden: true })
    const hidden = (await call("/dt-2")).data as Todo
    expect(hidden.title).toBe("Renew the household insurance policy")
    expectCategory(hidden, "dc-2")
  })
})
