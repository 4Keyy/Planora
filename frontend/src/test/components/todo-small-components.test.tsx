import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { CategoryFilterModal } from "@/components/todos/category-filter-modal"
import { FriendMultiSelect } from "@/components/todos/friend-multi-select"
import { TodoSkeleton } from "@/components/todos/todo-skeleton"
import type { FriendDto } from "@/types/auth"
import type { Category } from "@/types/category"

const friend = (id: string, overrides: Partial<FriendDto> = {}): FriendDto => ({
  id,
  email: `${id}@example.com`,
  firstName: "First",
  lastName: "Last",
  friendsSince: "2026-05-01T00:00:00.000Z",
  ...overrides,
})

const category = (id: string, overrides: Partial<Category> = {}): Category => ({
  id,
  name: `Category ${id}`,
  color: "#007BFF",
  icon: "Folder",
  ...overrides,
})

describe("small todo components", () => {
  it("renders a stable todo skeleton", () => {
    const { container } = render(<TodoSkeleton />)

    expect(container.firstElementChild).toHaveClass("animate-pulse")
  })

  it("renders friend multi-select labels for empty, unknown, and selected friends", () => {
    const onChange = vi.fn()
    const friends = [
      friend("friend-1", { firstName: "Ada", lastName: "Lovelace" }),
      friend("friend-2", { firstName: "", lastName: "", email: "grace@example.com" }),
      friend("friend-3", { firstName: "", lastName: "", email: "" }),
    ]

    const { rerender } = render(
      <FriendMultiSelect friends={friends} selectedIds={[]} onChange={onChange} />,
    )

    expect(screen.getByRole("button")).toHaveTextContent("Share with friends")

    rerender(<FriendMultiSelect friends={friends} selectedIds={["missing"]} onChange={onChange} />)
    expect(screen.getByRole("button")).toHaveTextContent("Shared with 1 friend")

    rerender(<FriendMultiSelect friends={friends} selectedIds={["friend-1", "friend-2", "friend-3"]} onChange={onChange} />)
    expect(screen.getByRole("button")).toHaveTextContent("Shared with Ada Lovelace, grace +1")

    rerender(<FriendMultiSelect friends={friends} selectedIds={["friend-1"]} onChange={onChange} publicSelected />)
    expect(screen.getByRole("button")).toHaveTextContent("Shared with all friends")
  })

  it("keeps all-friends visibility inside the friend selector", async () => {
    const user = userEvent.setup()
    const onPublicChange = vi.fn()
    const onChange = vi.fn()

    render(
      <FriendMultiSelect
        friends={[friend("friend-1")]}
        selectedIds={["friend-1"]}
        onChange={onChange}
        publicSelected={false}
        onPublicChange={onPublicChange}
      />,
    )

    await user.click(screen.getByRole("button"))
    await user.click(await screen.findByText("All friends"))

    expect(onPublicChange).toHaveBeenCalledWith(true)
    expect(onChange).toHaveBeenCalledWith([])
  })

  it("switches from all-friends visibility to a direct friend selection", async () => {
    const user = userEvent.setup()
    const onPublicChange = vi.fn()
    const onChange = vi.fn()

    render(
      <FriendMultiSelect
        friends={[friend("friend-1")]}
        selectedIds={[]}
        onChange={onChange}
        publicSelected
        onPublicChange={onPublicChange}
      />,
    )

    await user.click(screen.getByRole("button"))
    await user.click(await screen.findByText("First Last"))

    expect(onPublicChange).toHaveBeenCalledWith(false)
    expect(onChange).toHaveBeenCalledWith(["friend-1"])
  })

  it("does not open friend options when disabled", () => {
    render(
      <FriendMultiSelect
        friends={[friend("friend-1")]}
        selectedIds={[]}
        onChange={vi.fn()}
        disabled
      />,
    )

    expect(screen.getByRole("button")).toBeDisabled()
    expect(screen.queryByText("First Last")).not.toBeInTheDocument()
  })

  it("opens friend options, toggles selected friends, and shows empty state", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { unmount } = render(
      <FriendMultiSelect
        friends={[friend("friend-1"), friend("friend-2", { firstName: "", lastName: "", email: "" })]}
        selectedIds={["friend-1"]}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole("button"))
    await user.click(await screen.findByText("First Last"))
    expect(onChange).toHaveBeenCalledWith([])

    await user.click(screen.getByText("friend-2"))
    expect(onChange).toHaveBeenCalledWith(["friend-1", "friend-2"])

    unmount()
    render(<FriendMultiSelect friends={[]} selectedIds={[]} onChange={onChange} />)
    await user.click(screen.getByRole("button"))
    expect(await screen.findByText("No friends yet.")).toBeInTheDocument()
  })

  it("renders category filter modal, toggles, resets, and closes by Escape", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onChange = vi.fn()
    const categories = [
      category("cat-1", { name: "Work" }),
      category("cat-2", { name: "Home", icon: "MissingIcon" }),
    ]

    render(
      <CategoryFilterModal
        isOpen
        onClose={onClose}
        categories={categories}
        selected={["cat-1"]}
        onChange={onChange}
      />,
    )

    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    expect(screen.getByText("Work")).toBeInTheDocument()
    expect(screen.getByText("Home")).toBeInTheDocument()
    expect(screen.getByText("1 Selected")).toBeInTheDocument()

    await user.click(screen.getByText("Work"))
    expect(onChange).toHaveBeenCalledWith([])

    await user.click(screen.getByText("Home"))
    expect(onChange).toHaveBeenCalledWith(["cat-1", "cat-2"])

    await user.click(screen.getByText("Reset All"))
    expect(onChange).toHaveBeenCalledWith([])

    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("renders category empty state and show-all action", async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <CategoryFilterModal
        isOpen
        onClose={vi.fn()}
        categories={[]}
        selected={[]}
        onChange={onChange}
      />,
    )

    await waitFor(() => expect(screen.getByText("No categories found")).toBeInTheDocument())

    rerender(
      <CategoryFilterModal
        isOpen
        onClose={vi.fn()}
        categories={[category("cat-1", { name: "Work" })]}
        selected={[]}
        onChange={onChange}
      />,
    )

    await userEvent.click(await screen.findByText("Show All Tasks"))
    expect(onChange).toHaveBeenCalledWith([])
  })
})
