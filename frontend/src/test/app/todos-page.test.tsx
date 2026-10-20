import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import TodosPage from "@/app/(app)/tasks/page"
import { api, fetchTaskById, setViewerPreference } from "@/lib/api"
import { ensureFriendNames } from "@/lib/friend-names"
import { useAuthStore } from "@/store/auth"
import type { Todo } from "@/types/todo"

const routerMocks = vi.hoisted(() => ({
  replace: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}))

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

// The live feed's resync signal, captured so a test can fire it (useRealtimeResync below).
const liveFeed = vi.hoisted(() => ({ resync: undefined as (() => void) | undefined }))
vi.mock("@/lib/realtime/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/realtime/hooks")>()),
  useRealtimeResync: (onResync: () => void) => {
    liveFeed.resync = onResync
  },
}))

vi.mock("@/lib/friend-names", () => ({
  ensureFriendNames: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/components/ui/masonry-columns", () => ({
  MasonryColumns: ({ items, renderItem, getKey }: any) => (
    <div>{items.map((item: any) => <div key={getKey(item)}>{renderItem(item)}</div>)}</div>
  ),
}))

vi.mock("@/components/todos/todo-card", () => ({
  TodoCard: ({ todo, onToggleHidden }: any) => (
    <article data-testid={`todo-${todo.id}`}>
      <span>{todo.title}</span>
      <button type="button" onClick={onToggleHidden}>
        {todo.hidden ? "Reveal" : "Hide"}
      </button>
    </article>
  ),
}))

vi.mock("@/components/todos/create-todo-panel", () => ({
  CreateTodoPanel: () => <div />,
}))

vi.mock("@/components/todos/edit-todo-modal", () => ({
  EditTodoModal: () => <div />,
}))

vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: () => <div />,
}))

vi.mock("@/components/todos/category-filter-modal", () => ({
  CategoryFilterModal: () => <div />,
}))

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  fetchTaskById: vi.fn(),
  setTaskHidden: vi.fn(),
  setViewerPreference: vi.fn(),
  parseApiResponse: (response: any) => response?.value ?? response?.data ?? response,
}))

const hiddenTodo: Todo = {
  id: "todo-hidden",
  userId: "00000000-0000-0000-0000-000000000000",
  title: "Hidden task",
  description: null,
  status: "",
  categoryId: "cat-1",
  categoryName: "Private",
  categoryColor: "#111827",
  categoryIcon: "Lock",
  dueDate: null,
  expectedDate: null,
  actualDate: null,
  priority: "",
  isPublic: false,
  isCompleted: false,
  hidden: true,
  completedAt: null,
  isOnTime: null,
  delay: null,
  tags: [],
  createdAt: "0001-01-01T00:00:00.000Z",
  updatedAt: null,
  sharedWithUserIds: [],
}

const fullTodo: Todo = {
  ...hiddenTodo,
  userId: "owner-1",
  title: "Shared project plan",
  description: "Sensitive implementation detail",
  status: "Pending",
  priority: "Medium",
  isPublic: true,
  hidden: false,
  tags: ["private"],
  createdAt: "2026-05-02T00:00:00.000Z",
  sharedWithUserIds: ["viewer-1"],
}

const resetAuth = () => {
  useAuthStore.setState({
    user: {
      userId: "viewer-1",
      email: "viewer@example.com",
      firstName: "Viewer",
      lastName: "User",
    },
    accessToken: "access-token",
    accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    refreshTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    roles: ["User"],
    emailVerified: true,
    isAuthenticated: true,
    hasHydrated: true,
    hasRestoredSession: true,
  })
}

const mockInitialRequests = () => {
  vi.mocked(api.get).mockImplementation((url: string, config?: any) => {
    if (url === "/todos/api/v1/todos" && config?.params?.isCompleted === false) {
      return Promise.resolve({ data: { items: [hiddenTodo], totalCount: 1 } })
    }

    if (url === "/todos/api/v1/todos" && config?.params?.isCompleted === true) {
      return Promise.resolve({ data: { items: [], totalCount: 0 } })
    }

    if (url === "/categories/api/v1/categories") {
      return Promise.resolve({ data: [] })
    }

    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

describe("TodosPage hidden shared task privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routerMocks.replace.mockReset()
    resetAuth()
    mockInitialRequests()
    vi.mocked(setViewerPreference).mockResolvedValue({
      todoId: hiddenTodo.id,
      hiddenByViewer: false,
      viewerCategoryId: hiddenTodo.categoryId ?? null,
      completedByViewer: null,
      ownerCompleted: false,
    })
    vi.mocked(fetchTaskById).mockResolvedValue(fullTodo)
  })

  it("does not auto-hydrate hidden tasks during initial list load", async () => {
    render(<TodosPage />)

    expect(await screen.findByText("Hidden task")).toBeInTheDocument()
    expect(fetchTaskById).not.toHaveBeenCalled()
  })

  it("requests author names for public friend tasks without direct share rows", async () => {
    const publicFriendTodo: Todo = {
      ...fullTodo,
      id: "todo-public",
      title: "Public friend task",
      sharedWithUserIds: [],
    }
    vi.mocked(api.get).mockImplementation((url: string, config?: any) => {
      if (url === "/todos/api/v1/todos" && config?.params?.isCompleted === false) {
        return Promise.resolve({ data: { items: [publicFriendTodo], totalCount: 1 } })
      }

      if (url === "/todos/api/v1/todos" && config?.params?.isCompleted === true) {
        return Promise.resolve({ data: { items: [], totalCount: 0 } })
      }

      if (url === "/categories/api/v1/categories") {
        return Promise.resolve({ data: [] })
      }

      return Promise.reject(new Error(`unexpected GET ${url}`))
    })

    render(<TodosPage />)

    expect(await screen.findByText("Public friend task")).toBeInTheDocument()
    await waitFor(() => expect(ensureFriendNames).toHaveBeenCalled())
    const [friendIds] = vi.mocked(ensureFriendNames).mock.calls[0]
    expect(Array.from(friendIds as Set<string>)).toContain("owner-1")
  })

  it("hydrates one hidden task only after explicit reveal", async () => {
    render(<TodosPage />)

    fireEvent.click(await screen.findByRole("button", { name: "Reveal" }))

    await waitFor(() => {
      expect(setViewerPreference).toHaveBeenCalledWith(hiddenTodo.id, { hiddenByViewer: false })
      expect(fetchTaskById).toHaveBeenCalledWith(hiddenTodo.id)
      expect(screen.getByText("Shared project plan")).toBeInTheDocument()
    })
  })

  it("keeps a hidden shared task collapsed until reveal hydration completes", async () => {
    let resolveFetch!: (todo: Todo) => void
    vi.mocked(fetchTaskById).mockReturnValue(
      new Promise<Todo>((resolve) => {
        resolveFetch = resolve
      }),
    )

    render(<TodosPage />)

    fireEvent.click(await screen.findByRole("button", { name: "Reveal" }))

    await waitFor(() => {
      expect(setViewerPreference).toHaveBeenCalledWith(hiddenTodo.id, { hiddenByViewer: false })
      expect(fetchTaskById).toHaveBeenCalledWith(hiddenTodo.id)
    })

    expect(screen.getByRole("button", { name: "Reveal" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Hide" })).not.toBeInTheDocument()
    expect(screen.queryByText("Shared project plan")).not.toBeInTheDocument()

    resolveFetch(fullTodo)

    await waitFor(() => {
      expect(screen.getByText("Shared project plan")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument()
    })
  })
})

describe("TodosPage active list paging", () => {
  const task = (id: string, overrides: Partial<Todo> = {}): Todo => ({
    ...fullTodo,
    id,
    userId: "viewer-1",
    title: `Task ${id}`,
    priority: "Low",
    isPublic: false,
    sharedWithUserIds: [],
    tags: [],
    ...overrides,
  })
  const pageOf = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) => task(`t-${from + i}`))

  type ActivePage = { items: Todo[]; totalCount: number; pageSize?: number; hasNextPage?: boolean }
  const serveActivePages = (pages: Record<number, ActivePage>) => {
    vi.mocked(api.get).mockImplementation((url: string, config?: any) => {
      if (url === "/todos/api/v1/todos" && config?.params?.isCompleted === false) {
        const page = pages[config.params.pageNumber as number]
        return Promise.resolve({ data: page ?? { items: [], totalCount: 0 } })
      }
      if (url === "/todos/api/v1/todos" && config?.params?.isCompleted === true) {
        return Promise.resolve({ data: { items: [], totalCount: 0 } })
      }
      if (url === "/categories/api/v1/categories") {
        return Promise.resolve({ data: [] })
      }
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })
  }
  const activeRequests = () =>
    vi.mocked(api.get).mock.calls
      .filter(([url, config]) => url === "/todos/api/v1/todos" && (config as any)?.params?.isCompleted === false)
      .map(([, config]) => (config as any).params as { pageNumber: number; pageSize: number })

  beforeEach(() => {
    vi.clearAllMocks()
    resetAuth()
    // A list this long mounts its cards in windows grown by an IntersectionObserver sentinel,
    // which jsdom does not have. The window itself is not under test here.
    vi.stubGlobal("IntersectionObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return [] }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("reads past the server's 100-row page cap until the last page", async () => {
    serveActivePages({
      1: { items: pageOf(1, 100), totalCount: 150, pageSize: 100, hasNextPage: true },
      2: { items: [...pageOf(101, 49), task("t-last", { title: "Last page urgent task", priority: "Urgent" })], totalCount: 150, pageSize: 100, hasNextPage: false },
    })

    render(<TodosPage />)

    expect(await screen.findByText("Last page urgent task")).toBeInTheDocument()
    expect(activeRequests()).toEqual([
      { pageNumber: 1, pageSize: 100, isCompleted: false },
      { pageNumber: 2, pageSize: 100, isCompleted: false },
    ])
  })

  it("stops at the total when the server sends no page metadata", async () => {
    serveActivePages({
      1: { items: pageOf(1, 100), totalCount: 130 },
      2: { items: [...pageOf(101, 29), task("t-tail", { title: "Tail task", priority: "Urgent" })], totalCount: 130 },
    })

    render(<TodosPage />)

    expect(await screen.findByText("Tail task")).toBeInTheDocument()
    expect(activeRequests().map((params) => params.pageNumber)).toEqual([1, 2])
  })

  it("shows a task once when it shifts across a page boundary while paging", async () => {
    const shifted = task("t-shifted", { title: "Shifted urgent task", priority: "Urgent" })
    serveActivePages({
      1: { items: [...pageOf(1, 99), shifted], totalCount: 120, pageSize: 100, hasNextPage: true },
      2: { items: [shifted, ...pageOf(100, 19)], totalCount: 120, pageSize: 100, hasNextPage: false },
    })

    render(<TodosPage />)

    expect(await screen.findByText("Shifted urgent task")).toBeInTheDocument()
    expect(screen.getAllByTestId("todo-t-shifted")).toHaveLength(1)
  })
})

describe("TodosPage live feed resync", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAuth()
    mockInitialRequests()
    liveFeed.resync = undefined
  })

  it("reads the whole list again when the live feed may have missed changes", async () => {
    render(<TodosPage />)
    expect(await screen.findByText("Hidden task")).toBeInTheDocument()
    const reads = () => vi.mocked(api.get).mock.calls.filter(([url, config]) =>
      url === "/todos/api/v1/todos" && (config as any)?.params?.isCompleted === false).length
    const before = reads()

    liveFeed.resync?.()

    await waitFor(() => expect(reads()).toBe(before + 1))
    expect(vi.mocked(api.get).mock.calls.filter(([url, config]) =>
      url === "/todos/api/v1/todos" && (config as any)?.params?.isCompleted === true).length).toBeGreaterThanOrEqual(2)
  })
})
