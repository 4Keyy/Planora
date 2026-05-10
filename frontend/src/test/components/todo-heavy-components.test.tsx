import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import FaultyTerminal from "@/components/faulty-terminal"
import { CreateTodoPanel } from "@/components/todos/create-todo-panel"
import { EditTodoModal } from "@/components/todos/edit-todo-modal"
import { TodoCard } from "@/components/todos/todo-card"
import { api } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import type { FriendDto } from "@/types/auth"
import type { Category } from "@/types/category"
import { TodoPriority, TodoStatus, type Todo } from "@/types/todo"

const oglMocks = vi.hoisted(() => ({
  render: vi.fn(),
  setSize: vi.fn(),
  clearColor: vi.fn(),
  loseContext: vi.fn(),
  constructedPrograms: [] as any[],
}))

vi.mock("ogl", () => {
  class Renderer {
    gl = {
      canvas: document.createElement("canvas"),
      clearColor: oglMocks.clearColor,
      getExtension: vi.fn(() => ({ loseContext: oglMocks.loseContext })),
    }

    constructor(public options: unknown) {}

    setSize(width: number, height: number) {
      oglMocks.setSize(width, height)
      this.gl.canvas.width = width
      this.gl.canvas.height = height
    }

    render(args: unknown) {
      oglMocks.render(args)
    }
  }

  class Program {
    uniforms: any

    constructor(_gl: unknown, options: any) {
      this.uniforms = options.uniforms
      oglMocks.constructedPrograms.push(this)
    }
  }

  class Mesh {
    constructor(public gl: unknown, public options: unknown) {}
  }

  class Color {
    constructor(public r: number, public g: number, public b: number) {}
  }

  class Triangle {
    constructor(public gl: unknown) {}
  }

  return { Renderer, Program, Mesh, Color, Triangle }
})

vi.mock("@/hooks/use-friends", () => ({
  useFriends: () => [
    {
      id: "friend-1",
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      friendsSince: "2026-05-01T00:00:00.000Z",
    },
  ],
}))

vi.mock("@/lib/api", () => ({
  api: {
    post: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
  parseApiResponse: (response: any) => {
    if (response && typeof response === "object" && "value" in response) return response.value
    if (response && typeof response === "object" && "data" in response) return response.data
    return response
  },
}))

const categories: Category[] = [
  { id: "cat-1", name: "Work", color: "#111827", icon: "Briefcase" },
  { id: "cat-2", name: "Home", color: "#2563eb", icon: "Home" },
]

const baseTodo = (overrides: Partial<Todo> = {}): Todo => ({
  id: "todo-1",
  userId: "owner-1",
  title: "Write coverage tests",
  description: "Cover every important branch with focused behavior tests.",
  status: TodoStatus.Pending,
  categoryId: "cat-1",
  categoryName: "Work",
  categoryColor: "#111827",
  categoryIcon: "Briefcase",
  dueDate: "2000-01-01T00:00:00.000Z",
  expectedDate: "2099-01-01T00:00:00.000Z",
  actualDate: null,
  priority: TodoPriority.Urgent,
  isPublic: true,
  isCompleted: false,
  hidden: false,
  completedAt: null,
  isOnTime: null,
  delay: "2d",
  tags: ["coverage"],
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
  authorName: "Owner User",
  sharedWithUserIds: ["friend-1"],
  ...overrides,
})

const resetAuthState = (userId = "owner-1") => {
  useAuthStore.setState({
    user: {
      userId,
      email: `${userId}@example.com`,
      firstName: "Test",
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

class MockResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }

  unobserve() {}

  disconnect() {}
}

describe("TodoCard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAuthState()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("renders owner metadata, completes, collapses, expands, edits, and deletes", async () => {
    const onComplete = vi.fn()
    const onDelete = vi.fn()
    const onEdit = vi.fn()
    const onToggleHidden = vi.fn().mockResolvedValue(undefined)

    const { container, rerender } = render(
      <TodoCard
        todo={baseTodo()}
        onComplete={onComplete}
        onDelete={onDelete}
        onEdit={onEdit}
        onToggleHidden={onToggleHidden}
      />,
    )

    expect(screen.getByText("Write coverage tests")).toBeInTheDocument()
    expect(container).toHaveTextContent("5/5")
    expect(container.querySelector(".lucide-share2")).toBeInTheDocument()
    const sharedUrgentCard = container.querySelector(".task-card--shared-urgent")
    expect(sharedUrgentCard).not.toBeNull()
    expect(sharedUrgentCard).toHaveClass("border-blue-400", "border-l-red-400")
    expect(container.querySelector(".bg-red-400")).toBeNull()
    expect(screen.getByText(/Overdue/i)).toBeInTheDocument()
    expect(screen.getByText(/EXP:/)).toBeInTheDocument()
    expect(screen.getByText("2d delay")).toBeInTheDocument()

    const completeButton = screen.getByRole("button", { name: "Mark as complete" })
    fireEvent.mouseEnter(completeButton)
    fireEvent.mouseLeave(completeButton)
    fireEvent.click(completeButton)
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())

    const collapseButton = screen.getByRole("button", { name: "Collapse task card" })
    fireEvent.mouseDown(collapseButton)
    fireEvent.mouseEnter(collapseButton)
    fireEvent.mouseLeave(collapseButton)
    fireEvent.click(collapseButton)
    expect(onToggleHidden).toHaveBeenCalledOnce()
    expect(screen.getByRole("button", { name: "Expand task card" })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("button", { name: "Expand task card" })).not.toBeDisabled())

    rerender(
      <TodoCard
        todo={baseTodo({ hidden: true })}
        onComplete={onComplete}
        onDelete={onDelete}
        onEdit={onEdit}
        onToggleHidden={onToggleHidden}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Expand task card" }))
    expect(onToggleHidden).toHaveBeenCalledTimes(2)

    rerender(
      <TodoCard
        todo={baseTodo({ hidden: false })}
        onComplete={onComplete}
        onDelete={onDelete}
        onEdit={onEdit}
        onToggleHidden={onToggleHidden}
      />,
    )
    await waitFor(() => expect(screen.getByText("Write coverage tests")).toBeInTheDocument())

    fireEvent.click(screen.getByText("Write coverage tests"))
    expect(onEdit).toHaveBeenCalledOnce()

    const deleteButton = container.querySelector('button[class*="bg-red-500"]')
    expect(deleteButton).not.toBeNull()
    fireEvent.click(deleteButton as HTMLButtonElement)
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it("exercises desktop hover controls and neutral priority styling", async () => {
    const onDelete = vi.fn()
    const onEdit = vi.fn()
    const { container } = render(
      <TodoCard
        todo={baseTodo({
          priority: TodoPriority.Low,
          isPublic: false,
          sharedWithUserIds: [],
          dueDate: "2099-05-01T00:00:00.000Z",
          expectedDate: null,
          delay: null,
          categoryColor: "",
        })}
        onComplete={vi.fn()}
        onDelete={onDelete}
        onEdit={onEdit}
        onToggleHidden={vi.fn()}
      />,
    )

    const cardRoot = container.querySelector(".group\\/card") as HTMLElement
    fireEvent.pointerEnter(cardRoot)
    fireEvent.pointerLeave(cardRoot)
    fireEvent.mouseEnter(cardRoot)
    fireEvent.mouseLeave(cardRoot)

    const desktopDeleteZone = container.querySelector('div[class*="w-[68px]"]') as HTMLElement
    fireEvent.mouseEnter(desktopDeleteZone)
    await waitFor(() =>
      expect(container.querySelector('div[class*="text-white"][class*="cursor-pointer"]')).not.toBeNull(),
    )
    const desktopDeletePanel = container.querySelector('div[class*="text-white"][class*="cursor-pointer"]') as HTMLElement
    fireEvent.click(desktopDeletePanel)
    expect(onDelete).toHaveBeenCalledOnce()
    fireEvent.mouseLeave(desktopDeleteZone)

    fireEvent.click(screen.getByText("Write coverage tests"))
    expect(onEdit).toHaveBeenCalledOnce()
  })

  it("renders completed and shared viewer states without owner-only delete control", async () => {
    resetAuthState("friend-1")
    const onComplete = vi.fn()
    const { container } = render(
      <TodoCard
        todo={baseTodo({
          userId: "owner-1",
          authorName: "Ada Lovelace",
          isCompleted: true,
          status: TodoStatus.Done,
          dueDate: null,
          expectedDate: null,
          delay: null,
        })}
        variant="completed"
        onComplete={onComplete}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />,
    )

    expect(screen.getByRole("button", { name: "Mark as incomplete" })).toBeInTheDocument()
    expect(screen.queryByText(/Priority/)).not.toBeInTheDocument()
    expect(container.querySelector('button[class*="bg-red-500"]')).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Mark as incomplete" }))
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
  })

  it("starts collapsed when the todo is hidden", () => {
    const onToggleHidden = vi.fn()
    const { container } = render(
      <TodoCard
        todo={baseTodo({ hidden: true, categoryName: null, categoryIcon: null })}
        onComplete={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onToggleHidden={onToggleHidden}
      />,
    )

    expect(screen.getByText("Без категории")).toBeInTheDocument()
    expect(screen.getByText("Без категории")).toHaveClass("blur-[3px]")
    expect(container.querySelector(".task-card--shared-urgent")).not.toBeNull()
    expect(screen.queryByText("Write coverage tests")).not.toBeInTheDocument()

    const collapsed = container.querySelector(".group\\/collapsed") as HTMLElement
    fireEvent.pointerEnter(collapsed)
    fireEvent.pointerLeave(collapsed)
    fireEvent.mouseEnter(collapsed)
    fireEvent.mouseLeave(collapsed)
    fireEvent.click(container.querySelector(".group\\/card") as HTMLElement)
    expect(onToggleHidden).toHaveBeenCalledOnce()
  })

  it("keeps hidden refresh visual state from redacted DTO metadata", () => {
    const { container } = render(
      <TodoCard
        todo={baseTodo({
          hidden: true,
          priority: "",
          isPublic: false,
          sharedWithUserIds: [],
          hasSharedAudience: true,
          isVisuallyUrgent: true,
          categoryName: "Focus",
          categoryIcon: null,
        })}
        onComplete={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onToggleHidden={vi.fn()}
      />,
    )

    const card = container.querySelector(".task-card--shared-urgent")
    expect(card).not.toBeNull()
    expect(card).toHaveClass("border-blue-400", "border-l-red-400")
    expect(screen.getByText("Focus")).toHaveClass("blur-[3px]")
  })
})

describe("CreateTodoPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.post).mockReset()
    Element.prototype.hasPointerCapture ??= vi.fn(() => false)
    Element.prototype.setPointerCapture ??= vi.fn()
    Element.prototype.releasePointerCapture ??= vi.fn()
    HTMLElement.prototype.scrollIntoView ??= vi.fn()
  })

  it("renders collapsed state and opens through the primary action", async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()

    render(
      <CreateTodoPanel
        isOpen={false}
        onToggle={onToggle}
        categories={categories}
        onSubmit={vi.fn()}
        onCreateCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
        shortcutHint="C"
      />,
    )

    expect(screen.getByText("New task")).toBeInTheDocument()
    expect(screen.getByText(/press/i)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Open create task panel" }))
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it("validates title, submits normalized payload, and resets form", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const onToggle = vi.fn()

    const { container } = render(
      <CreateTodoPanel
        isOpen
        onToggle={onToggle}
        categories={categories}
        onSubmit={onSubmit}
        onCreateCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
      />,
    )

    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true })
    expect(screen.getByText("Title is required")).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText("What needs to be done?"), {
      target: { value: "  Ship test suite  " },
    })
    fireEvent.change(screen.getByPlaceholderText("Add details, context, or acceptance criteria..."), {
      target: { value: "  Regression coverage  " },
    })
    fireEvent.change(container.querySelector('input[type="date"]') as HTMLInputElement, {
      target: { value: "2026-05-02" },
    })
    fireEvent.click(screen.getByRole("button", { name: /High/ }))
    expect(screen.queryByText("Visible to all friends")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Private task" }))
    await user.click(await screen.findByText("All friends"))

    fireEvent.click(screen.getByRole("button", { name: "Create Task" }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit).toHaveBeenCalledWith({
      userId: null,
      title: "Ship test suite",
      description: "Regression coverage",
      categoryId: null,
      dueDate: new Date("2026-05-02").toISOString(),
      priority: 4,
      isPublic: true,
      sharedWithUserIds: [],
      tags: [],
    })
    expect(screen.getByPlaceholderText("What needs to be done?")).toHaveValue("")
  })

  it("shows task text counters and red warning state near input limits", () => {
    render(
      <CreateTodoPanel
        isOpen
        onToggle={vi.fn()}
        categories={categories}
        onSubmit={vi.fn()}
        onCreateCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
      />,
    )

    expect(screen.getByText("0/200")).toBeInTheDocument()
    expect(screen.getByText("0/5000")).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText("What needs to be done?"), {
      target: { value: "x".repeat(160) },
    })
    fireEvent.change(screen.getByPlaceholderText("Add details, context, or acceptance criteria..."), {
      target: { value: "x".repeat(4000) },
    })

    expect(screen.getByText("160/200")).toHaveClass("text-red-500")
    expect(screen.getByText("4000/5000")).toHaveClass("text-red-500")
  })

  it("closes on Escape while expanded and not creating", async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()

    render(
      <CreateTodoPanel
        isOpen
        onToggle={onToggle}
        categories={categories}
        onSubmit={vi.fn()}
        onCreateCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
      />,
    )

    await user.keyboard("{Escape}")
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it("closes from the expanded morphing action button", async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()

    render(
      <CreateTodoPanel
        isOpen
        onToggle={onToggle}
        categories={categories}
        onSubmit={vi.fn()}
        onCreateCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Close create task panel" }))
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it("returns to the collapsed create action after Escape", async () => {
    const user = userEvent.setup()

    function ControlledPanel() {
      const [open, setOpen] = useState(true)
      return (
        <CreateTodoPanel
          isOpen={open}
          onToggle={() => setOpen(prev => !prev)}
          categories={categories}
          onSubmit={vi.fn()}
          onCreateCategory={vi.fn()}
          onDeleteCategory={vi.fn()}
        />
      )
    }

    render(<ControlledPanel />)

    expect(screen.getByPlaceholderText("What needs to be done?")).toBeInTheDocument()

    await user.keyboard("{Escape}")

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open create task panel" })).toHaveAttribute("aria-expanded", "false")
    })
  })

  it("keeps task creation working when inline category creation fails", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const onCreateCategory = vi.fn()
    vi.mocked(api.post).mockRejectedValue(new Error("category service unavailable"))

    render(
      <CreateTodoPanel
        isOpen
        onToggle={vi.fn()}
        categories={categories}
        onSubmit={onSubmit}
        onCreateCategory={onCreateCategory}
        onDeleteCategory={vi.fn()}
      />,
    )

    await user.click(screen.getByRole("combobox"))
    await user.click(await screen.findByText("+ Create Category"))
    fireEvent.change(screen.getByPlaceholderText("Category name *"), { target: { value: "Inbox" } })
    fireEvent.change(screen.getByPlaceholderText("What needs to be done?"), {
      target: { value: "Fallback category task" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create Task" }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onCreateCategory).not.toHaveBeenCalled()
    expect(onSubmit.mock.calls[0][0].categoryId).toBeNull()
  })

  it("creates a category inline, deletes an existing category option, and submits with the new category", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const onCreateCategory = vi.fn().mockResolvedValue(undefined)
    const onDeleteCategory = vi.fn().mockResolvedValue(undefined)
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        success: true,
        data: { id: "cat-new", name: "Inbox", color: "#123456", icon: null },
      },
    })

    const { container } = render(
      <CreateTodoPanel
        isOpen
        onToggle={vi.fn()}
        categories={categories}
        onSubmit={onSubmit}
        onCreateCategory={onCreateCategory}
        onDeleteCategory={onDeleteCategory}
      />,
    )

    await user.click(screen.getByRole("combobox"))
    const workOption = await screen.findByText("Work")
    const deleteButton = workOption.closest('[role="option"]')?.querySelector("button") as HTMLButtonElement
    fireEvent.click(deleteButton)
    expect(onDeleteCategory).toHaveBeenCalledWith("cat-1")

    await user.click(await screen.findByText("+ Create Category"))
    fireEvent.change(screen.getByPlaceholderText("Category name *"), { target: { value: "Inbox" } })
    fireEvent.change(container.querySelector('input[type="color"]') as HTMLInputElement, {
      target: { value: "#123456" },
    })
    fireEvent.change(screen.getByPlaceholderText("What needs to be done?"), {
      target: { value: "Task with new category" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create Task" }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(api.post).toHaveBeenCalledWith("/categories/api/v1/categories", {
      name: "Inbox",
      color: "#123456",
      icon: null,
      displayOrder: 0,
    })
    expect(onCreateCategory).toHaveBeenCalledOnce()
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      title: "Task with new category",
      categoryId: "cat-new",
    })
  })

  it("shows a create failure message when task submission rejects", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("todo service unavailable"))

    render(
      <CreateTodoPanel
        isOpen
        onToggle={vi.fn()}
        categories={categories}
        onSubmit={onSubmit}
        onCreateCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText("What needs to be done?"), {
      target: { value: "Failing task" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create Task" }))

    expect(await screen.findByText("Failed to create task. Please try again.")).toBeInTheDocument()
  })
})

describe("EditTodoModal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.post).mockReset()
    resetAuthState()
  })

  it("saves owner edits with normalized payload and closes on Escape/backdrop", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()

    render(
      <EditTodoModal
        todo={baseTodo({ priority: "4", dueDate: "2026-05-01T00:00:00.000Z" })}
        categories={categories}
        onClose={onClose}
        onSave={onSave}
        onSaveViewerPreference={vi.fn()}
        onCreateCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText("Task Title"), { target: { value: "Updated task" } })
    fireEvent.change(screen.getByPlaceholderText("Notes or details..."), { target: { value: "Updated notes" } })
    fireEvent.change(screen.getByDisplayValue("2026-05-01"), { target: { value: "2026-05-03" } })

    await user.click(screen.getByRole("button", { name: "Save Changes" }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(onSave).toHaveBeenCalledWith({
      title: "Updated task",
      description: "Updated notes",
      priority: 4,
      dueDate: new Date("2026-05-03").toISOString(),
      categoryId: "cat-1",
      isPublic: true,
      sharedWithUserIds: ["friend-1"],
    })

    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("lets a shared viewer save only their private category preference", async () => {
    resetAuthState("friend-1")
    const onSave = vi.fn()
    const onSaveViewerPreference = vi.fn().mockResolvedValue(undefined)

    render(
      <EditTodoModal
        todo={baseTodo({ isPublic: true, sharedWithUserIds: ["friend-1"] })}
        categories={categories}
        onClose={vi.fn()}
        onSave={onSave}
        onSaveViewerPreference={onSaveViewerPreference}
        onCreateCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
      />,
    )

    expect(screen.getByPlaceholderText("Task Title")).toBeDisabled()
    expect(screen.getByText(/private for you/)).toBeInTheDocument()
    expect(screen.getByText("Sharing is controlled by the task owner.")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Save Category" }))

    await waitFor(() => expect(onSaveViewerPreference).toHaveBeenCalledOnce())
    expect(onSaveViewerPreference).toHaveBeenCalledWith({ viewerCategoryId: "cat-1" })
    expect(onSave).not.toHaveBeenCalled()
  })

  it("blocks non-owner saves when the task is not public", () => {
    resetAuthState("stranger-1")
    render(
      <EditTodoModal
        todo={baseTodo({ isPublic: false, sharedWithUserIds: [] })}
        categories={categories}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onSaveViewerPreference={vi.fn()}
        onCreateCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
      />,
    )

    expect(screen.getByRole("button", { name: "Save Category" })).toBeDisabled()
  })

  it("creates a category inline while saving owner edits", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onCreateCategory = vi.fn().mockResolvedValue(undefined)
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        success: true,
        data: { id: "cat-new", name: "Planning", color: "#654321", icon: null },
      },
    })

    render(
      <EditTodoModal
        todo={baseTodo({
          priority: "Unknown",
          dueDate: null,
          categoryId: null,
          description: "",
          sharedWithUserIds: [],
        })}
        categories={categories}
        onClose={vi.fn()}
        onSave={onSave}
        onSaveViewerPreference={vi.fn()}
        onCreateCategory={onCreateCategory}
        onDeleteCategory={vi.fn()}
      />,
    )

    await user.click(screen.getAllByRole("combobox")[1])
    await user.click(await screen.findByText("+ Create Category"))
    fireEvent.change(screen.getByPlaceholderText("Category Name"), { target: { value: "Planning" } })
    fireEvent.change(document.body.querySelector('input[type="color"]') as HTMLInputElement, {
      target: { value: "#654321" },
    })

    await user.click(screen.getByRole("button", { name: "Save Changes" }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(api.post).toHaveBeenCalledWith("/categories/api/v1/categories", {
      name: "Planning",
      color: "#654321",
      icon: null,
      displayOrder: 0,
    })
    expect(onCreateCategory).toHaveBeenCalledOnce()
    expect(onSave).toHaveBeenCalledWith({
      title: "Write coverage tests",
      description: null,
      priority: 3,
      dueDate: null,
      categoryId: "cat-new",
      isPublic: true,
      sharedWithUserIds: [],
    })
  })
})

describe("FaultyTerminal", () => {
  let rafCallbacks: FrameRequestCallback[]

  beforeEach(() => {
    vi.clearAllMocks()
    oglMocks.constructedPrograms.length = 0
    rafCallbacks = []
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      rafCallbacks.push(callback)
      return rafCallbacks.length
    })
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(vi.fn())
    vi.stubGlobal("ResizeObserver", MockResizeObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("creates and tears down the OGL renderer with mouse animation enabled", () => {
    const { container, unmount } = render(
      <FaultyTerminal
        className="terminal-under-test"
        style={{ width: 320, height: 180 }}
        tint="#abc"
        dither
        mouseReact
      />,
    )

    expect(container.querySelector(".faulty-terminal-container")).toHaveClass("terminal-under-test")
    expect(container.querySelector("canvas")).toBeInTheDocument()
    expect(oglMocks.clearColor).toHaveBeenCalledWith(0, 0, 0, 0)
    expect(oglMocks.setSize).toHaveBeenCalled()

    fireEvent.mouseMove(window, { clientX: 10, clientY: 20 })
    act(() => rafCallbacks[0](1000))

    expect(oglMocks.render).toHaveBeenCalledOnce()
    expect(oglMocks.constructedPrograms[0].uniforms.uDither.value).toBe(1)
    expect(oglMocks.constructedPrograms[0].uniforms.uUseMouse.value).toBe(1)

    unmount()
    expect(window.cancelAnimationFrame).toHaveBeenCalled()
    expect(oglMocks.loseContext).toHaveBeenCalledOnce()
  })

  it("supports paused, non-mouse, non-page-load rendering options", () => {
    render(
      <FaultyTerminal
        pause
        mouseReact={false}
        pageLoadAnimation={false}
        dither={0.5}
        tint="#112233"
      />,
    )

    act(() => rafCallbacks[0](500))

    const uniforms = oglMocks.constructedPrograms[0].uniforms
    expect(uniforms.uUseMouse.value).toBe(0)
    expect(uniforms.uUsePageLoadAnimation.value).toBe(0)
    expect(uniforms.uPageLoadProgress.value).toBe(1)
    expect(uniforms.uDither.value).toBe(0.5)
  })
})
