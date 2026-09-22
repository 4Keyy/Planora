/**
 * @colour-data — the three category colours below stand in for a user's own choices.
 *
 * A category colour is data in this product, not theme: the real thing is whatever the
 * person picked, stored against their row, and `lib/icon-map.ts` carries the same
 * exemption for the default a new category gets. Routing these through the semantic
 * tokens would be the actual mistake — it would imply the palette owns them, and the
 * next token sweep would "correct" a user's colour.
 */
import type { Todo, TodoComment } from "@/types/todo"
import type { Category } from "@/types/category"

/**
 * The demo sandbox's data, and the mutations that change it.
 *
 * This is the part of the landing page that makes "real user experience" more than a
 * claim. The previous demos held their own React state, which meant the product's data
 * layer — `lib/api.ts` with its auth header, CSRF echo, traceparent, 401-refresh-retry
 * and 403-CSRF-retry — was bypassed entirely. Here the components call the same
 * functions they call in production; only the transport is replaced, one layer below
 * everything that could be wrong.
 *
 * Mutations really mutate. That matters more than it sounds: an optimistic update that
 * is never contradicted proves nothing, and a refetch that returns stale data is how a
 * demo quietly diverges from the product it is demonstrating.
 *
 * Every id and name here is invented, and the page says so on screen. The product is
 * not launched; a name presented as a customer would be fabricated social proof.
 */

export const DEMO_USER = {
  userId: "d0000000-0000-4000-8000-000000000001",
  email: "you@example.com",
  firstName: "You",
  lastName: "",
} as const

export const DEMO_FRIENDS = [
  { id: "d0000000-0000-4000-8000-000000000002", firstName: "Dana", lastName: "Whitfield" },
  { id: "d0000000-0000-4000-8000-000000000003", firstName: "Mira", lastName: "Sandoval" },
  { id: "d0000000-0000-4000-8000-000000000004", firstName: "Tom", lastName: "Achebe" },
] as const

/**
 * A fixed instant. The server renders this page and the client renders it again, and
 * `Date.now()` is the classic way to make the two disagree — React throws away the whole
 * server pass on a mismatch. Relative dates are derived from this, not from the clock.
 */
const EPOCH = Date.parse("2026-03-02T09:00:00.000Z")
const iso = (dayOffset: number) => new Date(EPOCH + dayOffset * 86_400_000).toISOString()

export interface DemoState {
  todos: Todo[]
  categories: Category[]
  /** Keyed by task id. The Author's Note is synthesised, not stored — see `comments()`. */
  comments: Record<string, TodoComment[]>
  subtasks: Record<string, Todo[]>
}

function task(partial: Partial<Todo> & Pick<Todo, "id" | "title">): Todo {
  return {
    userId: DEMO_USER.userId,
    status: "Todo",
    priority: "Medium",
    isPublic: false,
    isCompleted: false,
    tags: [],
    createdAt: iso(-6),
    ...partial,
  }
}

function seed(): DemoState {
  return {
    categories: [
      { id: "dc-1", name: "Travel", color: "#0369a1", icon: "plane", displayOrder: 0 },
      { id: "dc-2", name: "Home", color: "#15803d", icon: "home", displayOrder: 1 },
      { id: "dc-3", name: "Money", color: "#a16207", icon: "wallet", displayOrder: 2 },
    ] as Category[],

    todos: [
      task({
        id: "dt-1",
        title: "Book the flights for the spring trip",
        description:
          "Outbound looks cheapest midweek. Two seats, and we need to be back before the 14th.",
        priority: "High",
        categoryId: "dc-1",
        categoryName: "Travel",
        sharedWithUserIds: [DEMO_FRIENDS[0].id, DEMO_FRIENDS[1].id],
        hasSharedAudience: true,
        workerUserIds: [DEMO_FRIENDS[0].id],
        workerCount: 1,
        openSubtaskCount: 2,
      }),
      task({
        id: "dt-2",
        title: "Renew the household insurance policy",
        priority: "High",
        categoryId: "dc-2",
        categoryName: "Home",
      }),
      task({
        id: "dt-3",
        title: "Split last month's shared expenses",
        priority: "Low",
        categoryId: "dc-3",
        categoryName: "Money",
        sharedWithUserIds: [DEMO_FRIENDS[2].id],
        hasSharedAudience: true,
      }),
    ],

    comments: {
      "dt-1": [
        {
          id: "dcm-1",
          todoItemId: "dt-1",
          authorId: DEMO_FRIENDS[0].id,
          authorName: "Dana Whitfield",
          content: "Outbound is cheapest on the Tuesday. Shall I hold two seats?",
          createdAt: iso(-2),
          isOwn: false,
          isEdited: false,
        },
        {
          id: "dcm-2",
          todoItemId: "dt-1",
          authorId: DEMO_FRIENDS[1].id,
          authorName: "Mira Sandoval",
          content: "Tuesday works. I cannot do the early flight though.",
          createdAt: iso(-1),
          isOwn: false,
          isEdited: false,
        },
        {
          id: "dcm-3",
          todoItemId: "dt-1",
          authorId: DEMO_USER.userId,
          authorName: "You",
          content: "Holding the later one then.",
          createdAt: iso(-1),
          isOwn: true,
          isEdited: false,
          replyToType: "comment",
          replyToId: "dcm-2",
          replyToAuthorId: DEMO_FRIENDS[1].id,
          replyToAuthorName: "Mira Sandoval",
          replyToPreview: "Tuesday works. I cannot do the early flight though.",
        },
      ],
    },

    subtasks: {
      "dt-1": [
        task({
          id: "dst-1",
          title: "Compare three airlines",
          parentTodoId: "dt-1",
          status: "Done",
          isCompleted: true,
          completedAt: iso(-1),
          categoryId: "dc-1",
          categoryName: "Travel",
        }),
        task({
          id: "dst-2",
          title: "Check passport expiry dates",
          parentTodoId: "dt-1",
          categoryId: "dc-1",
          categoryName: "Travel",
          workerCount: 1,
          workerUserIds: [DEMO_FRIENDS[0].id],
        }),
        task({
          id: "dst-3",
          title: "Reserve the airport transfer",
          parentTodoId: "dt-1",
          categoryId: "dc-1",
          categoryName: "Travel",
        }),
      ],
    },
  }
}

let state: DemoState = seed()

export const demo = {
  get: () => state,
  reset: () => {
    state = seed()
  },

  todos: () => state.todos.filter((t) => !t.parentTodoId),
  todo: (id: string) => state.todos.find((t) => t.id === id) ?? state.subtasks["dt-1"]?.find((s) => s.id === id),
  categories: () => state.categories,

  /**
   * The Author's Note is synthesised from the task's description rather than stored as a
   * row, because that is what the server does: `CheckTaskCommentAccessResponse` carries
   * `description` and `task_created_at` precisely so Collaboration can build it. A mock
   * that stored it as a comment would be modelling the wrong thing, and the branch would
   * behave differently the moment a description changed.
   */
  comments: (todoId: string): TodoComment[] => {
    const parent = state.todos.find((t) => t.id === todoId)
    const stored = state.comments[todoId] ?? []
    if (!parent?.description) return stored
    const genesis: TodoComment = {
      id: `genesis-${todoId}`,
      todoItemId: todoId,
      authorId: parent.userId,
      authorName: parent.authorName ?? "You",
      content: parent.description,
      createdAt: parent.createdAt,
      isOwn: parent.userId === DEMO_USER.userId,
      isEdited: false,
      isGenesisComment: true,
    }
    return [genesis, ...stored]
  },

  subtasks: (parentId: string) => state.subtasks[parentId] ?? [],

  addComment: (todoId: string, content: string, replyTo?: { type: string; id: string }) => {
    const target = (state.comments[todoId] ?? []).find((c) => c.id === replyTo?.id)
    const created: TodoComment = {
      id: `dcm-${Math.abs(hash(content + todoId + (state.comments[todoId]?.length ?? 0)))}`,
      todoItemId: todoId,
      authorId: DEMO_USER.userId,
      authorName: "You",
      content,
      createdAt: nextStamp(),
      isOwn: true,
      isEdited: false,
      ...(replyTo && target
        ? {
            replyToType: replyTo.type as TodoComment["replyToType"],
            replyToId: replyTo.id,
            replyToAuthorId: target.authorId,
            replyToAuthorName: target.authorName,
            replyToPreview: target.content.slice(0, 300),
          }
        : {}),
    }
    state.comments[todoId] = [...(state.comments[todoId] ?? []), created]
    return created
  },

  updateComment: (todoId: string, commentId: string, content: string) => {
    const list = state.comments[todoId] ?? []
    const idx = list.findIndex((c) => c.id === commentId)
    if (idx === -1) return null
    const next = { ...list[idx], content, isEdited: true, updatedAt: nextStamp() }
    state.comments[todoId] = [...list.slice(0, idx), next, ...list.slice(idx + 1)]
    return next
  },

  deleteComment: (todoId: string, commentId: string) => {
    state.comments[todoId] = (state.comments[todoId] ?? []).filter((c) => c.id !== commentId)
  },

  patchTodo: (id: string, patch: Partial<Todo>) => {
    const idx = state.todos.findIndex((t) => t.id === id)
    if (idx !== -1) {
      state.todos = [
        ...state.todos.slice(0, idx),
        { ...state.todos[idx], ...patch, updatedAt: nextStamp() },
        ...state.todos.slice(idx + 1),
      ]
      return state.todos[idx]
    }
    for (const [parent, list] of Object.entries(state.subtasks)) {
      const si = list.findIndex((s) => s.id === id)
      if (si === -1) continue
      const next = { ...list[si], ...patch, updatedAt: nextStamp() }
      state.subtasks[parent] = [...list.slice(0, si), next, ...list.slice(si + 1)]
      return next
    }
    return null
  },

  createTodo: (payload: Partial<Todo>) => {
    const created = task({
      id: `dt-${Math.abs(hash(String(payload.title) + state.todos.length))}`,
      title: payload.title ?? "Untitled",
      ...payload,
      createdAt: nextStamp(),
    })
    state.todos = [created, ...state.todos]
    return created
  },

  deleteTodo: (id: string) => {
    state.todos = state.todos.filter((t) => t.id !== id)
    delete state.comments[id]
    delete state.subtasks[id]
    for (const [parent, list] of Object.entries(state.subtasks)) {
      state.subtasks[parent] = list.filter((s) => s.id !== id)
    }
  },

  createSubtask: (parentId: string, title: string) => {
    const created = task({
      id: `dst-${Math.abs(hash(title + parentId))}`,
      title,
      parentTodoId: parentId,
      createdAt: nextStamp(),
    })
    state.subtasks[parentId] = [...(state.subtasks[parentId] ?? []), created]
    return created
  },
}

/**
 * A monotonic clock that is not the wall clock.
 *
 * Comment order matters in a branch, and `Date.now()` is unavailable to us for the
 * hydration reason above. This advances a minute per call from the fixed epoch, so
 * anything the visitor writes sorts after everything seeded and keeps its own order.
 */
let tick = 0
function nextStamp(): string {
  tick += 1
  return new Date(EPOCH + tick * 60_000).toISOString()
}

/** A stable id from a string. Not security-relevant; `Math.random()` is unavailable here. */
function hash(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h | 0
}
