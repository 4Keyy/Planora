import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { api } from "@/lib/api"
import { useToastStore } from "@/store/toast"
import { useNotificationStore, useTaskUnread, type AppNotification } from "@/store/notifications"
import type { NotificationPayload } from "@/lib/realtime/client"

const EMPTY_GUID = "00000000-0000-0000-0000-000000000000"
const TASK = "11111111-1111-1111-1111-111111111111"
const TASK2 = "22222222-2222-2222-2222-222222222222"

function payload(over: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    id: over.id ?? crypto.randomUUID(),
    userId: "u1",
    taskId: over.taskId ?? TASK,
    actorId: "actor",
    type: over.type ?? "comment.added",
    title: over.title ?? "New message",
    message: over.message ?? "Hi there",
    occurredOnUtc: over.occurredOnUtc ?? new Date().toISOString(),
    isRead: over.isRead ?? false,
    ...over,
  }
}

const initial = {
  items: [] as AppNotification[],
  perTask: {},
  totalUnread: 0,
  listLoaded: false,
  seen: new Set<string>(),
}

describe("notifications store", () => {
  beforeEach(() => {
    useNotificationStore.setState({ ...initial, seen: new Set<string>() })
    vi.spyOn(useToastStore.getState(), "addToast").mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  describe("hydrate", () => {
    it("loads the summary and drops empty-guid tasks", async () => {
      vi.spyOn(api, "get").mockResolvedValue({
        data: {
          totalUnread: 4,
          perTask: [
            { taskId: TASK, count: 2, latestType: "task.review" },
            { taskId: EMPTY_GUID, count: 2, latestType: "comment.added" },
          ],
        },
      } as never)

      await useNotificationStore.getState().hydrate()

      const s = useNotificationStore.getState()
      expect(s.totalUnread).toBe(4)
      // An older server response without `groups` is still normalised to one synthetic group.
      expect(s.perTask[TASK]).toMatchObject({ count: 2, latestType: "task.review" })
      expect(s.perTask[TASK].groups).toEqual([{ type: "task.review", count: 2, latestOccurredOn: "" }])
      expect(s.perTask[EMPTY_GUID]).toBeUndefined()
    })

    it("leaves state unchanged on error", async () => {
      vi.spyOn(api, "get").mockRejectedValue(new Error("offline"))
      await useNotificationStore.getState().hydrate()
      expect(useNotificationStore.getState().totalUnread).toBe(0)
    })
  })

  describe("loadList", () => {
    it("normalizes items and marks them seen", async () => {
      vi.spyOn(api, "get").mockResolvedValue({
        data: [payload({ id: "n1", occurredOn: undefined, occurredOnUtc: "2026-01-01T00:00:00Z" })],
      } as never)

      await useNotificationStore.getState().loadList()

      const s = useNotificationStore.getState()
      expect(s.listLoaded).toBe(true)
      expect(s.items[0].id).toBe("n1")
      expect(s.seen.has("n1")).toBe(true)
    })

    it("still flags loaded on error", async () => {
      vi.spyOn(api, "get").mockRejectedValue(new Error("offline"))
      await useNotificationStore.getState().loadList()
      expect(useNotificationStore.getState().listLoaded).toBe(true)
    })
  })

  describe("ingest", () => {
    it("bumps per-task + total, prepends, and toasts", () => {
      const toast = vi.spyOn(useToastStore.getState(), "addToast")
      useNotificationStore.getState().ingest(payload({ id: "a", type: "task.review" }))
      const s = useNotificationStore.getState()
      expect(s.totalUnread).toBe(1)
      expect(s.perTask[TASK]).toMatchObject({ count: 1, latestType: "task.review" })
      expect(s.perTask[TASK].groups).toEqual([{ type: "task.review", count: 1, latestOccurredOn: s.items[0].occurredOn }])
      expect(s.items[0].id).toBe("a")
      expect(toast).toHaveBeenCalledOnce()
    })

    it("dedupes a repeated id", () => {
      const p = payload({ id: "dup" })
      useNotificationStore.getState().ingest(p)
      useNotificationStore.getState().ingest(p)
      expect(useNotificationStore.getState().totalUnread).toBe(1)
    })

    it("ignores a missing id", () => {
      useNotificationStore.getState().ingest(payload({ id: "" }))
      expect(useNotificationStore.getState().totalUnread).toBe(0)
    })

    it("counts an empty-guid task toward the total but not per-task", () => {
      useNotificationStore.getState().ingest(payload({ id: "g", taskId: EMPTY_GUID }))
      const s = useNotificationStore.getState()
      expect(s.totalUnread).toBe(1)
      expect(Object.keys(s.perTask)).toHaveLength(0)
    })

    it("does not count or toast an already-read payload", () => {
      const toast = vi.spyOn(useToastStore.getState(), "addToast")
      useNotificationStore.getState().ingest(payload({ id: "r", isRead: true }))
      expect(useNotificationStore.getState().totalUnread).toBe(0)
      expect(toast).not.toHaveBeenCalled()
    })

    it("skips the toast when there is no title", () => {
      const toast = vi.spyOn(useToastStore.getState(), "addToast")
      useNotificationStore.getState().ingest(payload({ id: "nt", title: "" }))
      expect(toast).not.toHaveBeenCalled()
    })

    it("increments an existing per-task count", () => {
      useNotificationStore.getState().ingest(payload({ id: "x1" }))
      useNotificationStore.getState().ingest(payload({ id: "x2", type: "subtask.added" }))
      const tu = useNotificationStore.getState().perTask[TASK]
      expect(tu).toMatchObject({ count: 2, latestType: "subtask.added" })
      // Two distinct types → two groups; the newest (subtask.added) leads.
      expect(tu.groups.map((g) => g.type)).toEqual(["subtask.added", "comment.added"])
      expect(tu.groups.map((g) => g.count)).toEqual([1, 1])
    })

    it("increments the matching type-group and keeps it newest-first", () => {
      useNotificationStore.getState().ingest(payload({ id: "g1", type: "comment.added", occurredOnUtc: "2026-06-24T10:00:00Z" }))
      useNotificationStore.getState().ingest(payload({ id: "g2", type: "task.review", occurredOnUtc: "2026-06-24T11:00:00Z" }))
      useNotificationStore.getState().ingest(payload({ id: "g3", type: "comment.added", occurredOnUtc: "2026-06-24T12:00:00Z" }))
      const tu = useNotificationStore.getState().perTask[TASK]
      expect(tu.count).toBe(3)
      // comment.added now has the newest timestamp again → it leads; its count is 2.
      expect(tu.latestType).toBe("comment.added")
      expect(tu.groups.find((g) => g.type === "comment.added")!.count).toBe(2)
      expect(tu.groups[0].type).toBe("comment.added")
    })
  })

  describe("markTaskRead", () => {
    it("optimistically clears a task (only its own items) and reconciles", async () => {
      useNotificationStore.setState({
        items: [
          { ...payload({ id: "i1", taskId: TASK }), occurredOn: "x" } as unknown as AppNotification,
          { ...payload({ id: "i2", taskId: TASK2 }), occurredOn: "x" } as unknown as AppNotification,
        ],
        perTask: { [TASK]: { count: 3, latestType: "comment.added", groups: [{ type: "comment.added", count: 3, latestOccurredOn: "x" }] } },
        totalUnread: 3,
      })
      const post = vi.spyOn(api, "post").mockResolvedValue({ data: { totalUnread: 0, perTask: [] } } as never)

      await useNotificationStore.getState().markTaskRead(TASK)

      expect(post).toHaveBeenCalledWith("/realtime/api/v1/notifications/read", { taskId: TASK }, expect.anything())
      expect(useNotificationStore.getState().totalUnread).toBe(0)
      expect(useNotificationStore.getState().perTask[TASK]).toBeUndefined()
    })

    it("no-ops for an empty guid or a task with no unread", async () => {
      const post = vi.spyOn(api, "post")
      await useNotificationStore.getState().markTaskRead(EMPTY_GUID)
      await useNotificationStore.getState().markTaskRead(TASK)
      expect(post).not.toHaveBeenCalled()
    })

    it("keeps the optimistic state when the request fails", async () => {
      useNotificationStore.setState({ perTask: { [TASK]: { count: 1, latestType: "comment.added", groups: [{ type: "comment.added", count: 1, latestOccurredOn: "x" }] } }, totalUnread: 1 })
      vi.spyOn(api, "post").mockRejectedValue(new Error("offline"))
      await useNotificationStore.getState().markTaskRead(TASK)
      expect(useNotificationStore.getState().totalUnread).toBe(0)
    })
  })

  describe("markRead", () => {
    it("marks specific ids and decrements the right task", async () => {
      useNotificationStore.setState({
        items: [
          { ...payload({ id: "m1", taskId: TASK }), occurredOn: "x", isRead: false } as AppNotification,
          { ...payload({ id: "m2", taskId: TASK2 }), occurredOn: "x", isRead: false } as AppNotification,
        ],
        perTask: {
          [TASK]: { count: 1, latestType: "comment.added", groups: [{ type: "comment.added", count: 1, latestOccurredOn: "x" }] },
          [TASK2]: { count: 2, latestType: "comment.added", groups: [{ type: "comment.added", count: 2, latestOccurredOn: "x" }] },
        },
        totalUnread: 3,
      })
      vi.spyOn(api, "post").mockResolvedValue({ data: { totalUnread: 2, perTask: [{ taskId: TASK2, count: 2, latestType: "comment.added" }] } } as never)

      await useNotificationStore.getState().markRead(["m1"])

      const s = useNotificationStore.getState()
      expect(s.perTask[TASK2]).toMatchObject({ count: 2, latestType: "comment.added" })
      expect(s.items.find((i) => i.id === "m1")?.isRead).toBe(true)
    })

    it("decrements a multi-unread task without deleting it, and ignores already-read ids", async () => {
      useNotificationStore.setState({
        items: [
          { ...payload({ id: "u1", taskId: TASK }), occurredOn: "x", isRead: false } as unknown as AppNotification,
          { ...payload({ id: "u2", taskId: TASK }), occurredOn: "x", isRead: true } as unknown as AppNotification,
        ],
        perTask: { [TASK]: { count: 2, latestType: "comment.added", groups: [{ type: "comment.added", count: 2, latestOccurredOn: "x" }] } },
        totalUnread: 2,
      })
      vi.spyOn(api, "post").mockResolvedValue({
        data: { totalUnread: 1, perTask: [{ taskId: TASK, count: 1, latestType: "comment.added" }] },
      } as never)

      // u2 is already read (ignored); u1 drops TASK's count 2 → 1 (the no-delete branch).
      await useNotificationStore.getState().markRead(["u1", "u2"])

      expect(useNotificationStore.getState().perTask[TASK]).toMatchObject({ count: 1, latestType: "comment.added" })
    })

    it("no-ops on an empty id list", async () => {
      const post = vi.spyOn(api, "post")
      await useNotificationStore.getState().markRead([])
      expect(post).not.toHaveBeenCalled()
    })
  })

  describe("markAllRead", () => {
    it("clears everything and posts all:true", async () => {
      useNotificationStore.setState({ perTask: { [TASK]: { count: 2, latestType: "comment.added", groups: [{ type: "comment.added", count: 2, latestOccurredOn: "x" }] } }, totalUnread: 2 })
      const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} } as never)
      await useNotificationStore.getState().markAllRead()
      expect(post).toHaveBeenCalledWith("/realtime/api/v1/notifications/read", { all: true }, expect.anything())
      expect(useNotificationStore.getState().totalUnread).toBe(0)
    })

    it("no-ops when nothing is unread", async () => {
      const post = vi.spyOn(api, "post")
      await useNotificationStore.getState().markAllRead()
      expect(post).not.toHaveBeenCalled()
    })

    it("keeps cleared state even if the request fails", async () => {
      useNotificationStore.setState({ totalUnread: 1 })
      vi.spyOn(api, "post").mockRejectedValue(new Error("offline"))
      await useNotificationStore.getState().markAllRead()
      expect(useNotificationStore.getState().totalUnread).toBe(0)
    })
  })

  describe("useTaskUnread", () => {
    it("returns the per-task entry, or undefined without a task", () => {
      useNotificationStore.setState({ perTask: { [TASK]: { count: 1, latestType: "comment.added", groups: [{ type: "comment.added", count: 1, latestOccurredOn: "x" }] } } })
      expect(renderHook(() => useTaskUnread(TASK)).result.current).toMatchObject({ count: 1, latestType: "comment.added" })
      expect(renderHook(() => useTaskUnread(null)).result.current).toBeUndefined()
    })
  })

  it("reset clears the store", () => {
    useNotificationStore.setState({ totalUnread: 5, perTask: { [TASK]: { count: 5, latestType: "x", groups: [{ type: "x", count: 5, latestOccurredOn: "x" }] } } })
    useNotificationStore.getState().reset()
    expect(useNotificationStore.getState().totalUnread).toBe(0)
    expect(useNotificationStore.getState().items).toHaveLength(0)
  })
})
