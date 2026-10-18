import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NewCategoryForm } from "@/components/categories/new-category-form"
import { Popover } from "@/components/todos/edit-todo-modal/popover"

describe("the compact new-category form", () => {
  const renderForm = (onCreate = vi.fn().mockResolvedValue(undefined), onBack = vi.fn()) => {
    render(<NewCategoryForm onCreate={onCreate} onBack={onBack} />)
    return { onCreate, onBack, name: screen.getByRole("textbox", { name: "Category name" }) }
  }

  it("says it makes a new category and focuses itself, not the name", () => {
    const { name } = renderForm()
    expect(screen.getByRole("group", { name: "New category" })).toHaveFocus()
    expect(name).not.toHaveFocus()
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled()
    // Compact: no description and no preview card.
    expect(screen.queryByRole("textbox", { name: "Description" })).toBeNull()
    expect(screen.queryByText("On your categories page")).toBeNull()
  })

  it("sends the first key typed into the name", () => {
    const { name } = renderForm()
    fireEvent.keyDown(screen.getByRole("group", { name: "New category" }), { key: "G" })
    expect(name).toHaveFocus()
  })

  it("creates on Enter with the picked colour and icon", async () => {
    const { onCreate, name } = renderForm()
    fireEvent.click(screen.getByRole("radio", { name: "Colour #10b981" }))
    fireEvent.click(screen.getByRole("radio", { name: "Home icon" }))
    fireEvent.change(name, { target: { value: "  Garden " } })
    fireEvent.keyDown(name, { key: "Enter" })
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ name: "Garden", color: "#10b981", icon: "Home" }))
  })

  it("asks for a name instead of sending an empty one", () => {
    const { onCreate, name } = renderForm()
    fireEvent.keyDown(name, { key: "Enter" })
    expect(screen.getByRole("alert")).toHaveTextContent("Give the category a name first.")
    expect(onCreate).not.toHaveBeenCalled()
  })

  it("keeps the draft and says so when creating fails, then clears the message on typing", async () => {
    const { name } = renderForm(vi.fn().mockRejectedValue(new Error("503")))
    fireEvent.change(name, { target: { value: "Garden" } })
    fireEvent.click(screen.getByRole("button", { name: "Create" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't create the category. Try again.")
    expect(name).toHaveValue("Garden")
    fireEvent.change(name, { target: { value: "Gardens" } })
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
  })

  it("goes back to the list", () => {
    const { onBack } = renderForm()
    fireEvent.click(screen.getByRole("button", { name: "Back to categories" }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe("an in-flow popover near the edge of what clips it", () => {
  const rect = (left: number, width: number) =>
    ({ left, right: left + width, width, top: 0, bottom: 40, height: 40, x: left, y: 0, toJSON: () => ({}) }) as DOMRect

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("is narrowed to the clipping box and slid back inside it", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.dataset.box !== undefined) return rect(16, 348)
      if (this.style.position === "absolute") return rect(200, 344)
      return rect(0, 0)
    })
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.dataset.box !== undefined ? 348 : 390
    })
    render(
      <div data-box="" style={{ overflowX: "hidden" }}>
        <div style={{ position: "relative" }}>
          <Popover open onClose={vi.fn()} width={344}>
            Choices
          </Popover>
        </div>
      </div>,
    )
    const surface = screen.getByRole("dialog")
    const wrapper = surface.parentElement as HTMLElement
    // 348 wide less 8px each side.
    expect(surface.style.width).toBe("332px")
    // From x=200, 332 wide would end at 532; the box ends at 364 less 8.
    expect(wrapper.style.translate).toBe("-176px 0")
  })
})
