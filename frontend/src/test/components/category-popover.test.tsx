import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useRef, useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { CategoryPopover } from "@/components/todos/edit-todo-modal/popovers/category"
import { api } from "@/lib/api"
import type { Category } from "@/types/category"

vi.mock("@/lib/api", () => ({
  api: { post: vi.fn(), get: vi.fn(), interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } },
  parseApiResponse: (response: { data?: unknown }) => response.data,
}))

const categories: Category[] = [
  { id: "c-work", name: "Work", color: "#f59e0b", icon: "Briefcase" },
  { id: "c-travel", name: "Travel", color: "#10b981", icon: "Plane" },
  { id: "c-cafe", name: "Café visits", color: "#0ea5e9", icon: null },
  { id: "c-net", name: "Network", color: null, icon: null },
]

function Harness({
  value = null,
  onChange = vi.fn(),
  onDeleteCategory,
  canEdit = true,
  list = categories,
}: {
  value?: string | null
  onChange?: (id: string | null) => void
  onDeleteCategory?: (id: string) => void
  canEdit?: boolean
  list?: Category[]
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(true)
  const [current, setCurrent] = useState<string | null>(value)
  return (
    <div ref={ref}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Trigger</button>
      <CategoryPopover
        open={open}
        onClose={() => setOpen(false)}
        value={current}
        onChange={(id) => { setCurrent(id); onChange(id) }}
        categories={list}
        onCreateCategory={vi.fn().mockResolvedValue(undefined)}
        onDeleteCategory={onDeleteCategory}
        containerRef={ref}
        canEdit={canEdit}
      />
    </div>
  )
}

const tileNames = () => Array.from(document.querySelectorAll("[data-category-tile]")).map((tile) => tile.textContent)

describe("CategoryPopover", () => {
  it("shows every category as a tile, the chosen one pressed, and No category last", () => {
    render(<Harness value="c-travel" />)
    expect(tileNames()).toEqual(["Work", "Travel", "Café visits", "Network", "No category"])
    expect(screen.getByRole("button", { name: "Travel" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Work" })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("searchbox", { name: "Find a category" })).toHaveAttribute("placeholder", "Find in 4")
  })

  it("picks a tile, or No category, and closes", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness value="c-work" onChange={onChange} />)
    await user.click(screen.getByRole("button", { name: "No category" }))
    expect(onChange).toHaveBeenCalledWith(null)
    expect(screen.getByRole("button", { name: "Trigger" })).toHaveAttribute("aria-expanded", "false")
  })

  it("finds by any part of a name, starts first, ignoring case and accents", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const search = screen.getByRole("searchbox", { name: "Find a category" })
    await user.type(search, "CAFE")
    // A tile leaving a search fades out where it stands before it goes.
    await waitFor(() => expect(tileNames()).toEqual(["Café visits"]))
    // No category is a choice, not a name: it stays out of a search.
    await user.clear(search)
    await user.type(search, "w")
    // "Work" starts with it; "Network" only holds it.
    await waitFor(() => expect(tileNames()).toEqual(["Work", "Network"]))
    expect(document.querySelector("mark")?.textContent).toBe("W")
  })

  it("takes the best match on Enter", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.type(screen.getByRole("searchbox", { name: "Find a category" }), "tra{Enter}")
    expect(onChange).toHaveBeenCalledWith("c-travel")
  })

  it("does nothing on Enter in an empty search", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.click(screen.getByRole("searchbox", { name: "Find a category" }))
    await user.keyboard("{Enter}")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("offers to create a name it cannot find, with the name already in the form", async () => {
    const user = userEvent.setup()
    vi.mocked(api.post).mockResolvedValueOnce({ data: { data: { id: "c-new", name: "Groceries", color: "#0ea5e9", icon: null } } })
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.type(screen.getByRole("searchbox", { name: "Find a category" }), "Groceries")
    expect(screen.getByText("No “Groceries” yet")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Create “Groceries”" }))
    expect(await screen.findByRole("textbox", { name: "Category name" })).toHaveValue("Groceries")
    await user.click(screen.getByRole("button", { name: "Create" }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("c-new"))
    expect(api.post).toHaveBeenCalledWith("/categories/api/v1/categories", { name: "Groceries", color: "#0ea5e9", icon: null, displayOrder: 0 })
  })

  it("opens the prefilled form on Enter when nothing matches, and only says so to a viewer", async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Harness />)
    await user.type(screen.getByRole("searchbox", { name: "Find a category" }), "Zoo{Enter}")
    expect(await screen.findByRole("textbox", { name: "Category name" })).toHaveValue("Zoo")
    unmount()

    render(<Harness canEdit={false} />)
    await user.type(screen.getByRole("searchbox", { name: "Find a category" }), "Zoo{Enter}")
    expect(screen.queryByRole("button", { name: /Create/ })).toBeNull()
    expect(screen.getByText("Try another name.")).toBeInTheDocument()
  })

  it("clears a search on the first Escape and closes on the next", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const search = screen.getByRole("searchbox", { name: "Find a category" })
    await user.type(search, "tr")
    await user.keyboard("{Escape}")
    expect(search).toHaveValue("")
    expect(screen.getByRole("button", { name: "Trigger" })).toHaveAttribute("aria-expanded", "true")
    await user.keyboard("{Escape}")
    expect(screen.getByRole("button", { name: "Trigger" })).toHaveAttribute("aria-expanded", "false")
  })

  it("sends the first typed key to the search from the trigger, and keeps it from the page", () => {
    const pageKey = vi.fn()
    window.addEventListener("keydown", pageKey)
    render(<Harness />)
    screen.getByRole("button", { name: "Trigger" }).focus()
    act(() => { fireEvent.keyDown(screen.getByRole("button", { name: "Trigger" }), { key: "t" }) })
    expect(screen.getByRole("searchbox", { name: "Find a category" })).toHaveFocus()
    expect(pageKey).not.toHaveBeenCalled()
    window.removeEventListener("keydown", pageKey)
  })

  it("walks the grid on the arrows: across by one, down by a row, up from the top to the search", () => {
    render(<Harness />)
    const trigger = screen.getByRole("button", { name: "Trigger" })
    trigger.focus()
    const press = (key: string) => act(() => { fireEvent.keyDown(document.activeElement ?? document.body, { key }) })
    press("ArrowDown")
    expect(screen.getByRole("button", { name: "Work" })).toHaveFocus()
    press("ArrowRight")
    expect(screen.getByRole("button", { name: "Travel" })).toHaveFocus()
    press("ArrowDown")
    expect(screen.getByRole("button", { name: "Network" })).toHaveFocus()
    press("ArrowLeft")
    expect(screen.getByRole("button", { name: "Café visits" })).toHaveFocus()
    press("ArrowDown")
    expect(screen.getByRole("button", { name: "No category" })).toHaveFocus()
    press("ArrowDown")
    expect(screen.getByRole("button", { name: "No category" })).toHaveFocus()
    press("ArrowUp")
    press("ArrowUp")
    press("ArrowUp")
    expect(screen.getByRole("searchbox", { name: "Find a category" })).toHaveFocus()
    press("ArrowDown")
    expect(screen.getByRole("button", { name: "Work" })).toHaveFocus()
  })

  it("deletes from a tile's corner when the panel allows it", async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    render(<Harness onDeleteCategory={onDelete} />)
    await user.click(screen.getByRole("button", { name: "Delete Travel" }))
    expect(onDelete).toHaveBeenCalledWith("c-travel")
  })

  it("says there is nothing yet when there are no categories, and hides the search", () => {
    render(<Harness list={[]} />)
    expect(screen.getByText("No categories yet")).toBeInTheDocument()
    expect(screen.queryByRole("searchbox", { name: "Find a category" })).toBeNull()
    expect(tileNames()).toEqual(["No category"])
  })
})
