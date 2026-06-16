import { create } from "zustand"
import { api } from "@/lib/api"
import { useToastStore } from "@/store/toast"
import type { NotificationPayload } from "@/lib/realtime/client"

const SUMMARY_URL = "/realtime/api/v1/notifications/summary"
const LIST_URL = "/realtime/api/v1/notifications"
const READ_URL = "/realtime/api/v1/notifications/read"

/** Mirrors the api client's best-effort request config so a transient failure does not log. The
 *  `params` member (shared with AxiosRequestConfig) keeps it structurally compatible as a config. */
type SilentConfig = { params?: Record<string, unknown>; suppressErrorLog?: boolean }
const SILENT: SilentConfig = { suppressErrorLog: true }
const EMPTY_GUID = "00000000-0000-0000-0000-000000000000"
/** Cap the in-memory list (the bell dropdown); older items are fetched on demand. */
const MAX_ITEMS = 100

/** A notification normalized to the client shape (single canonical timestamp). */
export interface AppNotification {
  id: string
  userId: string
  taskId: string
  actorId: string
  type: string
  title: string
  message: string
  occurredOn: string
  isRead: boolean
}

/** Per-task unread roll-up that drives a card's dot and a branch's badge. */
export interface TaskUnread {
  count: number
  latestType: string
}

interface SummaryDto {
  totalUnread: number
  perTask: Array<{ taskId: string; count: number; latestType: string }>
}

interface NotificationsState {
  /** Newest-first list for the bell dropdown (lazily loaded). */
  items: AppNotification[]
  /** taskId → unread roll-up. Empty-guid (non-task) notifications are excluded. */
  perTask: Record<string, TaskUnread>
  totalUnread: number
  /** Whether the bell list has been fetched at least once this session. */
  listLoaded: boolean
  /** Ids ever ingested live — guards against a double count on a redelivered push. */
  seen: Set<string>

  hydrate: () => Promise<void>
  loadList: () => Promise<void>
  ingest: (payload: NotificationPayload) => void
  markTaskRead: (taskId: string) => Promise<void>
  markRead: (ids: string[]) => Promise<void>
  markAllRead: () => Promise<void>
  reset: () => void
}

function normalize(payload: NotificationPayload): AppNotification {
  return {
    id: payload.id,
    userId: payload.userId,
    taskId: payload.taskId,
    actorId: payload.actorId,
    type: payload.type,
    title: payload.title,
    message: payload.message,
    occurredOn: payload.occurredOnUtc ?? payload.occurredOn ?? new Date().toISOString(),
    isRead: payload.isRead ?? false,
  }
}

function toPerTask(summary: SummaryDto): Record<string, TaskUnread> {
  const map: Record<string, TaskUnread> = {}
  for (const t of summary.perTask ?? []) {
    if (t.taskId && t.taskId !== EMPTY_GUID) {
      map[t.taskId] = { count: t.count, latestType: t.latestType }
    }
  }
  return map
}

export const useNotificationStore = create<NotificationsState>((set, get) => ({
  items: [],
  perTask: {},
  totalUnread: 0,
  listLoaded: false,
  seen: new Set<string>(),

  /** Load the compact unread summary (total + per-task). Called on login and after reconnects. */
  hydrate: async () => {
    try {
      const res = await api.get<SummaryDto>(SUMMARY_URL, SILENT)
      const data = res.data
      set({ perTask: toPerTask(data), totalUnread: data.totalUnread ?? 0 })
    } catch {
      /* best-effort — the indicators simply stay at their last known value */
    }
  },

  /** Fetch the newest notifications for the bell dropdown (lazy, on first open). */
  loadList: async () => {
    try {
      const res = await api.get<NotificationPayload[]>(LIST_URL, SILENT)
      const items = (res.data ?? []).map(normalize)
      const seen = new Set(get().seen)
      for (const it of items) seen.add(it.id)
      set({ items, listLoaded: true, seen })
    } catch {
      set({ listLoaded: true })
    }
  },

  /**
   * Apply a live notification: dedupe, bump the per-task + total unread counts, prepend to the list
   * and surface an in-app toast. Notifications for an event the viewer triggered never reach here —
   * the actor is excluded server-side.
   */
  ingest: (payload) => {
    const id = payload.id
    if (!id || get().seen.has(id)) return

    const n = normalize(payload)
    set((state) => {
      const seen = new Set(state.seen)
      seen.add(id)

      const items = [n, ...state.items].slice(0, MAX_ITEMS)

      let perTask = state.perTask
      if (n.taskId && n.taskId !== EMPTY_GUID && !n.isRead) {
        const existing = state.perTask[n.taskId]
        perTask = {
          ...state.perTask,
          [n.taskId]: { count: (existing?.count ?? 0) + 1, latestType: n.type },
        }
      }

      return {
        seen,
        items,
        perTask,
        totalUnread: state.totalUnread + (n.isRead ? 0 : 1),
      }
    })

    if (!n.isRead && n.title) {
      useToastStore.getState().addToast({ type: "info", title: n.title, description: n.message })
    }
  },

  /** Mark every unread notification for a task read (card open / branch viewed). Optimistic. */
  markTaskRead: async (taskId) => {
    if (!taskId || taskId === EMPTY_GUID) return
    const current = get().perTask[taskId]
    if (!current || current.count === 0) return

    set((state) => {
      const perTask = { ...state.perTask }
      delete perTask[taskId]
      return {
        perTask,
        totalUnread: Math.max(0, state.totalUnread - current.count),
        items: state.items.map((it) => (it.taskId === taskId ? { ...it, isRead: true } : it)),
      }
    })

    try {
      const res = await api.post<SummaryDto>(READ_URL, { taskId }, SILENT)
      set({ perTask: toPerTask(res.data), totalUnread: res.data.totalUnread ?? 0 })
    } catch {
      /* optimistic state stands; the next hydrate reconciles */
    }
  },

  /** Mark specific notifications read (individual bell items). Optimistic. */
  markRead: async (ids) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)

    set((state) => {
      let removed = 0
      const perTask: Record<string, TaskUnread> = { ...state.perTask }
      const items = state.items.map((it) => {
        if (idSet.has(it.id) && !it.isRead) {
          removed++
          if (it.taskId && perTask[it.taskId]) {
            const next = perTask[it.taskId].count - 1
            if (next <= 0) delete perTask[it.taskId]
            else perTask[it.taskId] = { ...perTask[it.taskId], count: next }
          }
          return { ...it, isRead: true }
        }
        return it
      })
      return { items, perTask, totalUnread: Math.max(0, state.totalUnread - removed) }
    })

    try {
      const res = await api.post<SummaryDto>(READ_URL, { ids }, SILENT)
      set({ perTask: toPerTask(res.data), totalUnread: res.data.totalUnread ?? 0 })
    } catch {
      /* optimistic state stands */
    }
  },

  /** Mark everything read (bell "mark all read"). Optimistic. */
  markAllRead: async () => {
    if (get().totalUnread === 0) return
    set((state) => ({
      perTask: {},
      totalUnread: 0,
      items: state.items.map((it) => ({ ...it, isRead: true })),
    }))
    try {
      await api.post(READ_URL, { all: true }, SILENT)
    } catch {
      /* optimistic state stands */
    }
  },

  reset: () =>
    set({ items: [], perTask: {}, totalUnread: 0, listLoaded: false, seen: new Set<string>() }),
}))

/** Per-task unread selector for cards and the branch badge. Returns undefined when all read. */
export function useTaskUnread(taskId: string | null | undefined): TaskUnread | undefined {
  return useNotificationStore((s) => (taskId ? s.perTask[taskId] : undefined))
}
