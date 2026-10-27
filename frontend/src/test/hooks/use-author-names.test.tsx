import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useAuthorNames } from "@/hooks/use-author-names"
import { ensureFriendNames } from "@/lib/friend-names"
import { TodoPriority, TodoStatus, type Todo } from "@/types/todo"

// Friends' names on a page's tasks (audit FE-24): which tasks are named, that each friend is read
// once into the page's own names, and that the viewer's own tasks are told apart whatever the case
// of the ids.
vi.mock("@/lib/friend-names", () => ({ ensureFriendNames: vi.fn() }))

const ME = "9f1c2e3a-0000-4000-8000-0000000000ab"

const task = (overrides: Partial<Todo> = {}): Todo => ({
  id: "t-1",
  userId: ME,
  title: "Write the report",
  description: null,
  status: TodoStatus.Pending,
  categoryId: null,
  dueDate: null,
  expectedDate: null,
  actualDate: null,
  priority: TodoPriority.Medium,
  isPublic: false,
  isCompleted: false,
  hidden: false,
  completedAt: null,
  isOnTime: null,
  delay: null,
  tags: [],
  createdAt: "2026-10-20T09:00:00Z",
  updatedAt: null,
  sharedWithUserIds: [],
  ...overrides,
})

/** The friend list as `ensureFriendNames` would fill it. */
const known: Record<string, string> = { ada: "Ada Lovelace", ben: "Ben Okri" }

beforeEach(() => {
  vi.mocked(ensureFriendNames).mockReset().mockImplementation(async (ids, cache) => {
    for (const id of ids) if (known[id]) cache.set(id, known[id])
  })
})

describe("useAuthorNames", () => {
  it("names the authors of friends' public and shared tasks, and nothing else", async () => {
    const { result } = renderHook(() => useAuthorNames(ME))
    const items = [
      task({ id: "public", userId: "ada", isPublic: true }),
      task({ id: "shared", userId: "ben", sharedWithUserIds: [ME] }),
      task({ id: "private", userId: "ada" }),
      task({ id: "own", isPublic: true }),
      task({ id: "masked", userId: "", isPublic: true }),
      task({ id: "stranger", userId: "cy", isPublic: true }),
    ]

    const named = await result.current.enrich(items)

    expect(named.map((t) => [t.id, t.authorName])).toEqual([
      ["public", "Ada Lovelace"],
      ["shared", "Ben Okri"],
      ["private", undefined],
      ["own", undefined],
      ["masked", undefined],
      ["stranger", undefined],
    ])
    expect(named[2]).toBe(items[2])
    expect(ensureFriendNames).toHaveBeenCalledWith(new Set(["ada", "ben", "cy"]), expect.any(Map))
    expect(result.current.nameOf("ada")).toBe("Ada Lovelace")
    expect(result.current.nameOf("cy")).toBeUndefined()
  })

  it("tells the viewer's own tasks apart whatever the case of the ids", async () => {
    const { result } = renderHook(() => useAuthorNames(ME.toUpperCase()))
    const items = [task({ isPublic: true })]

    expect(await result.current.enrich(items)).toBe(items)
    expect(ensureFriendNames).not.toHaveBeenCalled()
  })

  it("hands the tasks back as they were while no name is known", async () => {
    vi.mocked(ensureFriendNames).mockResolvedValue(undefined)
    const { result } = renderHook(() => useAuthorNames(ME))
    const items = [task({ userId: "cy", isPublic: true })]

    expect(await result.current.enrich(items)).toBe(items)
  })

  it("names nothing without a viewer", async () => {
    const { result } = renderHook(() => useAuthorNames(undefined))
    const items = [task({ userId: "ada", isPublic: true })]

    expect(await result.current.enrich(items)).toBe(items)
    expect(ensureFriendNames).not.toHaveBeenCalled()
  })

  it("keeps the names it has read for the page's life, and its functions while the viewer stays", async () => {
    const { result, rerender } = renderHook(({ viewer }) => useAuthorNames(viewer), { initialProps: { viewer: ME } })
    const first = result.current
    await first.enrich([task({ userId: "ada", isPublic: true })])

    rerender({ viewer: ME })
    expect(result.current).toBe(first)

    rerender({ viewer: "someone-else" })
    expect(result.current.enrich).not.toBe(first.enrich)
    expect(result.current.nameOf).toBe(first.nameOf)
    expect(result.current.nameOf("ada")).toBe("Ada Lovelace")
  })
})
