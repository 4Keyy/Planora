import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from "axios"
import { demo, DEMO_FRIENDS, DEMO_USER } from "./state"
import type { Todo } from "@/types/todo"

/**
 * An axios adapter that answers the product's own HTTP contract from memory.
 *
 * This is the whole point of the demo, and it is worth being precise about what it does
 * and does not replace. It replaces the **transport** — the bottom layer, below
 * everything. Above it, untouched and genuinely exercised, sit:
 *
 *   - the request interceptor: `Authorization` from the auth store, the CSRF echo, the
 *     `traceparent` header (`lib/api.ts:165-197`)
 *   - the response interceptor: the 401-refresh-retry, the 403-CSRF-retry, the
 *     cancellation path, the error-logging policy (`lib/api.ts:206-347`)
 *   - every one of the sixteen typed functions in `lib/api.ts`, unchanged
 *   - `parseApiResponse`, which unwraps all three response envelopes the API uses
 *
 * So the components on the landing page are not talking to a stub with a similar shape.
 * They are making the same calls, through the same client, and reading the same parsed
 * results. The only thing that never happens is a network hop.
 *
 * The response shapes below are the ones the CLIENT reads, verified against `lib/api.ts`
 * and `store/notifications.ts` rather than against the server's DTOs. That distinction
 * is not pedantry: `docs/ui-audit/tools/mock-api.mjs` had four shapes wrong for its
 * entire existence, and one of them meant the branch feed rendered empty under every
 * audit run. Two rules fall out of that and are load-bearing here.
 *
 *   1. **`/comments` is paged, `/subtasks` is bare.** `fetchComments` reads `.items`;
 *      `branch-feed` spreads the subtask response directly. They are not symmetric, and
 *      getting either backwards fails silently.
 *   2. **Order the matchers narrow-to-wide.** `/todos` as a substring swallows
 *      `/todos/{id}/subtasks` and `/todos/{id}/viewer-preferences`, so those are tested
 *      first. This is the same trap the Playwright mock documents in its own comments.
 */

const OK = 200

function respond<T>(config: InternalAxiosRequestConfig, data: T, status = OK): AxiosResponse<T> {
  return {
    data,
    status,
    statusText: status === OK ? "OK" : String(status),
    headers: {},
    config,
    request: { demo: true },
  }
}

/** The path, without origin or query — the shape every matcher below is written against. */
function pathOf(config: InternalAxiosRequestConfig): string {
  const raw = config.url ?? ""
  const withoutOrigin = raw.replace(/^https?:\/\/[^/]+/, "")
  return withoutOrigin.split("?")[0]
}

function bodyOf(config: InternalAxiosRequestConfig): Record<string, unknown> {
  if (!config.data) return {}
  if (typeof config.data === "string") {
    try {
      return JSON.parse(config.data) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return config.data as Record<string, unknown>
}

/**
 * The path's resource segments, with the gateway's `/{service}/api/v{n}/` prefix removed.
 *
 * Naively splitting on a marker does not work here, because the service prefix repeats
 * the resource name: `/todos/api/v1/todos/dt-1` contains `/todos/` twice, and taking the
 * first occurrence yields "api" as the task id. Stripping the prefix first makes every
 * endpoint parse the same way:
 *
 *   /todos/api/v1/todos                      -> ["todos"]
 *   /todos/api/v1/todos/dt-1                 -> ["todos", "dt-1"]
 *   /todos/api/v1/todos/dt-1/subtasks        -> ["todos", "dt-1", "subtasks"]
 *   /collaboration/api/v1/comments/dt-1      -> ["comments", "dt-1"]
 *   /friendships                             -> ["friendships"]   (no prefix at all)
 */
function resourceSegments(path: string): string[] {
  const segments = path.split("/").filter(Boolean)
  // Drop a leading {service}/api/v{n} triple when present. No regex: the version
  // segment is simply the one after "api", and a literal check reads clearer here.
  if (segments[1] === "api" && (segments[2] ?? "").startsWith("v")) return segments.slice(3)
  return segments
}

/** The id following a named resource, or null when the request is for the collection. */
function idOf(path: string, resource: string): string | null {
  const segments = resourceSegments(path)
  const at = segments.indexOf(resource)
  if (at === -1) return null
  return segments[at + 1] ?? null
}

/** The friend list, in the shape `lib/friend-names.ts` and `use-friends.ts` read. */
function friendships() {
  return DEMO_FRIENDS.map((f) => ({
    id: `fr-${f.id}`,
    userId: f.id,
    friendId: f.id,
    email: `${f.firstName.toLowerCase()}@example.com`,
    firstName: f.firstName,
    lastName: f.lastName,
    status: "Accepted",
    profilePictureUrl: null,
  }))
}

export const demoAdapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
  const path = pathOf(config)
  const method = (config.method ?? "get").toUpperCase()
  const body = bodyOf(config)
  const params = (config.params ?? {}) as Record<string, unknown>

  // ── auth ────────────────────────────────────────────────────────────────────
  if (path.endsWith("/auth/csrf-token")) return respond(config, { token: readCsrfCookie() })
  if (path.endsWith("/auth/validate-token")) return respond(config, { isValid: true, valid: true })
  if (path.endsWith("/auth/logout")) return respond(config, { success: true })

  // ── friendships (no service prefix; see next.config.js rewrites) ────────────
  if (path.includes("/friendships")) return respond(config, friendships())

  // ── notifications ───────────────────────────────────────────────────────────
  // SummaryDto wants { totalUnread, perTask[] }; loadList wants a BARE array of
  // NotificationPayload with userId/taskId/actorId/message/occurredOnUtc. Both were
  // wrong in the Playwright mock, so the bell read zero and no badge ever lit.
  if (path.includes("/notifications/read")) return respond(config, { success: true })
  if (path.includes("/notifications/summary")) {
    return respond(config, { totalUnread: 0, perTask: [] })
  }
  if (path.includes("/notifications")) return respond(config, [])

  // ── categories ──────────────────────────────────────────────────────────────
  if (path.includes("/categories")) {
    if (method === "GET") return respond(config, demo.categories())
    return respond(config, demo.categories()[0])
  }

  // ── comments: PAGED ─────────────────────────────────────────────────────────
  if (path.includes("/comments")) {
    const todoId = idOf(path, "comments")
    if (!todoId) return respond(config, { items: [], totalCount: 0 })
    const segments = resourceSegments(path)
    const commentId = segments[2] ?? null

    if (method === "POST") {
      const replyTo = body.replyToType && body.replyToId
        ? { type: String(body.replyToType), id: String(body.replyToId) }
        : undefined
      return respond(config, demo.addComment(todoId, String(body.content ?? ""), replyTo))
    }
    if (method === "PUT" && commentId && commentId !== todoId) {
      const updated = demo.updateComment(todoId, commentId, String(body.content ?? ""))
      return respond(config, updated ?? {}, updated ? OK : 404)
    }
    if (method === "DELETE" && commentId && commentId !== todoId) {
      demo.deleteComment(todoId, commentId)
      return respond(config, {}, 204)
    }
    const items = demo.comments(todoId)
    return respond(config, { items, totalCount: items.length })
  }

  // ── subtasks: BARE ARRAY ────────────────────────────────────────────────────
  if (path.includes("/subtasks")) {
    const parentId = idOf(path, "todos")
    if (!parentId) return respond(config, [])
    if (method === "POST") {
      return respond(config, demo.createSubtask(parentId, String(body.title ?? "Untitled")))
    }
    return respond(config, demo.subtasks(parentId))
  }

  // ── viewer preferences ──────────────────────────────────────────────────────
  if (path.includes("/viewer-preferences")) {
    const id = idOf(path, "todos") ?? ""
    const patch: Partial<Todo> = {}
    if (typeof body.completedByViewer === "boolean") {
      patch.isCompletedByViewer = body.completedByViewer
    }
    if (typeof body.hiddenByViewer === "boolean") patch.hidden = body.hiddenByViewer
    demo.patchTodo(id, patch)
    return respond(config, {
      todoId: id,
      hiddenByViewer: Boolean(body.hiddenByViewer),
      viewerCategoryId: (body.viewerCategoryId as string | null) ?? null,
      completedByViewer: (body.completedByViewer as boolean | undefined) ?? null,
      ownerCompleted: false,
    })
  }

  // ── hidden ──────────────────────────────────────────────────────────────────
  if (path.includes("/hidden")) {
    const id = idOf(path, "todos") ?? ""
    const hidden = Boolean(body.hidden)
    demo.patchTodo(id, { hidden })
    const t = demo.todo(id)
    return respond(config, {
      hidden,
      categoryName: t?.categoryName ?? null,
      categoryId: t?.categoryId ?? null,
    })
  }

  // ── join / leave / duplicate ────────────────────────────────────────────────
  if (path.endsWith("/join")) {
    const id = idOf(path, "todos") ?? ""
    const t = demo.todo(id)
    const updated = demo.patchTodo(id, {
      isWorking: true,
      workerCount: (t?.workerCount ?? 0) + 1,
      workerUserIds: [...(t?.workerUserIds ?? []), DEMO_USER.userId],
    })
    return respond(config, updated ?? {})
  }
  if (path.endsWith("/leave")) {
    const id = idOf(path, "todos") ?? ""
    const t = demo.todo(id)
    demo.patchTodo(id, {
      isWorking: false,
      workerCount: Math.max(0, (t?.workerCount ?? 1) - 1),
      workerUserIds: (t?.workerUserIds ?? []).filter((u) => u !== DEMO_USER.userId),
    })
    return respond(config, {}, 204)
  }
  if (path.endsWith("/duplicate")) {
    const id = idOf(path, "todos") ?? ""
    const source = demo.todo(id)
    return respond(
      config,
      demo.createTodo({
        title: source?.title ?? "Copy",
        description: source?.description,
        priority: source?.priority,
        categoryId: source?.categoryId,
        categoryName: source?.categoryName,
      })
    )
  }

  // ── todos (widest; must come last) ──────────────────────────────────────────
  if (path.includes("/todos")) {
    const id = idOf(path, "todos")

    if (method === "POST" && !id) return respond(config, demo.createTodo(body as Partial<Todo>))

    if (id) {
      if (method === "GET") {
        const found = demo.todo(id)
        return found ? respond(config, found) : respond(config, { error: { code: "NOT_FOUND" } }, 404)
      }
      if (method === "PUT" || method === "PATCH") {
        const patch = { ...body } as Partial<Todo>
        if (typeof body.status === "string") {
          const s = body.status.toLowerCase()
          patch.status = s === "done" ? "Done" : s === "inprogress" ? "InProgress" : "Todo"
          patch.isCompleted = s === "done"
        }
        const updated = demo.patchTodo(id, patch)
        return respond(config, updated ?? {}, updated ? OK : 404)
      }
      if (method === "DELETE") {
        demo.deleteTodo(id)
        return respond(config, {}, 204)
      }
    }

    // The list, with the filters the two product screens actually send.
    const wantCompleted = params.isCompleted === true || params.isCompleted === "true"
    const items = demo.todos().filter((t) => Boolean(t.isCompleted) === wantCompleted)
    return respond(config, { items, totalCount: items.length })
  }

  // Anything unmatched answers empty rather than hanging — a pending promise on a
  // landing page is a spinner nobody can explain.
  return respond(config, { items: [], totalCount: 0 })
}

function readCsrfCookie(): string {
  if (typeof document === "undefined") return "demo-csrf"
  const row = document.cookie.split("; ").find((r) => r.startsWith("XSRF-TOKEN="))
  return row ? decodeURIComponent(row.slice(row.indexOf("=") + 1)) : "demo-csrf"
}
