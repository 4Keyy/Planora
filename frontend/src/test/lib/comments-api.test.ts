import { afterEach, describe, expect, it, vi } from "vitest"
import { api, addComment, fetchComments } from "@/lib/api"

describe("comment API helpers (branch replies)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("addComment POSTs a plain message without a replyTo block", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({
      data: { value: { id: "c1", content: "Hello", isOwn: true } },
    } as never)

    const created = await addComment("t1", "Hello")

    expect(post).toHaveBeenCalledWith("/collaboration/api/v1/comments/t1", { content: "Hello" })
    expect(created.id).toBe("c1")
  })

  it("addComment POSTs replyTo {type, id} when replying to a comment", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({
      data: {
        value: {
          id: "c2", content: "Agreed", isOwn: true,
          replyToType: "comment", replyToId: "c1",
          replyToAuthorName: "Anna M", replyToPreview: "Original",
        },
      },
    } as never)

    const created = await addComment("t1", "Agreed", { type: "comment", id: "c1" })

    expect(post).toHaveBeenCalledWith(
      "/collaboration/api/v1/comments/t1",
      { content: "Agreed", replyTo: { type: "comment", id: "c1" } },
    )
    expect(created.replyToType).toBe("comment")
    expect(created.replyToId).toBe("c1")
    expect(created.replyToPreview).toBe("Original")
  })

  it("addComment POSTs replyTo {type: subtask} when quoting a subtask card", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({
      data: {
        value: {
          id: "c3", content: "On it", isOwn: true,
          replyToType: "subtask", replyToId: "s1",
          replyToPreview: "Collect the numbers",
        },
      },
    } as never)

    const created = await addComment("t1", "On it", { type: "subtask", id: "s1" })

    expect(post).toHaveBeenCalledWith(
      "/collaboration/api/v1/comments/t1",
      { content: "On it", replyTo: { type: "subtask", id: "s1" } },
    )
    expect(created.replyToType).toBe("subtask")
  })

  it("fetchComments surfaces reply fields (incl. deleted targets) untouched", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      data: {
        value: {
          items: [
            {
              id: "c4", content: "reply", isOwn: false,
              replyToType: "comment", replyToId: "gone",
              replyToPreview: "old text", replyToDeleted: true,
            },
          ],
          totalCount: 1,
        },
      },
    } as never)

    const page = await fetchComments("t1")

    expect(page.items[0].replyToDeleted).toBe(true)
    expect(page.items[0].replyToPreview).toBe("old text")
  })
})
