import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { REVEAL_WAIT_MS, useTaskVisibility } from "@/hooks/use-task-visibility"
import { fetchTaskById, setTaskHidden, setViewerPreference } from "@/lib/api"
import { sortTasks } from "@/utils/sort-tasks"
import type { Todo } from "@/types/todo"

vi.mock("@/lib/api", () => ({
  fetchTaskById: vi.fn(),
  setTaskHidden: vi.fn(),
  setViewerPreference: vi.fn(),
}))

const OWNER = "owner-1"

/** What a list holds for the owner's own hidden task: no description, no date. */
const hiddenOwn: Todo = {
  id: "own",
  userId: OWNER,
  title: "Adaptive layout",
  status: "Todo",
  priority: "4",
  isPublic: false,
  isCompleted: false,
  hidden: true,
  tags: [],
  createdAt: "2026-05-01T08:00:00.000Z",
  hasSharedAudience: false,
}

const fullOwn: Todo = {
  ...hiddenOwn,
  hidden: true,
  description: "Four lines of detail",
  dueDate: "2026-05-02T00:00:00.000Z",
  expectedDate: "2026-05-03T00:00:00.000Z",
}

/** What a list holds for a hidden task with an audience: masked. */
const maskedShared: Todo = {
  id: "shared",
  userId: OWNER,
  title: "Hidden task",
  status: "",
  priority: "3",
  isPublic: false,
  isCompleted: false,
  hidden: true,
  tags: [],
  createdAt: "0001-01-01T00:00:00.000Z",
  hasSharedAudience: true,
}

const fullShared: Todo = {
  ...maskedShared,
  title: "Plan the trip",
  status: "Todo",
  createdAt: "2026-04-01T08:00:00.000Z",
  dueDate: "2026-05-01T00:00:00.000Z",
  sharedWithUserIds: ["friend-1"],
}

const friendsTask: Todo = { ...maskedShared, id: "friend", userId: "00000000-0000-0000-0000-000000000000", hasSharedAudience: true }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** A page's list: the hook finds tasks in it and writes changes back to it. */
function setup(initial: Todo[], viewerId = OWNER, extra: Partial<Parameters<typeof useTaskVisibility>[0]> = {}) {
  let list = initial
  const onError = vi.fn()
  const hook = renderHook(() =>
    useTaskVisibility({
      find: (id) => list.find((t) => t.id === id),
      update: (id, change) => {
        list = list.map((t) => (t.id === id ? change(t) : t))
      },
      viewerId,
      authorName: (userId) => (userId === "friend-author" ? "Mara" : undefined),
      onError,
      ...extra,
    }),
  )
  return { hook, onError, current: () => list, task: (id: string) => list.find((t) => t.id === id)! }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"))
  vi.mocked(fetchTaskById).mockReset()
  vi.mocked(setTaskHidden).mockReset()
  vi.mocked(setViewerPreference).mockReset()
  vi.mocked(setTaskHidden).mockImplementation(async (_id, hidden) => ({ hidden, categoryName: null, categoryId: null }))
})

afterEach(() => {
  vi.useRealTimers()
})

describe("useTaskVisibility — the owner's own task", () => {
  it("opens once, with the content fetched ahead while the pointer rested on it", async () => {
    vi.mocked(fetchTaskById).mockResolvedValue(fullOwn)
    const { hook, task } = setup([hiddenOwn])
    act(() => hook.result.current.prefetch("own"))
    expect(fetchTaskById).toHaveBeenCalledTimes(1)
    // A second hover does not fetch it again.
    act(() => hook.result.current.prefetch("own"))
    expect(fetchTaskById).toHaveBeenCalledTimes(1)

    await act(async () => {
      await hook.result.current.toggle("own")
    })
    expect(fetchTaskById).toHaveBeenCalledTimes(1)
    expect(setTaskHidden).toHaveBeenCalledWith("own", false)
    expect(task("own")).toMatchObject({ hidden: false, description: "Four lines of detail", dueDate: fullOwn.dueDate })
  })

  it("fetches beside the write when nothing was fetched ahead, and waits for it before opening", async () => {
    const read = deferred<Todo>()
    vi.mocked(fetchTaskById).mockReturnValue(read.promise)
    const { hook, task } = setup([hiddenOwn])
    let done!: Promise<void>
    act(() => {
      done = hook.result.current.toggle("own")
    })
    expect(fetchTaskById).toHaveBeenCalledWith("own")
    expect(setTaskHidden).toHaveBeenCalledWith("own", false)
    expect(hook.result.current.isPending("own")).toBe(true)
    // Still folded while the content is on its way.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REVEAL_WAIT_MS - 50)
    })
    expect(task("own").hidden).toBe(true)
    await act(async () => {
      read.resolve(fullOwn)
      await done
    })
    expect(task("own")).toMatchObject({ hidden: false, description: "Four lines of detail" })
    expect(hook.result.current.isPending("own")).toBe(false)
  })

  it("opens with what it has when the content is slow, and adds the rest when it comes", async () => {
    const read = deferred<Todo>()
    vi.mocked(fetchTaskById).mockReturnValue(read.promise)
    const { hook, task } = setup([hiddenOwn])
    let done!: Promise<void>
    act(() => {
      done = hook.result.current.toggle("own")
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REVEAL_WAIT_MS + 10)
    })
    expect(task("own").hidden).toBe(false)
    expect(task("own").description).toBeUndefined()
    await act(async () => {
      read.resolve(fullOwn)
      await done
    })
    expect(task("own")).toMatchObject({ hidden: false, description: "Four lines of detail" })
  })

  it("asks again after the write when the read ahead failed", async () => {
    vi.mocked(fetchTaskById).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(fullOwn)
    const { hook, task } = setup([hiddenOwn])
    await act(async () => {
      await hook.result.current.toggle("own")
    })
    expect(fetchTaskById).toHaveBeenCalledTimes(2)
    expect(task("own")).toMatchObject({ hidden: false, description: "Four lines of detail" })
  })

  it("stays open with what it has when the content never comes", async () => {
    vi.mocked(fetchTaskById).mockRejectedValue(new Error("offline"))
    const { hook, task, onError } = setup([hiddenOwn])
    await act(async () => {
      await hook.result.current.toggle("own")
    })
    expect(task("own").hidden).toBe(false)
    expect(onError).not.toHaveBeenCalled()
  })

  it("folds again and says so when the write fails", async () => {
    vi.mocked(fetchTaskById).mockResolvedValue(fullOwn)
    vi.mocked(setTaskHidden).mockRejectedValue(new Error("500"))
    const { hook, task, onError } = setup([hiddenOwn])
    await act(async () => {
      await hook.result.current.toggle("own")
    })
    expect(task("own").hidden).toBe(true)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it("keeps the place the hidden card had in its list, until something that places it changes", async () => {
    // Overdue: on its own, the full copy sorts to the very top.
    const overdue: Todo = { ...fullOwn, dueDate: "2026-04-20T00:00:00.000Z" }
    vi.mocked(fetchTaskById).mockResolvedValue(overdue)
    const neighbour: Todo = { ...hiddenOwn, id: "neighbour", hidden: false, dueDate: "2026-05-01T00:00:00.000Z" }
    const later: Todo = { ...hiddenOwn, id: "later", hidden: false, priority: "1" }
    const { hook, current } = setup([later, hiddenOwn, neighbour])
    expect(sortTasks(current()).map((t) => t.id)).toEqual(["neighbour", "own", "later"])
    await act(async () => {
      await hook.result.current.toggle("own")
    })
    expect(sortTasks(current()).map((t) => t.id)).toEqual(["neighbour", "own", "later"])
    // A new priority is a change that places it: now it goes where its date says.
    const moved = current().map((t) => (t.id === "own" ? { ...t, priority: "5" } : t))
    expect(sortTasks(moved).map((t) => t.id)).toEqual(["own", "neighbour", "later"])
    // And a copy fresh from the server carries no held place at all.
    expect(sortTasks([later, { ...overdue, hidden: false }, neighbour]).map((t) => t.id)).toEqual(["own", "neighbour", "later"])
  })

  it("merges the category the write reports", async () => {
    vi.mocked(fetchTaskById).mockResolvedValue(fullOwn)
    vi.mocked(setTaskHidden).mockResolvedValue({ hidden: false, categoryName: "Home", categoryId: "cat-home" })
    const { hook, task } = setup([hiddenOwn])
    await act(async () => {
      await hook.result.current.toggle("own")
    })
    expect(task("own")).toMatchObject({ categoryName: "Home", categoryId: "cat-home" })
  })

  it("fetches ahead again once what it fetched has gone stale, and never for an open card", () => {
    vi.mocked(fetchTaskById).mockResolvedValue(fullOwn)
    const open: Todo = { ...hiddenOwn, id: "open", hidden: false }
    const { hook } = setup([hiddenOwn, open])
    act(() => hook.result.current.prefetch("open"))
    expect(fetchTaskById).not.toHaveBeenCalled()
    act(() => hook.result.current.prefetch("own"))
    vi.setSystemTime(new Date("2026-05-01T12:00:30.000Z"))
    act(() => hook.result.current.prefetch("own"))
    expect(fetchTaskById).toHaveBeenCalledTimes(2)
  })

  it("forgets a read ahead that failed, so the next hover tries again", async () => {
    vi.mocked(fetchTaskById).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(fullOwn)
    const { hook } = setup([hiddenOwn])
    act(() => hook.result.current.prefetch("own"))
    await act(async () => {
      await Promise.resolve()
    })
    act(() => hook.result.current.prefetch("own"))
    expect(fetchTaskById).toHaveBeenCalledTimes(2)
  })
})

describe("useTaskVisibility — a masked task", () => {
  it("never fetches it ahead: the server would only send the mask", () => {
    const { hook } = setup([maskedShared, friendsTask])
    act(() => hook.result.current.prefetch("shared"))
    act(() => hook.result.current.prefetch("friend"))
    act(() => hook.result.current.prefetch("missing"))
    expect(fetchTaskById).not.toHaveBeenCalled()
  })

  it("stays folded until the write and then the read are back, and opens in its place", async () => {
    const write = deferred<{ hidden: boolean; categoryName: string | null; categoryId: string | null }>()
    vi.mocked(setTaskHidden).mockReturnValue(write.promise)
    vi.mocked(fetchTaskById).mockResolvedValue(fullShared)
    const { hook, task, current } = setup([maskedShared, { ...hiddenOwn, id: "other", hidden: false }])
    const before = sortTasks(current()).map((t) => t.id)
    let done!: Promise<void>
    act(() => {
      done = hook.result.current.toggle("shared")
    })
    expect(fetchTaskById).not.toHaveBeenCalled()
    expect(task("shared").hidden).toBe(true)
    await act(async () => {
      write.resolve({ hidden: false, categoryName: null, categoryId: null })
      await done
    })
    expect(fetchTaskById).toHaveBeenCalledWith("shared")
    expect(task("shared")).toMatchObject({ hidden: false, title: "Plan the trip" })
    expect(sortTasks(current()).map((t) => t.id)).toEqual(before)
  })

  it("opens a friend's task through the viewer's own preference, with the author's name", async () => {
    vi.mocked(setViewerPreference).mockResolvedValue({
      todoId: "friend",
      hiddenByViewer: false,
      viewerCategoryId: null,
      completedByViewer: null,
      ownerCompleted: false,
    })
    vi.mocked(fetchTaskById).mockResolvedValue({ ...fullShared, id: "friend", userId: "friend-author" })
    const { hook, task } = setup([friendsTask])
    await act(async () => {
      await hook.result.current.toggle("friend")
    })
    expect(setViewerPreference).toHaveBeenCalledWith("friend", { hiddenByViewer: false })
    expect(setTaskHidden).not.toHaveBeenCalled()
    expect(task("friend")).toMatchObject({ hidden: false, authorName: "Mara" })
  })

  it("stays folded and says so when either half fails", async () => {
    vi.mocked(setTaskHidden).mockResolvedValue({ hidden: false, categoryName: null, categoryId: null })
    vi.mocked(fetchTaskById).mockRejectedValue(new Error("offline"))
    const { hook, task, onError } = setup([maskedShared])
    await act(async () => {
      await hook.result.current.toggle("shared")
    })
    expect(task("shared").hidden).toBe(true)
    expect(onError).toHaveBeenCalledTimes(1)
  })
})

describe("useTaskVisibility — hiding", () => {
  it("folds at once and keeps the category the server reports", async () => {
    vi.mocked(setTaskHidden).mockResolvedValue({ hidden: true, categoryName: "Home", categoryId: "cat-home" })
    const open: Todo = { ...fullOwn, hidden: false }
    const { hook, task } = setup([open])
    let done!: Promise<void>
    act(() => {
      done = hook.result.current.toggle("own")
    })
    expect(task("own").hidden).toBe(true)
    await act(async () => {
      await done
    })
    expect(task("own")).toMatchObject({ hidden: true, categoryName: "Home" })
  })

  it("hides a friend's task for this viewer alone, dropping its details where the list asks", async () => {
    vi.mocked(setViewerPreference).mockResolvedValue({
      todoId: "friend",
      hiddenByViewer: true,
      viewerCategoryId: null,
      completedByViewer: null,
      ownerCompleted: false,
    })
    const open: Todo = { ...fullShared, id: "friend", userId: "friend-author", hidden: false }
    const redact = vi.fn((t: Todo) => ({ ...t, title: "Hidden task", description: null }))
    const { hook, task } = setup([open], OWNER, { redactViewerHidden: redact })
    await act(async () => {
      await hook.result.current.toggle("friend")
    })
    expect(setViewerPreference).toHaveBeenCalledWith("friend", { hiddenByViewer: true })
    expect(task("friend")).toMatchObject({ hidden: true, title: "Hidden task" })
  })

  it("opens again and says so when hiding fails", async () => {
    vi.mocked(setTaskHidden).mockRejectedValue(new Error("500"))
    const { hook, task, onError } = setup([{ ...fullOwn, hidden: false }])
    await act(async () => {
      await hook.result.current.toggle("own")
    })
    expect(task("own").hidden).toBe(false)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it("ignores a second press while the first is on its way, and a task it cannot find", async () => {
    const write = deferred<{ hidden: boolean; categoryName: string | null; categoryId: string | null }>()
    vi.mocked(setTaskHidden).mockReturnValue(write.promise)
    const { hook } = setup([{ ...fullOwn, hidden: false }])
    let first!: Promise<void>
    act(() => {
      first = hook.result.current.toggle("own")
    })
    await act(async () => {
      await hook.result.current.toggle("own")
      await hook.result.current.toggle("missing")
    })
    expect(setTaskHidden).toHaveBeenCalledTimes(1)
    await act(async () => {
      write.resolve({ hidden: true, categoryName: null, categoryId: null })
      await first
    })
  })
})
