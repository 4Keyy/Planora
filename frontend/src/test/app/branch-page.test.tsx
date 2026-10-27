import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import BranchPage from "@/app/(app)/branch/[id]/page"
import { api, duplicateTodo, fetchTaskById, joinTodo, leaveTodo, setViewerPreference } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"
import { TodoPriority, TodoStatus, type Todo, type UpdateTodoPayload } from "@/types/todo"

// `/branch/{id}` owns the task and wires each editor action to the API. The editor is a stand-in
// whose buttons call those actions, so each test reads what the page sends and what it says.
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "t-1" }),
  useRouter: () => router,
  usePathname: () => "/branch/t-1",
}))

type EditorProps = {
  todo: Todo
  categories: { id: string }[]
  onSave: (payload: UpdateTodoPayload) => Promise<void>
  onSaveViewerPreference: (preference: { viewerCategoryId: string | null }) => Promise<void>
  onStartWork: () => Promise<void>
  onLeave: () => Promise<void>
  onCompleteTask: () => Promise<void>
  onDuplicate: () => Promise<void>
}
const editor = vi.hoisted(() => ({ props: undefined as EditorProps | undefined }))
vi.mock("@/components/todos/edit-todo-modal", () => ({
  TodoEditor: (props: EditorProps) => {
    editor.props = props
    const swallow = (run: () => Promise<void>) => () => { void run().catch(() => undefined) }
    return (
      <section aria-label={`Editing ${props.todo.title}`} data-categories={props.categories.length}>
        <button type="button" onClick={swallow(() => props.onSave({ title: "Renamed" } as UpdateTodoPayload))}>Save</button>
        <button type="button" onClick={swallow(() => props.onSaveViewerPreference({ viewerCategoryId: "cat-2" }))}>My category</button>
        <button type="button" onClick={swallow(props.onStartWork)}>Start</button>
        <button type="button" onClick={swallow(props.onLeave)}>Stop</button>
        <button type="button" onClick={swallow(props.onCompleteTask)}>Complete</button>
        <button type="button" onClick={swallow(props.onDuplicate)}>Duplicate</button>
      </section>
    )
  },
}))

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), put: vi.fn() },
  parseApiResponse: (data: unknown) => data,
  getApiErrorMessage: (error: unknown, fallback = "Something went wrong") => (error instanceof Error ? error.message : fallback),
  fetchTaskById: vi.fn(),
  duplicateTodo: vi.fn(),
  joinTodo: vi.fn(),
  leaveTodo: vi.fn(),
  setViewerPreference: vi.fn(),
}))

const ME = "user-me"

const task = (overrides: Partial<Todo> = {}): Todo => ({
  id: "t-1",
  userId: ME,
  title: "Plan the offsite",
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

const friendsTask = (overrides: Partial<Todo> = {}) => task({ userId: "user-friend", isPublic: true, ...overrides })

beforeEach(() => {
  router.push.mockReset()
  editor.props = undefined
  useToastStore.setState({ toasts: [] })
  useAuthStore.setState({ user: { userId: ME, email: "me@example.com", firstName: "Grace", lastName: "Hopper" } })
  vi.mocked(fetchTaskById).mockReset().mockResolvedValue(task())
  vi.mocked(api.get).mockReset().mockResolvedValue({ data: [{ id: "cat-1", name: "Work", color: "#111827" }] })
  vi.mocked(api.put).mockReset()
  for (const fn of [duplicateTodo, joinTodo, leaveTodo, setViewerPreference]) vi.mocked(fn).mockReset()
})

const toastTitles = () => useToastStore.getState().toasts.map((t) => t.title)
const opened = () => screen.findByRole("region", { name: /^Editing / })

describe("Branch page", () => {
  it("opens the task in the editor with the categories", async () => {
    render(<BranchPage />)

    expect(await screen.findByRole("region", { name: "Editing Plan the offsite" })).toHaveAttribute("data-categories", "1")
    expect(fetchTaskById).toHaveBeenCalledWith("t-1")
    expect(api.get).toHaveBeenCalledWith("/categories/api/v1/categories")
  })

  it("shows the missing-task scene when the task cannot be read", async () => {
    vi.mocked(fetchTaskById).mockRejectedValue(new Error("Not found"))
    render(<BranchPage />)

    expect(await screen.findByRole("heading", { name: "This task isn't here." })).toBeInTheDocument()
    expect(screen.queryByRole("region", { name: /^Editing / })).not.toBeInTheDocument()
  })

  it("still opens the task when the categories cannot be read", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("Category service down"))
    render(<BranchPage />)

    expect(await opened()).toHaveAttribute("data-categories", "0")
  })

  it("saves the owner's edits with the task's status unchanged", async () => {
    const user = userEvent.setup()
    vi.mocked(fetchTaskById).mockResolvedValue(task({ status: TodoStatus.InProgress }))
    vi.mocked(api.put).mockResolvedValue({ data: task({ title: "Renamed", status: TodoStatus.InProgress }) })
    render(<BranchPage />)
    await opened()

    await user.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/t-1", { title: "Renamed", status: "inprogress" }))
    expect(await screen.findByRole("region", { name: "Editing Renamed" })).toBeInTheDocument()
  })

  it("tells the owner when a save fails and hands the failure to the editor", async () => {
    vi.mocked(api.put).mockRejectedValue(new Error("Title is too long"))
    render(<BranchPage />)
    await opened()

    await expect(editor.props!.onSave({ title: "x" } as UpdateTodoPayload)).rejects.toThrow("Title is too long")
    expect(toastTitles()).toContain("Couldn't save changes")
  })

  it("saves the viewer's own category and reads the task again", async () => {
    const user = userEvent.setup()
    vi.mocked(fetchTaskById).mockResolvedValue(friendsTask())
    vi.mocked(setViewerPreference).mockResolvedValue({} as Awaited<ReturnType<typeof setViewerPreference>>)
    render(<BranchPage />)
    await opened()

    await user.click(screen.getByRole("button", { name: "My category" }))

    await waitFor(() => expect(setViewerPreference).toHaveBeenCalledWith("t-1", { viewerCategoryId: "cat-2", updateViewerCategory: true }))
    await waitFor(() => expect(fetchTaskById).toHaveBeenCalledTimes(2))
  })

  it("starts and stops work on the owner's task through its status", async () => {
    const user = userEvent.setup()
    vi.mocked(api.put).mockImplementation(async (_url, body) => ({ data: task({ status: (body as { status: string }).status === "inProgress" ? TodoStatus.InProgress : TodoStatus.Pending }) }))
    render(<BranchPage />)
    await opened()

    await user.click(screen.getByRole("button", { name: "Start" }))
    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/t-1", { status: "inProgress" }))
    await user.click(screen.getByRole("button", { name: "Stop" }))
    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/t-1", { status: "todo" }))
    expect(joinTodo).not.toHaveBeenCalled()
  })

  it("joins and leaves a friend's task as one of its workers", async () => {
    const user = userEvent.setup()
    vi.mocked(fetchTaskById).mockResolvedValue(friendsTask())
    vi.mocked(joinTodo).mockResolvedValue(friendsTask({ isWorking: true }))
    vi.mocked(leaveTodo).mockResolvedValue(undefined)
    render(<BranchPage />)
    await opened()

    await user.click(screen.getByRole("button", { name: "Start" }))
    await waitFor(() => expect(joinTodo).toHaveBeenCalledWith("t-1"))
    await user.click(screen.getByRole("button", { name: "Stop" }))
    await waitFor(() => expect(leaveTodo).toHaveBeenCalledWith("t-1"))
    expect(api.put).not.toHaveBeenCalled()
  })

  it("says so when work cannot start", async () => {
    const user = userEvent.setup()
    vi.mocked(api.put).mockRejectedValue(new Error("Conflict"))
    render(<BranchPage />)
    await opened()

    await user.click(screen.getByRole("button", { name: "Start" }))

    await waitFor(() => expect(toastTitles()).toContain("Couldn't update task"))
  })

  it("completes and reopens the owner's task", async () => {
    const user = userEvent.setup()
    vi.mocked(api.put).mockResolvedValueOnce({ data: task({ status: TodoStatus.Done, isCompleted: true }) })
    vi.mocked(api.put).mockResolvedValueOnce({ data: task() })
    render(<BranchPage />)
    await opened()

    await user.click(screen.getByRole("button", { name: "Complete" }))
    await waitFor(() => expect(toastTitles()).toContain("Task completed"))
    expect(api.put).toHaveBeenLastCalledWith("/todos/api/v1/todos/t-1", { status: "done" })

    await user.click(screen.getByRole("button", { name: "Complete" }))
    await waitFor(() => expect(toastTitles()).toContain("Task reopened"))
    expect(api.put).toHaveBeenLastCalledWith("/todos/api/v1/todos/t-1", { status: "todo" })
  })

  it("completes a friend's shared task for the viewer only", async () => {
    const user = userEvent.setup()
    vi.mocked(fetchTaskById).mockResolvedValue(friendsTask())
    vi.mocked(setViewerPreference).mockResolvedValue({ completedByViewer: true, ownerCompleted: false } as Awaited<ReturnType<typeof setViewerPreference>>)
    render(<BranchPage />)
    await opened()

    await user.click(screen.getByRole("button", { name: "Complete" }))

    await waitFor(() => expect(setViewerPreference).toHaveBeenCalledWith("t-1", { completedByViewer: true }))
    expect(api.put).not.toHaveBeenCalled()
    expect(toastTitles()).toContain("Task completed")
  })

  it("will not reopen a friend's task the author has closed", async () => {
    const user = userEvent.setup()
    vi.mocked(fetchTaskById).mockResolvedValue(friendsTask({ isCompletedByViewer: true, ownerCompleted: true }))
    render(<BranchPage />)
    await opened()

    await user.click(screen.getByRole("button", { name: "Complete" }))

    expect(toastTitles()).toContain("Couldn't reopen task")
    expect(setViewerPreference).not.toHaveBeenCalled()
  })

  it("duplicates the task and opens the copy", async () => {
    const user = userEvent.setup()
    vi.mocked(duplicateTodo).mockResolvedValue(task({ id: "t-copy" }))
    render(<BranchPage />)
    await opened()

    await user.click(screen.getByRole("button", { name: "Duplicate" }))

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/branch/t-copy"))
    expect(toastTitles()).toContain("Task duplicated")
  })

  it("says so when the copy cannot be made", async () => {
    const user = userEvent.setup()
    vi.mocked(duplicateTodo).mockRejectedValue(new Error("Limit reached"))
    render(<BranchPage />)
    await opened()

    await user.click(screen.getByRole("button", { name: "Duplicate" }))

    await waitFor(() => expect(toastTitles()).toContain("Couldn't duplicate task"))
    expect(router.push).not.toHaveBeenCalled()
  })
})
