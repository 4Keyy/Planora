import { afterEach, describe, expect, it, vi } from "vitest"
import { api, duplicateTodo } from "@/lib/api"

describe("duplicateTodo API helper", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("POSTs the duplicate endpoint and unwraps the new task", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({
      data: { value: { id: "copy-1", title: "Quarterly report", parentTodoId: null } },
    } as never)

    const copy = await duplicateTodo("src-1")

    expect(post).toHaveBeenCalledWith("/todos/api/v1/todos/src-1/duplicate")
    expect(copy.id).toBe("copy-1")
    expect(copy.title).toBe("Quarterly report")
  })

  it("sends no request body (the server authors the copy)", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({
      data: { data: { id: "copy-2" } },
    } as never)

    await duplicateTodo("src-2")

    // Exactly one argument — the URL; no payload is forwarded from the client.
    expect(post.mock.calls[0]).toHaveLength(1)
  })
})
