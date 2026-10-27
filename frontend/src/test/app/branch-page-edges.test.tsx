import { act, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import BranchPage from "@/app/(app)/branch/[id]/page"
import { api, fetchTaskById } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { TodoPriority, TodoStatus, type Todo } from "@/types/todo"

// The edges of `/branch/{id}` that `branch-page.test.tsx` leaves alone: an address without a task
// id, and the description the editor writes back into the page's copy of the task as it is typed.
const route = vi.hoisted(() => ({ params: { id: "t-1" } as { id?: string } }))
vi.mock("next/navigation", () => ({
  useParams: () => route.params,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/branch/t-1",
}))

type EditorProps = { todo: Todo; onDescriptionChange: (description: string) => void }
const editor = vi.hoisted(() => ({ props: undefined as EditorProps | undefined }))
vi.mock("@/components/todos/edit-todo-modal", () => ({
  TodoEditor: (props: EditorProps) => {
    editor.props = props
    return <section aria-label={`Editing ${props.todo.title}`}>{props.todo.description}</section>
  },
}))

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn() },
  parseApiResponse: (data: unknown) => data,
  fetchTaskById: vi.fn(),
}))

const task: Todo = {
  id: "t-1",
  userId: "user-me",
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
}

beforeEach(() => {
  route.params = { id: "t-1" }
  editor.props = undefined
  useAuthStore.setState({ user: { userId: "user-me", email: "me@example.com", firstName: "Grace", lastName: "Hopper" } })
  vi.mocked(fetchTaskById).mockReset().mockResolvedValue(task)
  vi.mocked(api.get).mockReset().mockResolvedValue({ data: [] })
})

describe("Branch page edges", () => {
  it("asks for no task when the address names none", async () => {
    route.params = {}
    render(<BranchPage />)

    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/categories/api/v1/categories"))
    expect(fetchTaskById).not.toHaveBeenCalled()
    expect(screen.queryByRole("region", { name: /^Editing / })).not.toBeInTheDocument()
  })

  it("keeps the description the editor writes as it is typed", async () => {
    render(<BranchPage />)
    await screen.findByRole("region", { name: "Editing Plan the offsite" })

    act(() => editor.props!.onDescriptionChange("Book the venue first"))

    expect(screen.getByRole("region", { name: "Editing Plan the offsite" })).toHaveTextContent("Book the venue first")
  })
})
