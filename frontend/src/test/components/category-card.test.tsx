import { createRef } from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CategoryCard } from "@/components/categories/category-card"
import { forgetOrigin, takeOrigin } from "@/lib/shared-origin"
import type { Category } from "@/types/category"

const category: Category = {
  id: "category-1",
  name: "Work",
  description: "Projects and meetings",
  color: "#0EA5E9",
  icon: "Briefcase",
}

function renderCard(overrides: Partial<Category> = {}) {
  const onEdit = vi.fn()
  const onDelete = vi.fn()
  const result = render(<CategoryCard category={{ ...category, ...overrides }} onEdit={onEdit} onDelete={onDelete} />)
  const [desktopDelete, mobileDelete] = screen.getAllByRole("button", { name: "Delete category Work" })
  return { ...result, onEdit, onDelete, desktopDelete, mobileDelete }
}

describe("CategoryCard", () => {
  beforeEach(() => forgetOrigin())

  it.each(["pointer", "keyboard"])("records the whole card before opening its editor by %s", async (activation) => {
    const onEdit = vi.fn(() => takeOrigin())
    const { container } = render(<CategoryCard category={category} onEdit={onEdit} onDelete={vi.fn()} />)
    const surface = container.querySelector<HTMLElement>("[data-category-card]")!
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(new DOMRect(24, 160, 320, 90))
    const editButton = screen.getByRole("button", { name: "Edit category Work" })

    if (activation === "keyboard") {
      editButton.focus()
      await userEvent.keyboard("{Enter}")
    } else {
      await userEvent.click(editButton)
    }

    expect(onEdit).toHaveReturnedWith({ top: 160, left: 24, width: 320, height: 90 })
    expect(takeOrigin()).toBeNull()
  })

  it("renders the category name, description and chosen icon", () => {
    const { container } = renderCard()
    expect(screen.getByText("Work")).toBeInTheDocument()
    expect(screen.getByText("Projects and meetings")).toBeInTheDocument()
    const editButton = screen.getByRole("button", { name: "Edit category Work" })
    expect(editButton.querySelector(".lucide-briefcase")).toHaveStyle({ color: "#0EA5E9" })
    expect(container.querySelector("[aria-hidden] .h-28")).toBeInTheDocument()
  })

  it.each([undefined, null, "", "   "])("shows No description for %s", (description) => {
    renderCard({ description })
    expect(screen.getByText("No description")).toBeInTheDocument()
  })

  it("opens editing from the card's button", async () => {
    const { onEdit, onDelete } = renderCard()
    await userEvent.click(screen.getByRole("button", { name: "Edit category Work" }))
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onDelete).not.toHaveBeenCalled()
  })

  it("opens editing from the card surface outside its inner button", async () => {
    const { container, onEdit, onDelete } = renderCard()
    await userEvent.click(container.querySelector("[data-category-card]")!)
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onDelete).not.toHaveBeenCalled()
  })

  it.each(["{Enter}", " "])("deletes from the desktop control using Tab and %s", async (key) => {
    const user = userEvent.setup()
    const { desktopDelete, onEdit, onDelete } = renderCard()
    await user.tab()
    expect(desktopDelete).toHaveFocus()
    await user.keyboard(key)
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onEdit).not.toHaveBeenCalled()
  })

  it("deletes from the desktop panel with a pointer", async () => {
    const { desktopDelete, onEdit, onDelete } = renderCard()
    await userEvent.click(desktopDelete)
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onEdit).not.toHaveBeenCalled()
  })

  it("deletes from the neutral mobile control with a 44px touch target", async () => {
    const { mobileDelete, onEdit, onDelete } = renderCard()
    expect(mobileDelete).toHaveClass("h-11", "w-11", "text-ink-muted", "md:hidden")
    await userEvent.click(mobileDelete)
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onEdit).not.toHaveBeenCalled()
  })

  it("passes the category colour to the CSS hover glow", () => {
    const { container } = renderCard()
    const surface = container.querySelector<HTMLElement>("[data-category-card]")
    expect(surface?.style.getPropertyValue("--card-glow")).toBe("color-mix(in srgb, #0EA5E9 20%, transparent)")
  })

  it.each([undefined, null, "", "   "])("uses the accent for a missing colour (%s)", (color) => {
    const { container } = renderCard({ color })
    const surface = container.querySelector<HTMLElement>("[data-category-card]")
    expect(surface?.style.getPropertyValue("--card-glow")).toBe("color-mix(in srgb, var(--pl-accent) 20%, transparent)")
  })

  it.each([undefined, null, "", "not-an-icon"])("falls back to Folder for %s", (icon) => {
    const { container } = renderCard({ icon })
    expect(container.querySelector(".lucide-folder")).toBeInTheDocument()
  })

  it("forwards the popLayout ref to the unclipped motion wrapper", () => {
    const ref = createRef<HTMLDivElement>()
    const { container } = render(<CategoryCard ref={ref} category={category} onEdit={vi.fn()} onDelete={vi.fn()} />)
    expect(ref.current).toBe(container.firstElementChild)
    expect(ref.current).toHaveAttribute("tabindex", "-1")
    // Keep motion separate from the clipped shadow surface, matching task cards.
    expect(ref.current).not.toHaveClass("overflow-hidden")
    expect(ref.current).not.toHaveClass("shadow-sm")
    const surface = ref.current?.querySelector("[data-category-card]")
    expect(surface).toHaveClass("overflow-hidden", "rounded-lg", "shadow-sm")
  })

  it("reveals the desktop gradient on hover and removes it after leaving", async () => {
    const { desktopDelete } = renderCard()
    expect(desktopDelete.querySelector(".bg-gradient-to-r")).toBeNull()
    fireEvent.mouseEnter(desktopDelete)
    expect(desktopDelete.querySelector(".bg-gradient-to-r")).toBeInTheDocument()
    fireEvent.mouseLeave(desktopDelete)
    await waitFor(() => expect(desktopDelete.querySelector(".bg-gradient-to-r")).toBeNull())
  })

  it("keeps the desktop panel visible while it has keyboard focus", async () => {
    const user = userEvent.setup()
    const { desktopDelete } = renderCard()
    await user.tab()
    expect(desktopDelete.querySelector(".bg-gradient-to-r")).toBeInTheDocument()
    fireEvent.mouseEnter(desktopDelete)
    fireEvent.mouseLeave(desktopDelete)
    expect(desktopDelete.querySelector(".bg-gradient-to-r")).toBeInTheDocument()
    await user.tab()
    await waitFor(() => expect(desktopDelete.querySelector(".bg-gradient-to-r")).toBeNull())
  })
})
