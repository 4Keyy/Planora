import { beforeEach, describe, expect, it } from "vitest"
import type { InternalAxiosRequestConfig } from "axios"
import { demoAdapter } from "@/lib/demo/adapter"
import { demo } from "@/lib/demo/state"

/**
 * The demo adapter answers the product's own HTTP contract, so these tests assert the
 * shapes the CLIENT reads — not the shapes a server DTO happens to have.
 *
 * That distinction is the whole reason this file exists. `docs/ui-audit/tools/mock-api.mjs`
 * had four response shapes wrong for its entire existence, and one of them meant the
 * branch feed rendered empty under every audit run without anyone noticing, because
 * `(res.items ?? [])` turns a wrong shape into an empty list rather than an error.
 */

function req(
  url: string,
  method = "get",
  opts: { data?: unknown; params?: Record<string, unknown> } = {}
): InternalAxiosRequestConfig {
  return {
    url,
    method,
    headers: {} as InternalAxiosRequestConfig["headers"],
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
    params: opts.params,
  } as InternalAxiosRequestConfig
}

const call = (...args: Parameters<typeof req>) => demoAdapter(req(...args))

beforeEach(() => demo.reset())

describe("the two asymmetric shapes", () => {
  it("returns comments PAGED, because fetchComments reads .items", async () => {
    const res = await call("/collaboration/api/v1/comments/dt-1")
    const body = res.data as { items: unknown[]; totalCount: number }
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items.length).toBeGreaterThan(0)
    expect(body.totalCount).toBe(body.items.length)
  })

  it("returns subtasks BARE, because branch-feed spreads the response", async () => {
    const res = await call("/todos/api/v1/todos/dt-1/subtasks")
    // `[...subtasks]` throws "t is not iterable" on an object. The two endpoints are not
    // symmetric and getting either backwards fails silently.
    expect(Array.isArray(res.data)).toBe(true)
    expect(() => [...(res.data as unknown[])]).not.toThrow()
  })
})

describe("matcher ordering", () => {
  it("does not let /todos swallow its own sub-resources", async () => {
    // `/todos` as a substring matches `/todos/{id}/subtasks` and
    // `/todos/{id}/viewer-preferences` too, so those must be tested first.
    const subtasks = await call("/todos/api/v1/todos/dt-1/subtasks")
    expect(Array.isArray(subtasks.data)).toBe(true)

    const prefs = await call("/todos/api/v1/todos/dt-1/viewer-preferences", "patch", {
      data: { completedByViewer: true },
    })
    expect(prefs.data).toHaveProperty("completedByViewer", true)
    expect(prefs.data).not.toHaveProperty("items")
  })
})

describe("the Author's Note is synthesised, not stored", () => {
  it("derives the genesis comment from the task description", async () => {
    // The server builds it from the live Todo description — CheckTaskCommentAccessResponse
    // carries `description` precisely so Collaboration can. Storing it as a row would
    // model the wrong thing and diverge the moment a description changed.
    const res = await call("/collaboration/api/v1/comments/dt-1")
    const items = (res.data as { items: Array<{ isGenesisComment?: boolean; content: string }> }).items
    const genesis = items.filter((c) => c.isGenesisComment)
    expect(genesis).toHaveLength(1)
    expect(genesis[0].content).toContain("Outbound looks cheapest")
    expect(items[0].isGenesisComment).toBe(true)
  })

  it("omits it for a task with no description", async () => {
    const res = await call("/collaboration/api/v1/comments/dt-2")
    const items = (res.data as { items: Array<{ isGenesisComment?: boolean }> }).items
    expect(items.some((c) => c.isGenesisComment)).toBe(false)
  })
})

describe("mutations really mutate", () => {
  it("a posted comment comes back on the next read", async () => {
    // An optimistic update that is never contradicted proves nothing; a refetch that
    // returns stale data is how a demo quietly diverges from the product.
    const before = (await call("/collaboration/api/v1/comments/dt-1")).data as { totalCount: number }

    await call("/collaboration/api/v1/comments/dt-1", "post", { data: { content: "On it." } })

    const after = (await call("/collaboration/api/v1/comments/dt-1")).data as {
      totalCount: number
      items: Array<{ content: string }>
    }
    expect(after.totalCount).toBe(before.totalCount + 1)
    expect(after.items.at(-1)?.content).toBe("On it.")
  })

  it("a reply carries the quoted author and preview", async () => {
    const res = await call("/collaboration/api/v1/comments/dt-1", "post", {
      data: { content: "Agreed.", replyToType: "comment", replyToId: "dcm-2" },
    })
    expect(res.data).toMatchObject({
      replyToType: "comment",
      replyToId: "dcm-2",
      replyToAuthorName: "Mira Sandoval",
    })
  })

  it("completing a task changes what the list returns", async () => {
    const activeBefore = (await call("/todos/api/v1/todos", "get", { params: { isCompleted: false } }))
      .data as { items: unknown[] }

    await call("/todos/api/v1/todos/dt-2", "put", { data: { status: "done" } })

    const activeAfter = (await call("/todos/api/v1/todos", "get", { params: { isCompleted: false } }))
      .data as { items: unknown[] }
    const done = (await call("/todos/api/v1/todos", "get", { params: { isCompleted: true } }))
      .data as { items: Array<{ id: string }> }

    expect(activeAfter.items.length).toBe(activeBefore.items.length - 1)
    expect(done.items.some((t) => t.id === "dt-2")).toBe(true)
  })

  it("a deleted task is gone, with its branch", async () => {
    await call("/todos/api/v1/todos/dt-1", "delete")
    const list = (await call("/todos/api/v1/todos")).data as { items: Array<{ id: string }> }
    expect(list.items.some((t) => t.id === "dt-1")).toBe(false)
    const comments = (await call("/collaboration/api/v1/comments/dt-1")).data as { items: unknown[] }
    expect(comments.items).toHaveLength(0)
  })

  it("reset() restores the seed, so each visitor starts clean", async () => {
    await call("/todos/api/v1/todos/dt-1", "delete")
    demo.reset()
    const list = (await call("/todos/api/v1/todos")).data as { items: Array<{ id: string }> }
    expect(list.items.some((t) => t.id === "dt-1")).toBe(true)
  })
})

describe("shapes the notification store reads", () => {
  it("summary carries totalUnread and perTask, not unreadCount", async () => {
    const res = await call("/realtime/api/v1/notifications/summary")
    expect(res.data).toHaveProperty("totalUnread")
    expect(res.data).toHaveProperty("perTask")
    expect(res.data).not.toHaveProperty("unreadCount")
  })

  it("the list is a bare array, because loadList maps over it", async () => {
    const res = await call("/realtime/api/v1/notifications")
    expect(Array.isArray(res.data)).toBe(true)
  })
})

describe("nothing hangs", () => {
  it("answers an unmatched path rather than leaving a pending promise", async () => {
    // A pending promise on a landing page is a spinner nobody can explain.
    const res = await call("/auth/api/v1/something/nobody/implemented")
    expect(res.status).toBe(200)
    expect(res.data).toEqual({ items: [], totalCount: 0 })
  })

  it("404s a task that does not exist, so the client's error path is real", async () => {
    const res = await call("/todos/api/v1/todos/nope")
    expect(res.status).toBe(404)
  })
})

describe("the friend list", () => {
  it("answers /friendships, which carries no service prefix", async () => {
    const res = await call("/friendships")
    expect(Array.isArray(res.data)).toBe(true)
    expect((res.data as Array<{ status: string }>)[0].status).toBe("Accepted")
  })
})

describe("the rest of the surface", () => {
  it("joins and leaves a task, moving the worker count", async () => {
    const joined = (await call("/todos/api/v1/todos/dt-2/join", "post")).data as {
      workerCount: number
      isWorking: boolean
    }
    expect(joined.isWorking).toBe(true)
    expect(joined.workerCount).toBe(1)

    await call("/todos/api/v1/todos/dt-2/leave", "post")
    const after = (await call("/todos/api/v1/todos/dt-2")).data as { workerCount: number }
    expect(after.workerCount).toBe(0)
  })

  it("duplicates a task into a new row rather than mutating the source", async () => {
    const before = (await call("/todos/api/v1/todos")).data as { items: unknown[] }
    const copy = (await call("/todos/api/v1/todos/dt-1/duplicate", "post")).data as {
      id: string
      title: string
    }
    const after = (await call("/todos/api/v1/todos")).data as { items: Array<{ id: string }> }

    expect(copy.id).not.toBe("dt-1")
    expect(copy.title).toBe("Book the flights for the spring trip")
    expect(after.items.length).toBe(before.items.length + 1)
    expect(after.items.some((t) => t.id === "dt-1")).toBe(true)
  })

  it("hides a task and reports the category back, as setTaskHidden reads it", async () => {
    const res = (await call("/todos/api/v1/todos/dt-1/hidden", "patch", {
      data: { hidden: true },
    })).data as { hidden: boolean; categoryName: string | null; categoryId: string | null }
    expect(res.hidden).toBe(true)
    expect(res.categoryName).toBe("Travel")
    expect(res.categoryId).toBe("dc-1")
  })

  it("edits and deletes a comment by its own id", async () => {
    const edited = (await call("/collaboration/api/v1/comments/dt-1/dcm-2", "put", {
      data: { content: "Changed my mind — Wednesday." },
    })).data as { content: string; isEdited: boolean }
    expect(edited.content).toBe("Changed my mind — Wednesday.")
    expect(edited.isEdited).toBe(true)

    await call("/collaboration/api/v1/comments/dt-1/dcm-2", "delete")
    const list = (await call("/collaboration/api/v1/comments/dt-1")).data as {
      items: Array<{ id: string }>
    }
    expect(list.items.some((c) => c.id === "dcm-2")).toBe(false)
  })

  it("creates a subtask under its parent", async () => {
    const created = (await call("/todos/api/v1/todos/dt-1/subtasks", "post", {
      data: { title: "Print the boarding passes" },
    })).data as { id: string; parentTodoId: string }
    expect(created.parentTodoId).toBe("dt-1")

    const list = (await call("/todos/api/v1/todos/dt-1/subtasks")).data as Array<{ id: string }>
    expect(list.some((s) => s.id === created.id)).toBe(true)
  })

  it("creates a task at the top of the list", async () => {
    const created = (await call("/todos/api/v1/todos", "post", {
      data: { title: "Pack the chargers" },
    })).data as { id: string; title: string }
    expect(created.title).toBe("Pack the chargers")

    const list = (await call("/todos/api/v1/todos")).data as { items: Array<{ id: string }> }
    expect(list.items[0].id).toBe(created.id)
  })

  it("answers the auth endpoints the interceptors depend on", async () => {
    expect((await call("/auth/api/v1/auth/csrf-token")).data).toHaveProperty("token")
    expect((await call("/auth/api/v1/auth/validate-token")).data).toMatchObject({ isValid: true })
    expect((await call("/auth/api/v1/auth/logout", "post")).data).toMatchObject({ success: true })
  })

  it("returns categories as a bare list on GET", async () => {
    const res = await call("/categories/api/v1/categories")
    expect(Array.isArray(res.data)).toBe(true)
    expect((res.data as Array<{ name: string }>).map((c) => c.name)).toContain("Travel")
  })

  it("strips the origin, so an absolute URL parses the same way", async () => {
    const res = await demoAdapter(
      req("http://localhost:5132/todos/api/v1/todos/dt-1", "get")
    )
    expect(res.data).toHaveProperty("id", "dt-1")
  })
})
