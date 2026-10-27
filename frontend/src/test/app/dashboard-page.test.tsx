import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import DashboardPage from "@/app/(app)/dashboard/page"
import { api, duplicateTodo, fetchTaskById, joinTodo, leaveTodo, setViewerPreference } from "@/lib/api"
import { localDay } from "@/lib/calendar-date"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"
import { TodoPriority, TodoStatus, type CreateTodoPayload, type Todo, type UpdateTodoPayload } from "@/types/todo"

// The dashboard reads three things — the active page, the week's completed tasks and the
// categories — and acts on cards through handlers it hands to each card. Cards, the create panel
// and the editor are stand-ins that expose those handlers as buttons.
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/dashboard" }))
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}))

const live = vi.hoisted(() => ({ feed: undefined as ((signal: { actorId?: string }) => void) | undefined }))
vi.mock("@/lib/realtime/hooks", () => ({
  useFeedSync: (onSignal: (signal: { actorId?: string }) => void) => { live.feed = onSignal },
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
  onComplete: () => void
  onDelete: () => void
  onEdit: () => void
  onJoin?: () => Promise<void>
  onPriority?: (level: number) => void
}
vi.mock("@/components/todos/todo-card", () => ({
  TodoCard: ({ todo, onComplete, onDelete, onEdit, onJoin, onPriority }: CardProps) => (
    <article aria-label={todo.title}>
      <button type="button" onClick={onComplete}>Complete</button>
      <button type="button" onClick={onDelete}>Delete</button>
      <button type="button" onClick={onEdit}>Edit</button>
      {onJoin && <button type="button" onClick={() => void onJoin()}>Join</button>}
      {onPriority && <button type="button" onClick={() => onPriority(5)}>Priority 5</button>}
    </article>
  ),
}))

// `CreateTodoPanel` is the page's one `next/dynamic` import.
const panel = vi.hoisted(() => ({ props: undefined as undefined | { isOpen: boolean; onSubmit: (payload: CreateTodoPayload) => Promise<void> } }))
vi.mock("next/dynamic", () => ({
  default: () => function CreatePanel(props: { isOpen: boolean; onSubmit: (payload: CreateTodoPayload) => Promise<void> }) {
    panel.props = props
    return <div data-testid="create-panel" data-open={String(props.isOpen)} />
  },
}))
type EditorProps = {
  todo: Todo
  onSave: (payload: UpdateTodoPayload) => Promise<void>
  onSaveViewerPreference: (preference: { viewerCategoryId: string | null }) => Promise<void>
  onDeleteCategory: (id: string) => Promise<void>
  onStartWork?: () => Promise<void>
  onLeave?: () => Promise<void>
  onDuplicate?: () => Promise<void>
}
const editor = vi.hoisted(() => ({ props: undefined as EditorProps | undefined }))
vi.mock("@/components/todos/edit-todo-modal/lazy", () => ({
  LazyEditTodoModal: (props: EditorProps) => {
    editor.props = props
    return <div role="dialog" aria-label={`Editing ${props.todo.title}`} />
  },
}))

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  parseApiResponse: (data: unknown) => data,
  fetchTaskById: vi.fn(),
  setViewerPreference: vi.fn(),
  setTaskHidden: vi.fn(),
  joinTodo: vi.fn(),
  leaveTodo: vi.fn(),
  duplicateTodo: vi.fn(),
}))

const ME = "user-me"
const FRIEND = "user-friend"

const day = (offset: number) => {
  const [y, m, d] = localDay().split("-").map(Number)
  const at = new Date(Date.UTC(y, m - 1, d + offset))
  return at.toISOString().slice(0, 10) + "T00:00:00Z"
}

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

let active: Todo[] = []
let completed: Todo[] = []
let failActive = false

beforeEach(() => {
  active = []
  completed = []
  failActive = false
  router.push.mockReset()
  router.replace.mockReset()
  panel.props = undefined
  live.feed = undefined
  sessionStorage.clear()
  useToastStore.setState({ toasts: [] })
  vi.mocked(api.get).mockReset().mockImplementation(async (url, config) => {
    if (url === "/categories/api/v1/categories") return { data: [] }
    if ((config?.params as { isCompleted?: boolean } | undefined)?.isCompleted) return { data: { items: completed, totalCount: completed.length } }
    if (failActive) throw new Error("The task service is unavailable")
    const page = (config?.params as { pageNumber?: number } | undefined)?.pageNumber ?? 1
    return { data: { items: active.slice((page - 1) * 6, page * 6), totalCount: active.length } }
  })
  vi.mocked(api.post).mockReset()
  vi.mocked(api.put).mockReset()
  vi.mocked(api.delete).mockReset().mockResolvedValue({ data: null })
  vi.mocked(setViewerPreference).mockReset()
  for (const fn of [fetchTaskById, joinTodo, leaveTodo, duplicateTodo]) vi.mocked(fn).mockReset()
  editor.props = undefined
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
  cleanup()
})

const toastTitles = () => useToastStore.getState().toasts.map((t) => t.title)

describe("Dashboard", () => {
  it("reads the active page, the week's completed tasks and the categories", async () => {
    active = [task()]
    render(<DashboardPage />)

    expect(await screen.findByRole("article", { name: "Write the report" })).toBeInTheDocument()
    const calls = vi.mocked(api.get).mock.calls.map(([url, config]) => [url, (config as { params?: object })?.params])
    expect(calls).toContainEqual(["/todos/api/v1/todos", expect.objectContaining({ pageNumber: 1, status: "Todo,InProgress", isCompleted: false })])
    expect(calls).toContainEqual(["/todos/api/v1/todos", expect.objectContaining({ isCompleted: true, includeSubtasks: true })])
    expect(calls).toContainEqual(["/categories/api/v1/categories", undefined])
  })

  it("counts what is late, what is due today and what is shared, and each count opens Tasks", async () => {
    const user = userEvent.setup()
    active = [
      task({ id: "late", title: "Late one", dueDate: day(-2) }),
      task({ id: "today", title: "Today one", dueDate: day(0) }),
      task({ id: "shared", title: "Shared one", isPublic: true }),
      task({ id: "later", title: "Later one", dueDate: day(5), sharedWithUserIds: [FRIEND] }),
    ]
    render(<DashboardPage />)

    await screen.findByRole("article", { name: "Late one" })
    const overdue = screen.getByRole("button", { name: /overdue/ })
    expect(overdue).toHaveTextContent("1")
    expect(screen.getByRole("button", { name: /due today/ })).toHaveTextContent("1")
    expect(screen.getByRole("button", { name: /shared/ })).toHaveTextContent("2")

    await user.click(overdue)
    expect(router.push).toHaveBeenCalledWith("/tasks")
  })

  it("completes its own task: the card leaves and the list says so", async () => {
    const user = userEvent.setup()
    active = [task()]
    vi.mocked(api.put).mockResolvedValue({ data: task({ status: TodoStatus.Done, isCompleted: true }) })
    render(<DashboardPage />)

    const card = await screen.findByRole("article", { name: "Write the report" })
    await user.click(within(card).getByRole("button", { name: "Complete" }))

    await waitFor(() => expect(screen.queryByRole("article", { name: "Write the report" })).not.toBeInTheDocument())
    expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/t-1", { status: "done" })
    expect(toastTitles()).toContain("Task completed")
  })

  it("completes a friend's shared task for the viewer only", async () => {
    const user = userEvent.setup()
    active = [task({ id: "f-1", userId: FRIEND, title: "Their task", isPublic: true })]
    vi.mocked(setViewerPreference).mockResolvedValue({ completedByViewer: true, ownerCompleted: false } as Awaited<ReturnType<typeof setViewerPreference>>)
    render(<DashboardPage />)

    await user.click(within(await screen.findByRole("article", { name: "Their task" })).getByRole("button", { name: "Complete" }))

    await waitFor(() => expect(setViewerPreference).toHaveBeenCalledWith("f-1", { completedByViewer: true }))
    expect(api.put).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole("article", { name: "Their task" })).not.toBeInTheDocument())
  })

  it("does not touch a friend's task the author already closed, and says why", async () => {
    const user = userEvent.setup()
    active = [task({ id: "f-1", userId: FRIEND, title: "Their task", isPublic: true, ownerCompleted: true })]
    render(<DashboardPage />)

    await user.click(within(await screen.findByRole("article", { name: "Their task" })).getByRole("button", { name: "Complete" }))

    expect(toastTitles()).toContain("Couldn't reopen task")
    expect(setViewerPreference).not.toHaveBeenCalled()
    expect(screen.getByRole("article", { name: "Their task" })).toBeInTheDocument()
  })

  it("keeps the card when the server refuses to complete it", async () => {
    const user = userEvent.setup()
    active = [task()]
    vi.mocked(api.put).mockRejectedValue(new Error("Conflict"))
    render(<DashboardPage />)

    await user.click(within(await screen.findByRole("article", { name: "Write the report" })).getByRole("button", { name: "Complete" }))

    await waitFor(() => expect(toastTitles()).toContain("Couldn't update task"))
    expect(screen.getByRole("article", { name: "Write the report" })).toBeInTheDocument()
  })

  it("deletes behind an undo window: Undo puts the card back without a request", async () => {
    const user = userEvent.setup()
    active = [task(), task({ id: "t-2", title: "Call the venue" })]
    render(<DashboardPage />)

    await user.click(within(await screen.findByRole("article", { name: "Call the venue" })).getByRole("button", { name: "Delete" }))
    expect(screen.queryByRole("article", { name: "Call the venue" })).not.toBeInTheDocument()

    const offer = useToastStore.getState().toasts.find((t) => t.title === "Task deleted")
    expect(offer?.action?.label).toBe("Undo")
    act(() => offer!.action!.onClick())

    expect(await screen.findByRole("article", { name: "Call the venue" })).toBeInTheDocument()
    expect(api.delete).not.toHaveBeenCalled()
  })

  it("sends the deletion when the page is left inside the window", async () => {
    const user = userEvent.setup()
    active = [task()]
    const { unmount } = render(<DashboardPage />)

    await user.click(within(await screen.findByRole("article", { name: "Write the report" })).getByRole("button", { name: "Delete" }))
    unmount()

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/todos/api/v1/todos/t-1"))
  })

  it("creates a task from the panel and shows it before the page is read again", async () => {
    active = [task()]
    render(<DashboardPage />)
    await screen.findByRole("article", { name: "Write the report" })
    vi.mocked(api.post).mockResolvedValue({ data: task({ id: "t-new", title: "Book the train" }) })
    // The page is read again in the background; until that answer comes, the new card shows.
    const read = vi.mocked(api.get).getMockImplementation()!
    vi.mocked(api.get).mockImplementation((url, config) =>
      url === "/todos/api/v1/todos" ? new Promise(() => undefined) : read(url, config))

    await act(() => panel.props!.onSubmit({ title: "Book the train", priority: 3 } as CreateTodoPayload))

    expect(api.post).toHaveBeenCalledWith("/todos/api/v1/todos", { title: "Book the train", priority: 3 })
    expect(await screen.findByRole("article", { name: "Book the train" })).toBeInTheDocument()
    expect(toastTitles()).toContain("Task created")
  })

  it("explains a failed load and reads the page again on Try again", async () => {
    const user = userEvent.setup()
    failActive = true
    render(<DashboardPage />)

    expect(await screen.findByText("Couldn't load your tasks")).toBeInTheDocument()
    expect(screen.getByText("The task service is unavailable")).toBeInTheDocument()

    failActive = false
    active = [task()]
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(await screen.findByRole("article", { name: "Write the report" })).toBeInTheDocument()
  })

  it("welcomes a new account and opens the panel for its first task", async () => {
    sessionStorage.setItem("planora-first-run", "1")
    render(<DashboardPage />)

    expect(await screen.findByText("Welcome to Planora")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId("create-panel")).toHaveAttribute("data-open", "true"))
  })

  it("says there is nothing open once everything is done", async () => {
    render(<DashboardPage />)

    expect(await screen.findByText("Nothing open right now")).toBeInTheDocument()
  })

  it("opens the editor from a card", async () => {
    const user = userEvent.setup()
    active = [task()]
    render(<DashboardPage />)

    await user.click(within(await screen.findByRole("article", { name: "Write the report" })).getByRole("button", { name: "Edit" }))

    expect(await screen.findByRole("dialog", { name: "Editing Write the report" })).toBeInTheDocument()
  })

  it("reads the page again when a friend changes a task, not when the viewer did", async () => {
    active = [task()]
    render(<DashboardPage />)
    await screen.findByRole("article", { name: "Write the report" })
    const reads = () => vi.mocked(api.get).mock.calls.filter(([url]) => url === "/todos/api/v1/todos").length
    const before = reads()

    act(() => live.feed!({ actorId: ME }))
    await new Promise((resolve) => setTimeout(resolve, 450))
    expect(reads()).toBe(before)

    act(() => live.feed!({ actorId: FRIEND }))
    await waitFor(() => expect(reads()).toBe(before + 2))
  })

  it("takes its own task into work through its status, and a friend's as a worker", async () => {
    active = [task(), task({ id: "f-1", userId: FRIEND, title: "Their task", isPublic: true })]
    vi.mocked(api.put).mockResolvedValue({ data: null })
    vi.mocked(joinTodo).mockResolvedValue(task({ id: "f-1", userId: FRIEND, title: "Their task", isPublic: true, isWorking: true }))
    render(<DashboardPage />)
    const user = userEvent.setup()

    await user.click(within(await screen.findByRole("article", { name: "Write the report" })).getByRole("button", { name: "Join" }))
    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/t-1", { status: "inProgress" }))
    await user.click(within(screen.getByRole("article", { name: "Their task" })).getByRole("button", { name: "Join" }))
    await waitFor(() => expect(joinTodo).toHaveBeenCalledWith("f-1"))
    expect(toastTitles().filter((title) => title === "Task taken").length).toBeGreaterThanOrEqual(1)
  })

  it("says so when a task cannot be taken", async () => {
    active = [task({ id: "f-1", userId: FRIEND, title: "Their task", isPublic: true })]
    vi.mocked(joinTodo).mockRejectedValue(new Error("Full"))
    render(<DashboardPage />)

    await userEvent.setup().click(within(await screen.findByRole("article", { name: "Their task" })).getByRole("button", { name: "Join" }))

    await waitFor(() => expect(toastTitles()).toContain("Couldn't take task"))
  })

  it("sets the priority of the viewer's own task only", async () => {
    const user = userEvent.setup()
    active = [task(), task({ id: "f-1", userId: FRIEND, title: "Their task", isPublic: true })]
    vi.mocked(api.put).mockResolvedValue({ data: task({ priority: TodoPriority.Urgent }) })
    render(<DashboardPage />)

    await user.click(within(await screen.findByRole("article", { name: "Their task" })).getByRole("button", { name: "Priority 5" }))
    expect(api.put).not.toHaveBeenCalled()
    await user.click(within(screen.getByRole("article", { name: "Write the report" })).getByRole("button", { name: "Priority 5" }))
    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/t-1", { priority: 5 }))
  })

  it("saves the editor's changes with the task's status, and tells the editor when that fails", async () => {
    const user = userEvent.setup()
    active = [task({ status: TodoStatus.InProgress })]
    vi.mocked(api.put).mockResolvedValueOnce({ data: task({ title: "Renamed", status: TodoStatus.InProgress }) })
    render(<DashboardPage />)

    await user.click(within(await screen.findByRole("article", { name: "Write the report" })).getByRole("button", { name: "Edit" }))
    await screen.findByRole("dialog", { name: "Editing Write the report" })
    await act(() => editor.props!.onSave({ title: "Renamed" } as UpdateTodoPayload))
    expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/t-1", { title: "Renamed", status: "inprogress" })
    expect(await screen.findByRole("article", { name: "Renamed" })).toBeInTheDocument()

    vi.mocked(api.put).mockRejectedValueOnce(new Error("Title is too long"))
    await expect(editor.props!.onSave({ title: "x" } as UpdateTodoPayload)).rejects.toThrow()
    await waitFor(() => expect(toastTitles()).toContain("Couldn't save changes"))
  })

  it("saves the viewer's own category, leaves, and duplicates from the editor", async () => {
    const user = userEvent.setup()
    const theirs = task({ id: "f-1", userId: FRIEND, title: "Their task", isPublic: true, isWorking: true, workerCount: 1 })
    active = [theirs]
    vi.mocked(setViewerPreference).mockResolvedValue({} as Awaited<ReturnType<typeof setViewerPreference>>)
    vi.mocked(fetchTaskById).mockResolvedValue({ ...theirs, title: "Their task, filed" })
    vi.mocked(leaveTodo).mockResolvedValue(undefined)
    vi.mocked(duplicateTodo).mockResolvedValueOnce(task({ id: "t-copy" })).mockRejectedValueOnce(new Error("Limit"))
    render(<DashboardPage />)

    await user.click(within(await screen.findByRole("article", { name: "Their task" })).getByRole("button", { name: "Edit" }))
    await screen.findByRole("dialog", { name: "Editing Their task" })
    await act(() => editor.props!.onSaveViewerPreference({ viewerCategoryId: "cat-2" }))
    expect(setViewerPreference).toHaveBeenCalledWith("f-1", { viewerCategoryId: "cat-2", updateViewerCategory: true })
    expect(await screen.findByRole("article", { name: "Their task, filed" })).toBeInTheDocument()

    await act(() => editor.props!.onLeave!())
    expect(leaveTodo).toHaveBeenCalledWith("f-1")
    expect(toastTitles()).toContain("Left task")

    await act(() => editor.props!.onDuplicate!())
    expect(toastTitles()).toContain("Task duplicated")
    await expect(editor.props!.onDuplicate!()).rejects.toThrow()
    expect(toastTitles()).toContain("Couldn't duplicate task")
  })

  it("deletes a category from the editor and reads everything again", async () => {
    const user = userEvent.setup()
    active = [task()]
    vi.mocked(api.delete).mockResolvedValue({ data: null })
    render(<DashboardPage />)

    await user.click(within(await screen.findByRole("article", { name: "Write the report" })).getByRole("button", { name: "Edit" }))
    await screen.findByRole("dialog", { name: "Editing Write the report" })
    const reads = vi.mocked(api.get).mock.calls.length
    await act(() => editor.props!.onDeleteCategory("cat-1"))

    expect(api.delete).toHaveBeenCalledWith("/categories/api/v1/categories/cat-1")
    expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThanOrEqual(reads + 3)
  })

  it("pages through the active tasks six at a time", async () => {
    const user = userEvent.setup()
    active = Array.from({ length: 8 }, (_, i) => task({ id: `t-${i}`, title: `Task ${i}` }))
    render(<DashboardPage />)

    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(6))
    await user.click(screen.getByRole("button", { name: "Page 2" }))

    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2))
    expect(vi.mocked(api.get).mock.calls.some(([url, config]) =>
      url === "/todos/api/v1/todos" && (config as { params?: { pageNumber?: number } })?.params?.pageNumber === 2)).toBe(true)
  })

  it("sends a signed-out visitor to sign in", async () => {
    useAuthStore.setState({ isAuthenticated: false, accessToken: undefined })
    render(<DashboardPage />)

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/auth/login"))
    expect(api.get).not.toHaveBeenCalled()
  })
})
