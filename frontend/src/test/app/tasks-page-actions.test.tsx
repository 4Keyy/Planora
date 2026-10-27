import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { HTMLAttributes, ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import TodosPage from "@/app/(app)/tasks/page"
import { api, duplicateTodo, fetchTaskById, joinTodo, leaveTodo, setViewerPreference } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"
import { TodoPriority, TodoStatus, type CreateTodoPayload, type Todo, type UpdateTodoPayload } from "@/types/todo"

// What `/tasks` does with each action a card, the editor, the New task panel and the selection
// hand it: the requests it sends, what the list shows afterwards and what it says. Cards, the
// panel and the editor are stand-ins that expose those handlers as buttons; the list's keyboard
// model and the selection bar are the real ones.
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/tasks" }))
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock("@/lib/realtime/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/realtime/hooks")>()),
  useRealtimeResync: vi.fn(),
}))
vi.mock("@/lib/friend-names", () => ({ ensureFriendNames: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/hooks/use-warm-editor", () => ({ useWarmEditor: vi.fn() }))
vi.mock("@/components/ui/masonry-columns", () => ({
  MasonryColumns: <T,>({ items, renderItem, getKey }: { items: T[]; renderItem: (item: T) => ReactNode; getKey: (item: T) => string }) => (
    <div>{items.map((item) => <div key={getKey(item)}>{renderItem(item)}</div>)}</div>
  ),
}))

type CardProps = {
  todo: Todo
  rowProps?: HTMLAttributes<HTMLElement>
  onComplete: () => void
  onDelete: () => void
  onEdit: () => void
  onJoin?: () => Promise<void>
  onPriority?: (level: number) => void
}
vi.mock("@/components/todos/todo-card", () => ({
  TodoCard: ({ todo, rowProps, onComplete, onDelete, onEdit, onJoin, onPriority }: CardProps) => (
    <article aria-label={todo.title} {...rowProps}>
      <button type="button" onClick={onComplete}>Complete</button>
      <button type="button" onClick={onDelete}>Delete</button>
      <button type="button" onClick={onEdit}>Edit</button>
      {onJoin && <button type="button" onClick={() => void onJoin()}>Join</button>}
      {onPriority && <button type="button" onClick={() => onPriority(5)}>Priority 5</button>}
    </article>
  ),
}))

const panel = vi.hoisted(() => ({ onSubmit: undefined as undefined | ((payload: CreateTodoPayload) => Promise<void>) }))
vi.mock("next/dynamic", () => ({
  default: () => function CreatePanel(props: { onSubmit: (payload: CreateTodoPayload) => Promise<void> }) {
    panel.onSubmit = props.onSubmit
    return <div data-testid="create-panel" />
  },
}))

type EditorProps = {
  todo: Todo
  onSave: (payload: UpdateTodoPayload) => Promise<void>
  onSaveViewerPreference: (preference: { viewerCategoryId: string | null }) => Promise<void>
  onStartWork: () => Promise<void>
  onLeave: () => Promise<void>
  onDuplicate: () => Promise<void>
}
const editor = vi.hoisted(() => ({ props: undefined as EditorProps | undefined }))
vi.mock("@/components/todos/edit-todo-modal/lazy", () => ({
  LazyEditTodoModal: (props: EditorProps) => {
    editor.props = props
    const swallow = (run: () => Promise<void>) => () => { void run().catch(() => undefined) }
    return (
      <section role="dialog" aria-label={`Editing ${props.todo.title}`}>
        <button type="button" onClick={swallow(() => props.onSave({ title: "Renamed" } as UpdateTodoPayload))}>Save</button>
        <button type="button" onClick={swallow(() => props.onSaveViewerPreference({ viewerCategoryId: "cat-2" }))}>My category</button>
        <button type="button" onClick={swallow(props.onStartWork)}>Start</button>
        <button type="button" onClick={swallow(props.onLeave)}>Stop</button>
        <button type="button" onClick={swallow(props.onDuplicate)}>Duplicate</button>
      </section>
    )
  },
}))

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  parseApiResponse: (data: unknown) => data,
  fetchTaskById: vi.fn(),
  setTaskHidden: vi.fn(),
  setViewerPreference: vi.fn(),
  joinTodo: vi.fn(),
  leaveTodo: vi.fn(),
  duplicateTodo: vi.fn(),
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
const friendsTask = (overrides: Partial<Todo> = {}) => task({ id: "f-1", userId: FRIEND, title: "Their task", isPublic: true, ...overrides })

let active: Todo[] = []

beforeEach(() => {
  active = []
  router.push.mockReset()
  panel.onSubmit = undefined
  editor.props = undefined
  useToastStore.setState({ toasts: [] })
  vi.spyOn(console, "error").mockImplementation(() => undefined)
  vi.stubGlobal("IntersectionObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return [] }
  })
  vi.mocked(api.get).mockReset().mockImplementation(async (url, config) => {
    if (url === "/categories/api/v1/categories") return { data: [] }
    const params = (config?.params ?? {}) as { isCompleted?: boolean; pageNumber?: number }
    if (params.isCompleted) return { data: { items: [], totalCount: 0 } }
    return { data: { items: params.pageNumber === 1 ? active : [], totalCount: active.length, pageSize: 100, hasNextPage: false } }
  })
  vi.mocked(api.post).mockReset()
  vi.mocked(api.put).mockReset()
  vi.mocked(api.delete).mockReset().mockResolvedValue({ data: null })
  for (const fn of [fetchTaskById, setViewerPreference, joinTodo, leaveTodo, duplicateTodo]) vi.mocked(fn).mockReset()
  useAuthStore.setState({
    user: { userId: ME, email: "me@example.com", firstName: "Grace", lastName: "Hopper" },
    accessToken: "access-token",
    accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    refreshTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    isAuthenticated: true,
    hasHydrated: true,
    hasRestoredSession: true,
  })
})

afterEach(() => {
  // Unmount before the IntersectionObserver stub goes (docs/testing.md, React 19 effects).
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const toastTitles = () => useToastStore.getState().toasts.map((t) => t.title)
const card = (title: string) => screen.findByRole("article", { name: title })
const press = async (title: string, button: string) =>
  userEvent.setup().click(within(await card(title)).getByRole("button", { name: button }))
const openEditor = async (title: string) => {
  await press(title, "Edit")
  return screen.findByRole("dialog", { name: `Editing ${title}` })
}

describe("Tasks page actions", () => {
  it("completes an own task: the card leaves and the completed preview is read again", async () => {
    active = [task()]
    vi.mocked(api.put).mockResolvedValue({ data: null })
    render(<TodosPage />)

    await press("Write the report", "Complete")

    await waitFor(() => expect(screen.queryByRole("article", { name: "Write the report" })).not.toBeInTheDocument())
    expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/t-1", { status: "done" })
    expect(toastTitles()).toContain("Task completed")
  })

  it("keeps the card and says so when completing fails", async () => {
    active = [task()]
    vi.mocked(api.put).mockRejectedValue(new Error("Conflict"))
    render(<TodosPage />)

    await press("Write the report", "Complete")

    await waitFor(() => expect(toastTitles()).toContain("Couldn't update task"))
    expect(screen.getByRole("article", { name: "Write the report" })).toBeInTheDocument()
  })

  it("completes a friend's shared task for the viewer only", async () => {
    active = [friendsTask()]
    vi.mocked(setViewerPreference).mockResolvedValue({ completedByViewer: true, ownerCompleted: false } as Awaited<ReturnType<typeof setViewerPreference>>)
    render(<TodosPage />)

    await press("Their task", "Complete")

    await waitFor(() => expect(setViewerPreference).toHaveBeenCalledWith("f-1", { completedByViewer: true }))
    expect(api.put).not.toHaveBeenCalled()
    await waitFor(() => expect(toastTitles()).toContain("Task completed"))
  })

  it("will not touch a friend's task its author has closed", async () => {
    active = [friendsTask({ ownerCompleted: true })]
    render(<TodosPage />)

    await press("Their task", "Complete")

    expect(toastTitles()).toContain("Couldn't reopen task")
    expect(setViewerPreference).not.toHaveBeenCalled()
  })

  it("deletes behind an undo window, and puts the card back when the server refuses", async () => {
    active = [task(), task({ id: "t-2", title: "Call the venue" })]
    vi.mocked(api.delete).mockRejectedValue(new Error("Forbidden"))
    const { unmount } = render(<TodosPage />)

    await press("Call the venue", "Delete")
    expect(screen.queryByRole("article", { name: "Call the venue" })).not.toBeInTheDocument()
    const offer = useToastStore.getState().toasts.find((t) => t.title === "Task deleted")
    act(() => offer!.action!.onClick())
    expect(await card("Call the venue")).toBeInTheDocument()
    expect(api.delete).not.toHaveBeenCalled()

    await press("Call the venue", "Delete")
    unmount()
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/todos/api/v1/todos/t-2"))
    await waitFor(() => expect(toastTitles()).toContain("Couldn't delete task"))
  })

  it("creates a task from the panel, and says so when it cannot", async () => {
    active = [task()]
    render(<TodosPage />)
    await card("Write the report")
    vi.mocked(api.post).mockResolvedValueOnce({ data: task({ id: "t-new", title: "Book the train" }) })
    const read = vi.mocked(api.get).getMockImplementation()!
    vi.mocked(api.get).mockImplementation((url, config) =>
      url === "/todos/api/v1/todos" ? new Promise(() => undefined) : read(url, config))

    await act(() => panel.onSubmit!({ title: "Book the train" } as CreateTodoPayload))
    expect(await card("Book the train")).toBeInTheDocument()
    expect(toastTitles()).toContain("Task created")

    vi.mocked(api.post).mockRejectedValueOnce(new Error("Title is required"))
    await act(() => panel.onSubmit!({ title: "" } as CreateTodoPayload))
    expect(toastTitles()).toContain("Couldn't create task")
  })

  it("saves the editor's changes with the task's status and updates the card", async () => {
    const user = userEvent.setup()
    active = [task({ status: TodoStatus.InProgress })]
    vi.mocked(api.put).mockResolvedValue({ data: task({ title: "Renamed", status: TodoStatus.InProgress }) })
    render(<TodosPage />)

    await user.click(within(await openEditor("Write the report")).getByRole("button", { name: "Save" }))

    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/t-1", { title: "Renamed", status: "inprogress" }))
    expect(await card("Renamed")).toBeInTheDocument()
  })

  it("tells the editor when a save fails", async () => {
    active = [task()]
    vi.mocked(api.put).mockRejectedValue(new Error("Title is too long"))
    render(<TodosPage />)
    await openEditor("Write the report")

    await expect(editor.props!.onSave({ title: "x" } as UpdateTodoPayload)).rejects.toThrow("Title is too long")
    expect(toastTitles()).toContain("Couldn't save changes")
  })

  it("saves the viewer's own category and reads the task again", async () => {
    const user = userEvent.setup()
    active = [friendsTask()]
    vi.mocked(setViewerPreference).mockResolvedValue({} as Awaited<ReturnType<typeof setViewerPreference>>)
    vi.mocked(fetchTaskById).mockResolvedValue(friendsTask({ title: "Their task, filed" }))
    render(<TodosPage />)

    await user.click(within(await openEditor("Their task")).getByRole("button", { name: "My category" }))

    await waitFor(() => expect(setViewerPreference).toHaveBeenCalledWith("f-1", { viewerCategoryId: "cat-2", updateViewerCategory: true }))
    expect(await card("Their task, filed")).toBeInTheDocument()
  })

  it("starts and stops work from the editor: status for the owner, a worker row for a friend", async () => {
    const user = userEvent.setup()
    active = [task(), friendsTask()]
    vi.mocked(api.put).mockResolvedValue({ data: null })
    vi.mocked(joinTodo).mockResolvedValue(friendsTask({ isWorking: true }))
    vi.mocked(leaveTodo).mockResolvedValue(undefined)
    render(<TodosPage />)

    const mine = await openEditor("Write the report")
    await user.click(within(mine).getByRole("button", { name: "Start" }))
    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/t-1", { status: "inProgress" }))
    await user.click(within(mine).getByRole("button", { name: "Stop" }))
    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/t-1", { status: "todo" }))

    const theirs = await openEditor("Their task")
    await user.click(within(theirs).getByRole("button", { name: "Start" }))
    await waitFor(() => expect(joinTodo).toHaveBeenCalledWith("f-1"))
    await user.click(within(theirs).getByRole("button", { name: "Stop" }))
    await waitFor(() => expect(leaveTodo).toHaveBeenCalledWith("f-1"))
  })

  it("explains a full task when joining from its card, and reads it again", async () => {
    active = [friendsTask()]
    vi.mocked(joinTodo).mockRejectedValue({ response: { status: 409 } })
    vi.mocked(fetchTaskById).mockResolvedValue(friendsTask({ workerCount: 3 }))
    render(<TodosPage />)

    await press("Their task", "Join")

    await waitFor(() => expect(toastTitles()).toContain("Task is full or you have already joined"))
    await waitFor(() => expect(fetchTaskById).toHaveBeenCalledWith("f-1"))
  })

  it("takes its own task into work from the card through its status", async () => {
    active = [task()]
    vi.mocked(api.put).mockResolvedValue({ data: null })
    render(<TodosPage />)

    await press("Write the report", "Join")

    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/t-1", { status: "inProgress" }))
    expect(joinTodo).not.toHaveBeenCalled()
  })

  it("duplicates from the editor, and says so when it cannot", async () => {
    const user = userEvent.setup()
    active = [task()]
    vi.mocked(duplicateTodo).mockResolvedValueOnce(task({ id: "t-copy" })).mockRejectedValueOnce(new Error("Limit reached"))
    render(<TodosPage />)
    const dialog = await openEditor("Write the report")

    await user.click(within(dialog).getByRole("button", { name: "Duplicate" }))
    await waitFor(() => expect(toastTitles()).toContain("Task duplicated"))
    await user.click(within(dialog).getByRole("button", { name: "Duplicate" }))
    await waitFor(() => expect(toastTitles()).toContain("Couldn't duplicate task"))
  })

  it("changes the priority of the viewer's own task only", async () => {
    active = [task(), friendsTask()]
    vi.mocked(api.put).mockResolvedValue({ data: task({ priority: TodoPriority.Urgent }) })
    render(<TodosPage />)

    await press("Their task", "Priority 5")
    expect(api.put).not.toHaveBeenCalled()

    await press("Write the report", "Priority 5")
    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/t-1", { priority: 5 }))
  })

  it("deletes a whole selection under one undo window, and reports the ones the server kept", async () => {
    const user = userEvent.setup()
    active = [task(), task({ id: "t-2", title: "Call the venue" }), task({ id: "t-3", title: "Send invites" })]
    vi.mocked(api.delete).mockImplementation(async (url) => {
      if (String(url).endsWith("/t-3")) throw new Error("Forbidden")
      return { data: null }
    })
    const { unmount } = render(<TodosPage />)
    await card("Send invites")

    await user.keyboard("{Control>}a{/Control}")
    const bar = (await screen.findByRole("button", { name: "Clear the selection" })).closest<HTMLElement>('[role="status"]')!
    expect(bar).toHaveTextContent("3")
    await user.click(within(bar).getByRole("button", { name: /Delete/ }))

    await waitFor(() => expect(screen.queryAllByRole("article")).toHaveLength(0))
    expect(toastTitles()).toContain("3 tasks deleted")
    expect(api.delete).not.toHaveBeenCalled()

    unmount()
    await waitFor(() => expect(api.delete).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(toastTitles()).toContain("Couldn't delete some tasks"))
  })
})
