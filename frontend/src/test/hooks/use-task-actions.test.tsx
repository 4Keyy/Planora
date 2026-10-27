import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  useTaskActions, type CompletionOutcome, type StartedWork, type StoppedWork, type TaskActionsOptions,
} from "@/hooks/use-task-actions"
import { api, fetchTaskById, joinTodo, leaveTodo, setViewerPreference } from "@/lib/api"
import { AUTHOR_COMPLETED_TOAST } from "@/lib/errors"
import { useToastStore } from "@/store/toast"
import { TodoPriority, TodoStatus, type Todo } from "@/types/todo"

// The shared actions every task page wires to its own lists (audit FE-24): what each sends, what
// it hands back to the page and what it says. The pages' own tests pin the same requests and
// messages through each page; these pin every rule a page can choose.
vi.mock("@/lib/api", () => ({
  api: { put: vi.fn() },
  parseApiResponse: (data: unknown) => data,
  getApiErrorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
  setViewerPreference: vi.fn(),
  fetchTaskById: vi.fn(),
  joinTodo: vi.fn(),
  leaveTodo: vi.fn(),
}))

const ME = "user-me"
const FRIEND = "user-friend"

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
const friends = (overrides: Partial<Todo> = {}) => task({ id: "f-1", userId: FRIEND, title: "Their task", isPublic: true, ...overrides })

const actionsFor = (options: Partial<TaskActionsOptions> = {}) =>
  renderHook(() => useTaskActions({ viewerId: ME, ...options })).result.current

const toasts = () => useToastStore.getState().toasts.map(({ type, title, description }) => ({ type, title, description }))
const titles = () => useToastStore.getState().toasts.map((t) => t.title)
/** The notices one step said: the store folds a repeated notice into the one already showing. */
const said = async (step: () => Promise<void>) => {
  useToastStore.setState({ toasts: [] })
  await step()
  return titles()
}

const authorClosed = Object.assign(new Error("Request failed"), {
  response: { status: 400, data: { error: { code: "AUTHOR_ALREADY_COMPLETED" } } },
})

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  vi.mocked(api.put).mockReset()
  for (const fn of [setViewerPreference, fetchTaskById, joinTodo, leaveTodo]) vi.mocked(fn).mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("useTaskActions — complete", () => {
  it("completes the owner's task through its status and hands the server's answer to the page first", async () => {
    const answer = task({ status: TodoStatus.Done, isCompleted: true })
    vi.mocked(api.put).mockResolvedValue({ data: answer })
    const seen: string[] = []
    const apply = vi.fn((_outcome: CompletionOutcome) => { seen.push(`apply:${titles().length}`) })

    await actionsFor().complete(task(), apply)

    expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/t-1", { status: "done" })
    expect(apply).toHaveBeenCalledWith({ via: "status", todo: task(), reopened: false, updated: answer })
    expect(seen).toEqual(["apply:0"])
    expect(toasts()).toEqual([{ type: "success", title: "Task completed", description: undefined }])
  })

  it("does nothing for a task the page no longer holds", async () => {
    const apply = vi.fn()
    const actions = actionsFor()

    await actions.complete(undefined, apply)
    await actions.complete(null, apply)

    expect(api.put).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
    expect(titles()).toEqual([])
  })

  it("reopens the owner's finished task", async () => {
    vi.mocked(api.put).mockResolvedValue({ data: task() })
    const apply = vi.fn()

    await actionsFor().complete(task({ status: "completed" }), apply)

    expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/t-1", { status: "todo" })
    expect(apply.mock.calls[0][0]).toMatchObject({ via: "status", reopened: true })
    expect(titles()).toEqual(["Task reopened"])
  })

  it("completes a friend's shared task for the viewer alone and hands back their mark", async () => {
    vi.mocked(setViewerPreference).mockResolvedValue({ todoId: "f-1", hiddenByViewer: false, viewerCategoryId: null, completedByViewer: true, ownerCompleted: false })
    let outcome: CompletionOutcome | undefined
    await actionsFor().complete(friends(), (o) => { outcome = o })

    expect(setViewerPreference).toHaveBeenCalledWith("f-1", { completedByViewer: true })
    expect(api.put).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ via: "viewer", reopened: false })
    if (outcome?.via !== "viewer") throw new Error("expected the viewer route")
    expect(outcome.patch(friends({ title: "Kept" }))).toMatchObject({ title: "Kept", isCompletedByViewer: true, ownerCompleted: false })
    expect(titles()).toEqual(["Task completed"])
  })

  it("reads the viewer's own mark to reopen, and an unknown mark as not done", async () => {
    vi.mocked(setViewerPreference).mockResolvedValue({ todoId: "f-1", hiddenByViewer: false, viewerCategoryId: null, completedByViewer: null, ownerCompleted: false })
    const actions = actionsFor()
    let patched: Todo | undefined

    await actions.complete(friends({ isCompletedByViewer: true, status: TodoStatus.Pending }), (o) => {
      if (o.via === "viewer") patched = o.patch(friends())
    })
    expect(setViewerPreference).toHaveBeenLastCalledWith("f-1", { completedByViewer: false })
    expect(patched?.isCompletedByViewer).toBe(false)

    await actions.complete(friends({ sharedWithUserIds: [ME], isPublic: false, isCompletedByViewer: null, status: TodoStatus.Done }), vi.fn())
    expect(setViewerPreference).toHaveBeenLastCalledWith("f-1", { completedByViewer: true })
    expect(titles()).toEqual(["Task reopened", "Task completed"])
  })

  it("refuses any press on a task its author closed, before sending anything", async () => {
    const apply = vi.fn()
    const actions = actionsFor()

    await actions.complete(friends({ ownerCompleted: true }), apply)
    expect(toasts()).toEqual([AUTHOR_COMPLETED_TOAST])
    expect(await said(() => actions.complete(friends({ ownerCompleted: true, isCompletedByViewer: true }), apply)))
      .toEqual([AUTHOR_COMPLETED_TOAST.title])

    expect(setViewerPreference).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
  })

  it("sends a friend's task that reads as unshared (hidden) through its status", async () => {
    vi.mocked(api.put).mockResolvedValue({ data: null })

    await actionsFor().complete(friends({ isPublic: false, sharedWithUserIds: undefined, status: "", ownerCompleted: true }), vi.fn())

    expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/f-1", { status: "done" })
    expect(setViewerPreference).not.toHaveBeenCalled()
  })

  it("says the task could not be updated and leaves the page's lists alone when the server refuses", async () => {
    vi.mocked(api.put).mockRejectedValue(new Error("Conflict"))
    const apply = vi.fn()

    await actionsFor().complete(task(), apply)

    expect(apply).not.toHaveBeenCalled()
    expect(toasts()).toEqual([{ type: "error", title: "Couldn't update task", description: undefined }])
  })

  it("explains the author's refusal when the server gives it, on either route", async () => {
    vi.mocked(setViewerPreference).mockRejectedValue(authorClosed)
    vi.mocked(api.put).mockRejectedValue(authorClosed)
    const actions = actionsFor()

    expect(await said(() => actions.complete(friends({ isCompletedByViewer: true }), vi.fn()))).toEqual([AUTHOR_COMPLETED_TOAST.title])
    expect(await said(() => actions.complete(friends({ isPublic: false }), vi.fn()))).toEqual([AUTHOR_COMPLETED_TOAST.title])
    expect(setViewerPreference).toHaveBeenCalledTimes(1)
    expect(api.put).toHaveBeenCalledTimes(1)
  })

  it("reports a failure of the page's own update as the action's", async () => {
    vi.mocked(api.put).mockResolvedValue({ data: task() })

    await actionsFor().complete(task(), () => { throw new Error("list gone") })

    expect(titles()).toEqual(["Couldn't update task"])
  })

  it("carries the server's message where the page asks for it", async () => {
    vi.mocked(api.put).mockRejectedValue(new Error("The task is locked"))

    await actionsFor({ describe: true }).complete(task(), vi.fn())

    expect(toasts()).toEqual([{ type: "error", title: "Couldn't update task", description: "The task is locked" }])
  })

  it("writes failures to the console only for pages that log them, naming the route", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.mocked(api.put).mockRejectedValue(new Error("Conflict"))
    vi.mocked(setViewerPreference).mockRejectedValue(new Error("Conflict"))

    await actionsFor().complete(task(), vi.fn())
    expect(logged).not.toHaveBeenCalled()

    const logging = actionsFor({ log: true })
    await logging.complete(task(), vi.fn())
    await logging.complete(friends(), vi.fn())
    const reopening = actionsFor({ log: true, completion: { direction: "reopen" } })
    await reopening.complete(task({ status: TodoStatus.Done }), vi.fn())
    await reopening.complete(friends({ isCompletedByViewer: true }), vi.fn())

    expect(logged.mock.calls.map(([label]) => label)).toEqual([
      "Failed to update todo:",
      "Failed to update viewer completion:",
      "Failed to reopen todo:",
      "Failed to reopen viewer completion:",
    ])
  })

  describe("the archive's rules: reopen only, every non-owner through their own mark", () => {
    const archive = () => actionsFor({ completion: { direction: "reopen", viewerPreference: "non-owner" } })

    it("reopens whatever the task's state reads", async () => {
      vi.mocked(api.put).mockResolvedValue({ data: task() })
      vi.mocked(setViewerPreference).mockResolvedValue({ todoId: "f-1", hiddenByViewer: false, viewerCategoryId: null, completedByViewer: false, ownerCompleted: false })
      const actions = archive()

      expect(await said(() => actions.complete(task({ status: TodoStatus.Pending }), vi.fn()))).toEqual(["Task reopened"])
      expect(await said(() => actions.complete(friends({ isPublic: false, sharedWithUserIds: [] }), vi.fn()))).toEqual(["Task reopened"])

      expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/t-1", { status: "todo" })
      expect(setViewerPreference).toHaveBeenCalledWith("f-1", { completedByViewer: false })
    })

    it("refuses a non-owner's reopening of a task its author closed", async () => {
      await archive().complete(friends({ isPublic: false, ownerCompleted: true }), vi.fn())

      expect(setViewerPreference).not.toHaveBeenCalled()
      expect(titles()).toEqual([AUTHOR_COMPLETED_TOAST.title])
    })
  })

  describe("the landing console's rule: complete only", () => {
    it("completes even a task whose status reads done", async () => {
      vi.mocked(api.put).mockResolvedValue({ data: task() })

      await actionsFor({ completion: { direction: "complete" } }).complete(task({ status: TodoStatus.Done }), vi.fn())

      expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/t-1", { status: "done" })
      expect(titles()).toEqual(["Task completed"])
    })
  })

  describe("the branch page's reading: a non-owner's own mark, and only their reopening refused", () => {
    const branch = () => actionsFor({ completion: { reading: "for-viewer" } })

    it("lets a viewer complete a task its author closed", async () => {
      vi.mocked(setViewerPreference).mockResolvedValue({ todoId: "f-1", hiddenByViewer: false, viewerCategoryId: null, completedByViewer: true, ownerCompleted: true })

      await branch().complete(friends({ ownerCompleted: true }), vi.fn())

      expect(setViewerPreference).toHaveBeenCalledWith("f-1", { completedByViewer: true })
      expect(titles()).toEqual(["Task completed"])
    })

    it("refuses a viewer's reopening of it, on either route", async () => {
      const actions = branch()

      expect(await said(() => actions.complete(friends({ ownerCompleted: true, isCompletedByViewer: true }), vi.fn())))
        .toEqual([AUTHOR_COMPLETED_TOAST.title])
      expect(await said(() => actions.complete(friends({ isPublic: false, ownerCompleted: true, isCompletedByViewer: true }), vi.fn())))
        .toEqual([AUTHOR_COMPLETED_TOAST.title])

      expect(setViewerPreference).not.toHaveBeenCalled()
      expect(api.put).not.toHaveBeenCalled()
    })

    it("reads an unshared friend's task by the viewer's mark while sending it through the status", async () => {
      vi.mocked(api.put).mockResolvedValue({ data: null })

      await branch().complete(friends({ isPublic: false, status: TodoStatus.Done, isCompletedByViewer: true }), vi.fn())

      expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/f-1", { status: "todo" })
      expect(titles()).toEqual(["Task reopened"])
    })

    it("reads the owner's own task by its status", async () => {
      vi.mocked(api.put).mockResolvedValue({ data: task() })

      await branch().complete(task({ status: TodoStatus.Done, isCompletedByViewer: false }), vi.fn())

      expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/t-1", { status: "todo" })
    })
  })

  it("acts for the viewer of the latest render, through actions that never change", async () => {
    vi.mocked(api.put).mockResolvedValue({ data: null })
    vi.mocked(setViewerPreference).mockResolvedValue({ todoId: "t-1", hiddenByViewer: false, viewerCategoryId: null, completedByViewer: true, ownerCompleted: false })
    const { result, rerender } = renderHook(({ viewerId }) => useTaskActions({ viewerId }), { initialProps: { viewerId: ME } })
    const first = result.current

    rerender({ viewerId: FRIEND })
    expect(result.current).toBe(first)
    await first.complete(task({ isPublic: true }), vi.fn())

    expect(setViewerPreference).toHaveBeenCalledWith("t-1", { completedByViewer: true })
  })
})

describe("useTaskActions — startWork and stopWork", () => {
  const dashboardWording = { started: "Task taken", startFailed: "Couldn't take task", stopped: "Left task", stopFailed: "Couldn't leave task" }
  const tasksWording = { joinFailed: "Couldn't join task", explainFull: true, leaveFailed: "Couldn't leave task" }
  const full = Object.assign(new Error("Conflict"), { response: { status: 409 } })

  it("takes the owner's task into work through its status, saying nothing by default", async () => {
    const answer = task({ status: TodoStatus.InProgress })
    vi.mocked(api.put).mockResolvedValue({ data: answer })
    let started: StartedWork | undefined

    await actionsFor().startWork(task(), (w) => { started = w })

    expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/t-1", { status: "inProgress" })
    expect(joinTodo).not.toHaveBeenCalled()
    expect(started).toMatchObject({ via: "status", updated: answer })
    expect(started!.patch(task({ title: "Kept" }))).toMatchObject({ title: "Kept", status: "In Progress" })
    expect(titles()).toEqual([])
  })

  it("joins a friend's task as a worker and hands back the joined task", async () => {
    const joined = friends({ isWorking: true, workerCount: 2 })
    vi.mocked(joinTodo).mockResolvedValue(joined)
    let started: StartedWork | undefined

    await actionsFor({ work: dashboardWording }).startWork(friends(), (w) => { started = w })

    expect(joinTodo).toHaveBeenCalledWith("f-1")
    expect(api.put).not.toHaveBeenCalled()
    expect(started).toMatchObject({ via: "worker", updated: joined })
    expect(started!.patch(friends({ authorName: "Ada" }))).toMatchObject({ authorName: "Ada", isWorking: true, workerCount: 2 })
    expect(titles()).toEqual(["Task taken"])
  })

  it("words a failed start the page's way, the owner's and a worker's alike by default", async () => {
    vi.mocked(api.put).mockRejectedValue(new Error("Conflict"))
    vi.mocked(joinTodo).mockRejectedValue(full)
    const apply = vi.fn()

    expect(await said(() => actionsFor().startWork(task(), apply))).toEqual(["Couldn't update task"])
    expect(await said(() => actionsFor().startWork(friends(), apply))).toEqual(["Couldn't update task"])
    expect(await said(() => actionsFor({ work: dashboardWording }).startWork(friends(), apply))).toEqual(["Couldn't take task"])
    expect(await said(() => actionsFor({ work: tasksWording }).startWork(task(), apply))).toEqual(["Couldn't update task"])
    expect(apply).not.toHaveBeenCalled()
  })

  it("explains a full task where the page does, and reads it again for the page that asks", async () => {
    vi.mocked(joinTodo).mockRejectedValue(full)
    const fresh = friends({ workerCount: 3 })
    vi.mocked(fetchTaskById).mockResolvedValue(fresh)
    const onFull = vi.fn()
    const actions = actionsFor({ work: tasksWording })

    await actions.startWork(friends(), vi.fn(), { onFull })
    expect(toasts()).toEqual([{ type: "warning", title: "Task is full or you have already joined", description: undefined }])
    expect(onFull).toHaveBeenCalledWith(fresh)

    await actions.startWork(friends(), vi.fn())
    expect(fetchTaskById).toHaveBeenCalledTimes(1)

    vi.mocked(fetchTaskById).mockRejectedValue(new Error("Gone"))
    await actions.startWork(friends(), vi.fn(), { onFull })
    expect(onFull).toHaveBeenCalledTimes(1)

    vi.mocked(joinTodo).mockRejectedValue(new Error("Offline"))
    expect(await said(() => actions.startWork(friends(), vi.fn(), { onFull }))).toEqual(["Couldn't join task"])
  })

  it("takes the owner's task out of work through its status", async () => {
    const answer = task({ status: TodoStatus.Pending })
    vi.mocked(api.put).mockResolvedValue({ data: answer })
    let stopped: StoppedWork | undefined

    await actionsFor({ work: dashboardWording }).stopWork(task({ status: TodoStatus.InProgress }), (w) => { stopped = w })

    expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/t-1", { status: "todo" })
    expect(stopped).toMatchObject({ via: "status", updated: answer })
    expect(stopped!.patch(task({ status: TodoStatus.InProgress }))).toMatchObject({ status: "Todo" })
    expect(titles()).toEqual(["Left task"])
  })

  it("leaves a friend's task as one worker fewer", async () => {
    vi.mocked(leaveTodo).mockResolvedValue(undefined)
    let stopped: StoppedWork | undefined

    await actionsFor().stopWork(friends(), (w) => { stopped = w })

    expect(leaveTodo).toHaveBeenCalledWith("f-1")
    expect(stopped?.via).toBe("worker")
    expect(stopped!.patch(friends({ isWorking: true, workerCount: 2 }))).toMatchObject({ isWorking: false, workerCount: 1 })
    expect(stopped!.patch(friends({ isWorking: true }))).toMatchObject({ workerCount: 0 })
    expect(stopped!.patch(friends({ workerCount: 0 }))).toMatchObject({ workerCount: 0 })
    expect(titles()).toEqual([])
  })

  it("words a failed stop the page's way", async () => {
    vi.mocked(api.put).mockRejectedValue(new Error("Conflict"))
    vi.mocked(leaveTodo).mockRejectedValue(new Error("Conflict"))
    const apply = vi.fn()

    expect(await said(() => actionsFor().stopWork(task(), apply))).toEqual(["Couldn't stop working"])
    expect(await said(() => actionsFor().stopWork(friends(), apply))).toEqual(["Couldn't stop working"])
    expect(await said(() => actionsFor({ work: tasksWording }).stopWork(task(), apply))).toEqual(["Couldn't stop working"])
    expect(await said(() => actionsFor({ work: tasksWording }).stopWork(friends(), apply))).toEqual(["Couldn't leave task"])
    expect(await said(() => actionsFor({ work: dashboardWording }).stopWork(friends(), apply))).toEqual(["Couldn't leave task"])
    expect(apply).not.toHaveBeenCalled()
  })

  it("describes a failure with the server's message where the page asks", async () => {
    vi.mocked(joinTodo).mockRejectedValue(new Error("The task is full"))
    vi.mocked(api.put).mockRejectedValue(new Error("Locked"))
    const actions = actionsFor({ describe: true })

    await actions.startWork(friends(), vi.fn())
    expect(toasts()).toEqual([{ type: "error", title: "Couldn't update task", description: "The task is full" }])
    useToastStore.setState({ toasts: [] })
    await actions.stopWork(task(), vi.fn())
    expect(toasts()).toEqual([{ type: "error", title: "Couldn't stop working", description: "Locked" }])
  })

  it("does nothing for a task the page no longer holds", async () => {
    const actions = actionsFor()

    await actions.startWork(undefined, vi.fn())
    await actions.stopWork(null, vi.fn())

    expect(api.put).not.toHaveBeenCalled()
    expect(joinTodo).not.toHaveBeenCalled()
    expect(leaveTodo).not.toHaveBeenCalled()
  })
})
