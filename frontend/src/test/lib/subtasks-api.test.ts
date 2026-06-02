import { afterEach, describe, expect, it, vi } from "vitest"
import { api, fetchSubtasks, createSubtask, updateSubtask, deleteSubtask } from "@/lib/api"

describe("subtask API helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("fetchSubtasks GETs the parent's subtasks endpoint and unwraps the list", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue({
      data: { success: true, data: [{ id: "s1", title: "Step 1", parentTodoId: "p1" }] },
    } as never)

    const result = await fetchSubtasks("p1")

    expect(get).toHaveBeenCalledWith("/todos/api/v1/todos/p1/subtasks")
    expect(result).toEqual([{ id: "s1", title: "Step 1", parentTodoId: "p1" }])
  })

  it("createSubtask POSTs title + numeric priority to the subtasks endpoint", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({
      data: { value: { id: "s2", title: "Step 2", priority: "Urgent", parentTodoId: "p1" } },
    } as never)

    const created = await createSubtask("p1", { title: "Step 2", priority: 5 })

    expect(post).toHaveBeenCalledWith("/todos/api/v1/todos/p1/subtasks", { title: "Step 2", priority: 5 })
    expect(created.id).toBe("s2")
  })

  it("updateSubtask PUTs to the shared todo update endpoint by subtask id", async () => {
    const put = vi.spyOn(api, "put").mockResolvedValue({
      data: { data: { id: "s1", status: "Done" } },
    } as never)

    await updateSubtask("s1", { status: "done" })

    expect(put).toHaveBeenCalledWith("/todos/api/v1/todos/s1", { status: "done" })
  })

  it("deleteSubtask DELETEs the subtask by id", async () => {
    const del = vi.spyOn(api, "delete").mockResolvedValue({ data: {} } as never)

    await deleteSubtask("s1")

    expect(del).toHaveBeenCalledWith("/todos/api/v1/todos/s1")
  })
})
