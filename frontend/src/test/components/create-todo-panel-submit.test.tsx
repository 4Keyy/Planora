import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CreateTodoPanel } from "@/components/todos/create-todo-panel"
import type { Category } from "@/types/category"
import type { CreateTodoPayload } from "@/types/todo"

vi.mock("@/hooks/use-friends", () => ({
  useFriends: () => [],
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
  parseApiResponse: (response: unknown) => response,
}))

const categories: Category[] = [{ id: "cat-1", name: "Work", color: "#2563eb", icon: "Briefcase" }]

function renderPanel(onSubmit: (payload: CreateTodoPayload) => Promise<void>) {
  return render(
    <CreateTodoPanel
      isOpen
      onToggle={vi.fn()}
      categories={categories}
      onSubmit={onSubmit}
      onCreateCategory={vi.fn().mockResolvedValue(undefined)}
      onDeleteCategory={vi.fn().mockResolvedValue(undefined)}
    />,
  )
}

const pressCtrlEnter = (repeat = false) =>
  fireEvent.keyDown(window, { key: "Enter", ctrlKey: true, repeat })

describe("CreateTodoPanel submission", () => {
  it("creates one task when Ctrl+Enter is pressed twice before the first create settles", async () => {
    let settle!: () => void
    const onSubmit = vi.fn<(payload: CreateTodoPayload) => Promise<void>>(
      () => new Promise<void>((resolve) => { settle = resolve }),
    )
    renderPanel(onSubmit)

    fireEvent.change(screen.getByPlaceholderText("What needs to be done?"), { target: { value: "Ship the fix" } })
    pressCtrlEnter()
    pressCtrlEnter()

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toEqual(expect.objectContaining({ title: "Ship the fix" }))

    settle()
    await waitFor(() => expect(screen.getByPlaceholderText("What needs to be done?")).toHaveValue(""))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it("ignores the repeats of a held Ctrl+Enter", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderPanel(onSubmit)

    fireEvent.change(screen.getByPlaceholderText("What needs to be done?"), { target: { value: "Held keys" } })
    pressCtrlEnter(true)
    pressCtrlEnter(true)

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("accepts the next task once the previous create has finished", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderPanel(onSubmit)
    const title = screen.getByPlaceholderText("What needs to be done?")

    fireEvent.change(title, { target: { value: "First" } })
    pressCtrlEnter()
    await waitFor(() => expect(title).toHaveValue(""))

    fireEvent.change(title, { target: { value: "Second" } })
    pressCtrlEnter()

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
    expect(onSubmit.mock.calls.map(([payload]) => payload.title)).toEqual(["First", "Second"])
  })

  it("caps the title and the details at the server's limits", () => {
    renderPanel(vi.fn().mockResolvedValue(undefined))

    expect(screen.getByPlaceholderText("What needs to be done?")).toHaveAttribute("maxLength", "200")
    expect(screen.getByPlaceholderText("Add details — optional.")).toHaveAttribute("maxLength", "2000")
  })

  it("lets a failed create be retried", async () => {
    const onSubmit = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(undefined)
    renderPanel(onSubmit)

    fireEvent.change(screen.getByPlaceholderText("What needs to be done?"), { target: { value: "Retry me" } })
    pressCtrlEnter()
    expect(await screen.findByText("Failed to create task. Please try again.")).toBeInTheDocument()

    pressCtrlEnter()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
  })
})
