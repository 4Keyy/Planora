import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import TodosPage from "@/app/(app)/tasks/page"
import { api } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"
import { TodoPriority, TodoStatus, type Todo } from "@/types/todo"

// The Completed row under `/tasks`: what a finished card's own actions do there. Reopening reads
// both lists again; deleting keeps the card in the row until the server has deleted it, and then
// reads the row again. `tasks-page-actions.test.tsx` covers the active list.
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
vi.mock("next/dynamic", () => ({ default: () => function CreatePanel() { return <div data-testid="create-panel" /> } }))
vi.mock("@/components/ui/masonry-columns", () => ({
  MasonryColumns: <T,>({ items, renderItem, getKey }: { items: T[]; renderItem: (item: T) => ReactNode; getKey: (item: T) => string }) => (
    <div>{items.map((item) => <div key={getKey(item)}>{renderItem(item)}</div>)}</div>
  ),
}))
vi.mock("@/components/todos/todo-card", () => ({
  TodoCard: ({ todo, onComplete, onDelete }: { todo: Todo; onComplete: () => void; onDelete: () => void }) => (
    <article aria-label={todo.title}>
      <button type="button" onClick={onComplete}>Complete</button>
      <button type="button" onClick={onDelete}>Delete</button>
    </article>
  ),
}))
vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
  parseApiResponse: (data: unknown) => data,
  fetchTaskById: vi.fn(),
  setTaskHidden: vi.fn(),
  setViewerPreference: vi.fn(),
  joinTodo: vi.fn(),
  leaveTodo: vi.fn(),
  duplicateTodo: vi.fn(),
}))

const ME = "user-me"

const finished: Todo = {
  id: "t-done",
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
}

let completed: Todo[] = []

beforeEach(() => {
  completed = [finished]
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
    const params = (config?.params ?? {}) as { isCompleted?: boolean }
    if (params.isCompleted) return { data: { items: completed, totalCount: completed.length } }
    return { data: { items: [], totalCount: 0, pageSize: 100, hasNextPage: false } }
  })
  vi.mocked(api.put).mockReset()
  vi.mocked(api.delete).mockReset()
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
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const titles = () => useToastStore.getState().toasts.map((t) => t.title)
const completedReads = () =>
  vi.mocked(api.get).mock.calls.filter(([, config]) => (config?.params as { isCompleted?: boolean } | undefined)?.isCompleted).length
const activeReads = () =>
  vi.mocked(api.get).mock.calls.filter(([url, config]) =>
    url === "/todos/api/v1/todos" && (config?.params as { isCompleted?: boolean } | undefined)?.isCompleted === false).length

const openCompletedRow = async () => {
  await userEvent.setup().click(await screen.findByRole("button", { name: /Completed/ }))
  return screen.findByRole("article", { name: "Filed the report" })
}

describe("Tasks page — the Completed row", () => {
  it("reopens a finished task and reads both lists again", async () => {
    vi.mocked(api.put).mockResolvedValue({ data: { ...finished, status: TodoStatus.Pending, isCompleted: false } })
    render(<TodosPage />)
    const card = await openCompletedRow()
    const [active, done] = [activeReads(), completedReads()]

    await userEvent.setup().click(within(card).getByRole("button", { name: "Complete" }))

    await waitFor(() => expect(titles()).toContain("Task reopened"))
    expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/t-done", { status: "todo" })
    expect(activeReads()).toBeGreaterThan(active)
    expect(completedReads()).toBeGreaterThan(done)
  })

  it("keeps a deleted finished card in the row until the server deletes it, then reads the row again", async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: null })
    const { unmount } = render(<TodosPage />)
    const card = await openCompletedRow()

    await userEvent.setup().click(within(card).getByRole("button", { name: "Delete" }))
    expect(screen.getByRole("article", { name: "Filed the report" })).toBeInTheDocument()
    expect(titles()).toContain("Task deleted")
    const before = completedReads()

    unmount()
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/todos/api/v1/todos/t-done"))
    await waitFor(() => expect(completedReads()).toBe(before + 1))
  })

  it("undoes a finished card's deletion without a request, and says so when the server keeps it", async () => {
    vi.mocked(api.delete).mockRejectedValue(new Error("Forbidden"))
    const { unmount } = render(<TodosPage />)
    const card = await openCompletedRow()

    await userEvent.setup().click(within(card).getByRole("button", { name: "Delete" }))
    act(() => useToastStore.getState().toasts.find((t) => t.title === "Task deleted")!.action!.onClick())
    expect(api.delete).not.toHaveBeenCalled()
    expect(screen.getByRole("article", { name: "Filed the report" })).toBeInTheDocument()

    await userEvent.setup().click(within(screen.getByRole("article", { name: "Filed the report" })).getByRole("button", { name: "Delete" }))
    const before = completedReads()
    unmount()

    await waitFor(() => expect(titles()).toContain("Couldn't delete task"))
    expect(api.delete).toHaveBeenCalledWith("/todos/api/v1/todos/t-done")
    expect(completedReads()).toBe(before)
  })
})
