import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import CompletedTasksPage from "@/app/(app)/tasks/completed/page"
import { api, duplicateTodo, fetchTaskById, setViewerPreference } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"
import { TodoPriority, TodoStatus, type Todo, type UpdateTodoPayload } from "@/types/todo"

// The archive's actions: reopening (for everyone, for the viewer, or not at all once the author
// closed it), deleting after a confirmation, and the editor's saves. Cards and the editor are
// stand-ins; the confirmation dialog is the real one.
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/tasks/completed" }))
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock("@/lib/friend-names", () => ({ ensureFriendNames: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/hooks/use-warm-editor", () => ({ useWarmEditor: vi.fn() }))
vi.mock("@/components/ui/masonry-columns", () => ({
  MasonryColumns: <T,>({ items, renderItem, getKey }: { items: T[]; renderItem: (item: T) => ReactNode; getKey: (item: T) => string }) => (
    <div>{items.map((item) => <div key={getKey(item)}>{renderItem(item)}</div>)}</div>
  ),
}))
vi.mock("@/components/todos/todo-card", () => ({
  TodoCard: ({ todo, onComplete, onDelete, onEdit }: { todo: Todo; onComplete: () => void; onDelete: () => void; onEdit: () => void }) => (
    <article aria-label={todo.title}>
      <button type="button" onClick={onComplete}>Reopen</button>
      <button type="button" onClick={onDelete}>Delete</button>
      <button type="button" onClick={onEdit}>Edit</button>
    </article>
  ),
}))

type EditorProps = {
  todo: Todo
  onSave: (payload: UpdateTodoPayload) => Promise<void>
  onSaveViewerPreference: (preference: { viewerCategoryId: string | null }) => Promise<void>
  onDuplicate: () => Promise<void>
}
const editor = vi.hoisted(() => ({ props: undefined as EditorProps | undefined }))
vi.mock("@/components/todos/edit-todo-modal/lazy", () => ({
  LazyEditTodoModal: (props: EditorProps) => {
    editor.props = props
    return <section role="dialog" aria-label={`Editing ${props.todo.title}`} />
  },
}))

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
  parseApiResponse: (data: unknown) => data,
  fetchTaskById: vi.fn(),
  setTaskHidden: vi.fn(),
  setViewerPreference: vi.fn(),
  duplicateTodo: vi.fn(),
}))

const ME = "user-me"

const done = (overrides: Partial<Todo> = {}): Todo => ({
  id: "t-1",
  userId: ME,
  title: "Filed the report",
  description: null,
  status: TodoStatus.Done,
  categoryId: null,
  dueDate: null,
  expectedDate: null,
  actualDate: null,
  priority: TodoPriority.Medium,
  isPublic: false,
  isCompleted: true,
  hidden: false,
  completedAt: "2026-10-25T12:00:00Z",
  isOnTime: null,
  delay: null,
  tags: [],
  createdAt: "2026-10-20T09:00:00Z",
  updatedAt: null,
  sharedWithUserIds: [],
  ...overrides,
})
const friends = (overrides: Partial<Todo> = {}) =>
  done({ id: "f-1", userId: "user-friend", title: "Their task", isPublic: true, isCompletedByViewer: true, ...overrides })

let archive: Todo[] = []

beforeEach(() => {
  archive = []
  editor.props = undefined
  useToastStore.setState({ toasts: [] })
  vi.spyOn(console, "error").mockImplementation(() => undefined)
  vi.mocked(api.get).mockReset().mockImplementation(async (url) => {
    if (url === "/categories/api/v1/categories") return { data: [] }
    return { data: { items: archive, totalCount: archive.length } }
  })
  vi.mocked(api.put).mockReset()
  vi.mocked(api.delete).mockReset()
  for (const fn of [fetchTaskById, setViewerPreference, duplicateTodo]) vi.mocked(fn).mockReset()
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
  vi.restoreAllMocks()
})

const toastTitles = () => useToastStore.getState().toasts.map((t) => t.title)
const press = async (title: string, button: string) =>
  userEvent.setup().click(within(await screen.findByRole("article", { name: title })).getByRole("button", { name: button }))
const archiveReads = () => vi.mocked(api.get).mock.calls.filter(([url]) => url === "/todos/api/v1/todos").length

describe("Completed page actions", () => {
  it("reopens an own task for everyone and reads the archive again", async () => {
    archive = [done()]
    vi.mocked(api.put).mockResolvedValue({ data: null })
    render(<CompletedTasksPage />)
    await screen.findByRole("article", { name: "Filed the report" })
    const before = archiveReads()

    archive = []
    await press("Filed the report", "Reopen")

    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/t-1", { status: "todo" }))
    await waitFor(() => expect(archiveReads()).toBeGreaterThan(before))
    expect(toastTitles()).toContain("Task reopened")
    await waitFor(() => expect(screen.queryByRole("article", { name: "Filed the report" })).not.toBeInTheDocument())
  })

  it("reopens a friend's task for the viewer only", async () => {
    archive = [friends()]
    vi.mocked(setViewerPreference).mockResolvedValue({} as Awaited<ReturnType<typeof setViewerPreference>>)
    render(<CompletedTasksPage />)

    await press("Their task", "Reopen")

    await waitFor(() => expect(setViewerPreference).toHaveBeenCalledWith("f-1", { completedByViewer: false }))
    expect(api.put).not.toHaveBeenCalled()
    expect(toastTitles()).toContain("Task reopened")
  })

  it("will not reopen a friend's task its author has closed", async () => {
    archive = [friends({ ownerCompleted: true })]
    render(<CompletedTasksPage />)

    await press("Their task", "Reopen")

    expect(toastTitles()).toContain("Couldn't reopen task")
    expect(setViewerPreference).not.toHaveBeenCalled()
  })

  it("says so when reopening fails", async () => {
    archive = [done()]
    vi.mocked(api.put).mockRejectedValue(new Error("Conflict"))
    render(<CompletedTasksPage />)

    await press("Filed the report", "Reopen")

    await waitFor(() => expect(toastTitles()).toContain("Couldn't update task"))
  })

  it("deletes a task only after the confirmation, and not when it is cancelled", async () => {
    const user = userEvent.setup()
    archive = [done()]
    vi.mocked(api.delete).mockResolvedValue({ data: null })
    render(<CompletedTasksPage />)

    await press("Filed the report", "Delete")
    let dialog = await screen.findByRole("dialog", { name: "Delete Task?" })
    expect(dialog).toHaveTextContent('Are you sure you want to delete "Filed the report"?')
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
    expect(api.delete).not.toHaveBeenCalled()

    await press("Filed the report", "Delete")
    dialog = await screen.findByRole("dialog", { name: "Delete Task?" })
    await user.click(within(dialog).getByRole("button", { name: "Delete Task" }))

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/todos/api/v1/todos/t-1"))
    await waitFor(() => expect(toastTitles()).toContain("Task deleted"))
  })

  it("says so when the server refuses the deletion", async () => {
    const user = userEvent.setup()
    archive = [done()]
    vi.mocked(api.delete).mockRejectedValue(new Error("Forbidden"))
    render(<CompletedTasksPage />)

    await press("Filed the report", "Delete")
    await user.click(within(await screen.findByRole("dialog", { name: "Delete Task?" })).getByRole("button", { name: "Delete Task" }))

    await waitFor(() => expect(toastTitles()).toContain("Couldn't delete task"))
  })

  it("saves the editor's changes with the task's status", async () => {
    archive = [done()]
    vi.mocked(api.put).mockResolvedValue({ data: done({ title: "Filed the final report" }) })
    render(<CompletedTasksPage />)

    await press("Filed the report", "Edit")
    await screen.findByRole("dialog", { name: "Editing Filed the report" })
    await act(() => editor.props!.onSave({ title: "Filed the final report" } as UpdateTodoPayload))

    expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/t-1", { title: "Filed the final report", status: "done" })
    expect(await screen.findByRole("article", { name: "Filed the final report" })).toBeInTheDocument()
  })

  it("tells the editor when a save fails", async () => {
    archive = [done()]
    vi.mocked(api.put).mockRejectedValue(new Error("Title is too long"))
    render(<CompletedTasksPage />)

    await press("Filed the report", "Edit")
    await screen.findByRole("dialog", { name: "Editing Filed the report" })

    await expect(editor.props!.onSave({ title: "x" } as UpdateTodoPayload)).rejects.toThrow("Title is too long")
    expect(toastTitles()).toContain("Couldn't save changes")
  })

  it("saves the viewer's own category and reads the task again", async () => {
    archive = [friends()]
    vi.mocked(setViewerPreference).mockResolvedValue({} as Awaited<ReturnType<typeof setViewerPreference>>)
    vi.mocked(fetchTaskById).mockResolvedValue(friends({ title: "Their task, filed" }))
    render(<CompletedTasksPage />)

    await press("Their task", "Edit")
    await screen.findByRole("dialog", { name: "Editing Their task" })
    await act(() => editor.props!.onSaveViewerPreference({ viewerCategoryId: "cat-2" }))

    expect(setViewerPreference).toHaveBeenCalledWith("f-1", { viewerCategoryId: "cat-2", updateViewerCategory: true })
    expect(await screen.findByRole("article", { name: "Their task, filed" })).toBeInTheDocument()
  })

  it("duplicates from the editor, and says so when it cannot", async () => {
    archive = [done()]
    vi.mocked(duplicateTodo).mockResolvedValueOnce(done({ id: "t-copy" })).mockRejectedValueOnce(new Error("Limit reached"))
    render(<CompletedTasksPage />)

    await press("Filed the report", "Edit")
    await screen.findByRole("dialog", { name: "Editing Filed the report" })
    await act(() => editor.props!.onDuplicate())
    expect(toastTitles()).toContain("Task duplicated")
    await expect(editor.props!.onDuplicate()).rejects.toThrow("Limit reached")
    expect(toastTitles()).toContain("Couldn't duplicate task")
  })
})
