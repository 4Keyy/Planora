import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { AxiosHeaders, type AxiosRequestConfig, type AxiosResponse } from "axios"
import { useRef, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import CompletedTasksPage from "@/app/(app)/tasks/completed/page"
import { api } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"
import { ensureFriendNames } from "@/lib/friend-names"
import type { Todo } from "@/types/todo"

const router = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router }))
vi.mock("next/dynamic", () => ({ default: () => () => null }))
vi.mock("@/lib/friend-names", () => ({ ensureFriendNames: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/components/ui/confirm-dialog", () => ({ ConfirmDialog: () => null }))
vi.mock("@/components/todos/category-filter-modal", () => ({ CategoryFilterModal: () => null }))
vi.mock("@/components/todos/task-deletion-badge", () => ({ TaskDeletionBadge: () => null }))
vi.mock("@/components/todos/todo-skeleton", () => ({ TodoSkeleton: () => <div data-testid="skeleton" /> }))
vi.mock("@/components/ui/masonry-columns", () => ({
  MasonryColumns: <T,>({ items, renderItem, getKey }: {
    items: T[]; renderItem: (item: T) => ReactNode; getKey: (item: T) => string
  }) => <div>{items.map(item => <div key={getKey(item)}>{renderItem(item)}</div>)}</div>,
}))
vi.mock("@/components/todos/todo-card", () => ({
  TodoCard: function MockTodoCard({ todo, onComplete }: { todo: Todo; onComplete: () => void }) {
    // The real memoized card can retain an older callback while its task is unchanged.
    const firstComplete = useRef(onComplete)
    return <article data-testid={`task-${todo.id}`}>
      {todo.title}<button onClick={firstComplete.current}>Reopen {todo.id}</button>
    </article>
  },
}))
vi.mock("@/components/todos/date-filter-popover", () => ({
  DateFilterPopover: ({ onChange }: { onChange: (start: string | null, end: string | null) => void }) => (
    <div><button onClick={() => onChange(null, "2026-10-06")}>Date A</button>
      <button onClick={() => onChange(null, "2026-10-07")}>Date B</button></div>
  ),
}))
vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
  setTaskHidden: vi.fn(), fetchTaskById: vi.fn(), setViewerPreference: vi.fn(), duplicateTodo: vi.fn(),
  parseApiResponse: (value: unknown) => value,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function response(data: unknown): AxiosResponse {
  return { data, status: 200, statusText: "OK", headers: {}, config: { headers: new AxiosHeaders() } }
}

const task: Todo = {
  id: "one", userId: "viewer", title: "Finished task", description: null, status: "Done",
  categoryId: null, categoryName: null, categoryColor: null, categoryIcon: null,
  dueDate: null, expectedDate: null, actualDate: null, priority: "Medium", isPublic: false,
  isCompleted: true, hidden: false, completedAt: "2026-10-06T12:00:00Z", isOnTime: null,
  delay: null, tags: [], createdAt: "2026-10-01T12:00:00Z", updatedAt: null, sharedWithUserIds: [],
}
const todosResponse = (items: Todo[] = [task]) => response({ items, totalCount: items.length })
type PendingRequest = ReturnType<typeof deferred<AxiosResponse>> & { config?: AxiosRequestConfig }

function requestsWith(categoryResult: Promise<AxiosResponse>) {
  const requests: PendingRequest[] = []
  vi.mocked(api.get).mockImplementation((url: string, config?: AxiosRequestConfig) => {
    if (url.startsWith("/categories/")) return categoryResult
    const pending = { ...deferred<AxiosResponse>(), config }
    requests.push(pending)
    return pending.promise
  })
  return requests
}

async function loadInitial(requests: PendingRequest[]) {
  await waitFor(() => expect(requests).toHaveLength(1))
  await act(async () => { requests[0].resolve(todosResponse()) })
  return screen.findByTestId("task-one")
}

describe("Completed page stable loading", () => {
  afterEach(() => vi.restoreAllMocks())
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useToastStore.setState({ toasts: [] })
    vi.mocked(ensureFriendNames).mockResolvedValue(undefined)
    useAuthStore.setState({
      user: { userId: "viewer", email: "viewer@example.test", firstName: "Viewer", lastName: "User" },
      accessToken: "fixture-token", accessTokenExpiresAt: "2099-01-01T00:00:00Z",
      refreshTokenExpiresAt: "2099-01-01T00:00:00Z", roles: ["User"], emailVerified: true,
      isAuthenticated: true, hasHydrated: true, hasRestoredSession: true,
    })
  })

  it.each(["empty", "failed"])("keeps the filter plate and cards mounted after late %s categories", async outcome => {
    const categories = deferred<AxiosResponse>()
    const requests = requestsWith(categories.promise)
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined)
    render(<CompletedTasksPage />)
    const card = await loadInitial(requests)
    const plate = screen.getByRole("heading", { name: "Quick filter" })
    expect(screen.getByRole("button", { name: "Date A" })).toBeInTheDocument()
    await act(async () => {
      if (outcome === "empty") categories.resolve(response([]))
      else categories.reject(new Error("Categories unavailable"))
    })
    expect(screen.getByRole("heading", { name: "Quick filter" })).toBe(plate)
    expect(screen.getByTestId("task-one")).toBe(card)
    expect(screen.getByRole("button", { name: "Date A" })).toBeInTheDocument()
    errorLog.mockRestore()
  })

  it("keeps current cards during a refresh and does not refetch categories for a date pick", async () => {
    const requests = requestsWith(Promise.resolve(response([{ id: "cat", name: "Work" }])))
    const { container } = render(<CompletedTasksPage />)
    const card = await loadInitial(requests)
    fireEvent.click(screen.getByRole("button", { name: "Date A" }))
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(screen.getByTestId("task-one")).toBe(card)
    expect(screen.queryByTestId("skeleton")).not.toBeInTheDocument()
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "true")
    await act(async () => { requests[1].resolve(todosResponse()) })
    expect(screen.getByTestId("task-one")).toBe(card)
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "false")
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url.startsWith("/categories/"))).toHaveLength(1)
  })

  it("ignores an old response and its finally while a newer date request is pending", async () => {
    const requests = requestsWith(Promise.resolve(response([{ id: "cat", name: "Work" }])))
    const { container } = render(<CompletedTasksPage />)
    await loadInitial(requests)
    fireEvent.click(screen.getByRole("button", { name: "Date A" }))
    fireEvent.click(screen.getByRole("button", { name: "Date B" }))
    await waitFor(() => expect(requests).toHaveLength(3))
    expect(requests[1].config?.signal?.aborted).toBe(true)
    await act(async () => { requests[1].resolve(todosResponse([{ ...task, title: "Stale response" }])) })
    expect(screen.queryByText("Stale response")).not.toBeInTheDocument()
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "true")
    await act(async () => { requests[2].resolve(todosResponse([{ ...task, title: "Latest response" }])) })
    expect(screen.getByText("Latest response")).toBeInTheDocument()
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "false")
  })

  it("does not overwrite the latest results when the older response arrives last", async () => {
    const requests = requestsWith(Promise.resolve(response([{ id: "cat", name: "Work" }])))
    render(<CompletedTasksPage />)
    await loadInitial(requests)
    fireEvent.click(screen.getByRole("button", { name: "Date A" }))
    fireEvent.click(screen.getByRole("button", { name: "Date B" }))
    await waitFor(() => expect(requests).toHaveLength(3))
    await act(async () => { requests[2].resolve(todosResponse([{ ...task, title: "Latest response" }])) })
    await act(async () => { requests[1].resolve(todosResponse([{ ...task, title: "Stale response" }])) })
    expect(screen.getByText("Latest response")).toBeInTheDocument()
    expect(screen.queryByText("Stale response")).not.toBeInTheDocument()
  })

  it("guards the response after delayed author enrichment", async () => {
    const requests = requestsWith(Promise.resolve(response([{ id: "cat", name: "Work" }])))
    render(<CompletedTasksPage />)
    await loadInitial(requests)
    const authors = deferred<void>()
    vi.mocked(ensureFriendNames).mockReturnValueOnce(authors.promise)
    fireEvent.click(screen.getByRole("button", { name: "Date A" }))
    await act(async () => { requests[1].resolve(todosResponse([{ ...task, userId: "friend", isPublic: true, title: "Old enrichment" }])) })
    fireEvent.click(screen.getByRole("button", { name: "Date B" }))
    await act(async () => { requests[2].resolve(todosResponse([{ ...task, title: "Latest response" }])) })
    await act(async () => { authors.resolve() })
    expect(screen.getByText("Latest response")).toBeInTheDocument()
    expect(screen.queryByText("Old enrichment")).not.toBeInTheDocument()
  })

  it("aborts outstanding work on unmount", async () => {
    const requests = requestsWith(Promise.resolve(response([])))
    const { unmount } = render(<CompletedTasksPage />)
    await waitFor(() => expect(requests).toHaveLength(1))
    const signal = requests[0].config?.signal
    unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => { requests[0].resolve(todosResponse()) })
  })

  it("keeps successful results on a refresh failure and announces the error", async () => {
    const requests = requestsWith(Promise.resolve(response([{ id: "cat", name: "Work" }])))
    const { container } = render(<CompletedTasksPage />)
    const card = await loadInitial(requests)
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.mocked(api.put).mockResolvedValue(response({}))
    fireEvent.click(screen.getByRole("button", { name: "Reopen one" }))
    await waitFor(() => expect(requests).toHaveLength(2))
    await act(async () => { requests[1].reject(new Error("Network unavailable")) })
    expect(screen.getByTestId("task-one")).toBe(card)
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "false")
    expect(useToastStore.getState().toasts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "error", title: "Couldn't refresh completed tasks" }),
    ]))
  })

  it("retries an initial failure with the initial skeleton before showing results", async () => {
    const requests = requestsWith(Promise.resolve(response([])))
    render(<CompletedTasksPage />)
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    await act(async () => { requests[0].reject(new Error("Network unavailable")) })
    expect(screen.getByText("Couldn't load your completed tasks")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(screen.getAllByTestId("skeleton")).toHaveLength(20)
    await act(async () => { requests[1].resolve(todosResponse()) })
    expect(screen.getByText("Finished task")).toBeInTheDocument()
  })

  it("uses the latest date criteria when an unchanged card retains its old reopen callback", async () => {
    const requests = requestsWith(Promise.resolve(response([{ id: "cat", name: "Work" }])))
    vi.mocked(api.put).mockResolvedValue(response({}))
    render(<CompletedTasksPage />)
    await loadInitial(requests)
    fireEvent.click(screen.getByRole("button", { name: "Date B" }))
    await act(async () => { requests[1].resolve(todosResponse()) })
    fireEvent.click(screen.getByRole("button", { name: "Reopen one" }))
    await waitFor(() => expect(requests).toHaveLength(3))
    expect(requests[2].config?.params).toEqual(requests[1].config?.params)
    await act(async () => { requests[2].resolve(todosResponse()) })
  })

  it("does not show the previous account's results while the new account request is pending", async () => {
    const requests = requestsWith(Promise.resolve(response([])))
    render(<CompletedTasksPage />)
    await loadInitial(requests)
    act(() => { useAuthStore.setState({ user: { userId: "new-viewer", email: "new@example.test", firstName: "New", lastName: "Viewer" } }) })
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(screen.queryByTestId("task-one")).not.toBeInTheDocument()
    expect(screen.getAllByTestId("skeleton")).toHaveLength(20)
    await act(async () => { requests[1].resolve(todosResponse([{ ...task, userId: "new-viewer", title: "New account task" }])) })
    expect(screen.getByText("New account task")).toBeInTheDocument()
  })

  it("shows a persistent retry state when a changed date request fails", async () => {
    const requests = requestsWith(Promise.resolve(response([{ id: "cat", name: "Work" }])))
    render(<CompletedTasksPage />)
    await loadInitial(requests)
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    fireEvent.click(screen.getByRole("button", { name: "Date A" }))
    await act(async () => { requests[1].reject(new Error("Network unavailable")) })
    expect(screen.queryByTestId("task-one")).not.toBeInTheDocument()
    expect(screen.getByText("Couldn't load your completed tasks")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    await act(async () => { requests[2].resolve(todosResponse([{ ...task, title: "Date A results" }])) })
    expect(screen.getByText("Date A results")).toBeInTheDocument()
  })

  it("does not present page one as page two after a paging request fails", async () => {
    const requests = requestsWith(Promise.resolve(response([])))
    render(<CompletedTasksPage />)
    await act(async () => { requests[0].resolve(response({ items: [task], totalCount: 40 })) })
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await act(async () => { requests[1].reject(new Error("Network unavailable")) })
    expect(screen.queryByTestId("task-one")).not.toBeInTheDocument()
    expect(screen.getByText("Couldn't load your completed tasks")).toBeInTheDocument()
    expect(requests[1].config?.params).toEqual(expect.objectContaining({ pageNumber: 2 }))
  })
})
