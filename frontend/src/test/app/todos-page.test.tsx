import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import TodosPage from "@/app/todos/page"
import { api, fetchTaskById, setViewerPreference } from "@/lib/api"
import { ensureFriendNames } from "@/lib/friend-names"
import { TASK_CREATED_EVENT } from "@/lib/events"
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

  it("re-fetches active todos when TASK_CREATED_EVENT fires from the navbar", async () => {
    const newTodo: Todo = { ...fullTodo, id: "todo-new", title: "Navbar created task", userId: "viewer-1" }

    vi.mocked(api.get).mockImplementation((url: string, config?: any) => {
      if (url === "/todos/api/v1/todos" && config?.params?.isCompleted === false) {
        // Second call returns the new task
        if (vi.mocked(api.get).mock.calls.filter(c => c[0] === url && !c[1]?.params?.isCompleted).length > 1) {
          return Promise.resolve({ data: { items: [hiddenTodo, newTodo], totalCount: 2 } })
        }
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

    render(<TodosPage />)
    await screen.findByText("Hidden task")

    window.dispatchEvent(new CustomEvent(TASK_CREATED_EVENT))

    await waitFor(() => expect(screen.getByText("Navbar created task")).toBeInTheDocument())
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
