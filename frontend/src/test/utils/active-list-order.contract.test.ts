import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { sortTasks, type SortableTask } from "@/utils/sort-tasks"
import { restoreTimeZone, setTimeZone } from "@/test/time-zone"

// The Dashboard pages the active list on the server and Tasks sorts all of it on the client, so
// the two orders must be one. The same fixture drives TodoActiveListPostgresTests: the API's
// ORDER BY and this sort must both produce `expected`.

type GoldenTask = {
  label: string
  owner: "viewer" | "friend"
  priority: string
  status?: "InProgress"
  due?: number | null
  createdHoursAgo: number
  audience?: "shared" | "public"
  hidden?: boolean
  hiddenByViewer?: boolean
  viewerWorks?: boolean
}
type GoldenOrder = { now: string; timeZone: string; tasks: GoldenTask[]; expected: string[] }

const golden: GoldenOrder = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "../tests/fixtures/active-list-order.json"), "utf8"),
)

const VIEWER = "11111111-1111-1111-1111-111111111111"
const FRIEND = "22222222-2222-2222-2222-222222222222"
const NOBODY = "00000000-0000-0000-0000-000000000000"
const HOUR_MS = 3_600_000

/** The viewer's today in their own zone — what the API derives from X-Time-Zone. */
const viewerToday = (): [number, number, number] => {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: golden.timeZone })
    .format(new Date(golden.now)).split("-").map(Number)
  return [y, m, d]
}

/** A due day `offset` days from the viewer's today, stored as its midnight UTC. */
const dueIso = (offset: number) => {
  const [y, m, d] = viewerToday()
  return new Date(Date.UTC(y, m - 1, d + offset)).toISOString()
}

/**
 * The row as `GET /todos` hands it to this viewer (GetUserTodosQueryHandler): in full when open;
 * the owner's own private task folded without its date; anyone else's, or a task with an
 * audience, masked (HiddenTodoDtoFactory) — no date, no status, no creation time.
 */
function asTheViewerReceivesIt(task: GoldenTask): SortableTask {
  const isOwner = task.owner === "viewer"
  const userId = isOwner ? VIEWER : FRIEND
  const hasAudience = task.audience !== undefined
  const hidden = !hasAudience ? Boolean(task.hidden)
    : isOwner ? Boolean(task.hiddenByViewer || task.hidden)
    : Boolean(task.hiddenByViewer)
  const isVisuallyUrgent = task.priority === "Urgent" || (task.due != null && task.due <= 0)
  const status = task.status === "InProgress" ? "In Progress" : "Todo"
  const createdAt = new Date(new Date(golden.now).getTime() - task.createdHoursAgo * HOUR_MS).toISOString()

  if (hidden && (!isOwner || hasAudience)) {
    return {
      id: task.label, userId: isOwner ? userId : NOBODY, title: "Hidden task", hidden: true, status: "",
      priority: task.priority, isPublic: task.audience === "public", createdAt: "0001-01-01T00:00:00",
      sharedWithUserIds: [], hasSharedAudience: hasAudience, isVisuallyUrgent,
    }
  }
  if (hidden) {
    return {
      id: task.label, userId, title: task.label, hidden: true, status, priority: task.priority,
      isPublic: false, createdAt, sharedWithUserIds: [], hasSharedAudience: false, isVisuallyUrgent, isWorking: false,
    }
  }
  return {
    id: task.label, userId, title: task.label, hidden: false, status, priority: task.priority,
    isPublic: task.audience === "public", dueDate: task.due == null ? null : dueIso(task.due), createdAt,
    sharedWithUserIds: task.audience === "shared" ? [isOwner ? FRIEND : VIEWER] : [],
    hasSharedAudience: hasAudience, isVisuallyUrgent, isWorking: !isOwner && Boolean(task.viewerWorks),
  }
}

beforeEach(() => {
  setTimeZone(golden.timeZone)
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(golden.now))
})

afterEach(() => {
  vi.useRealTimers()
  restoreTimeZone()
})

describe("the active list's one order", () => {
  it("sorts the shared fixture exactly as the API orders it", () => {
    const rows = golden.tasks.map(asTheViewerReceivesIt)

    expect(sortTasks(rows, VIEWER).map((task) => task.id)).toEqual(golden.expected)
    expect(sortTasks([...rows].reverse(), VIEWER).map((task) => task.id)).toEqual(golden.expected)
  })

  it("leads with the viewer's own work, not with a friend's task the friend is working on", () => {
    const rows = golden.tasks.map(asTheViewerReceivesIt)
    const order = sortTasks(rows, VIEWER).map((task) => task.id)

    expect(order.indexOf("u-friend-progress")).toBeGreaterThan(order.indexOf("u-overdue-low-old"))
    expect(order.indexOf("s-friend-progress")).toBeGreaterThan(order.indexOf("s-own-shared-low"))
  })
})
