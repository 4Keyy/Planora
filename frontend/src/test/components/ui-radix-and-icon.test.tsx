import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { IconPicker } from "@/components/ui/icon-picker"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

describe("dropdown menu primitives", () => {
  it("renders content, inset items, and separators through Radix", async () => {
    const user = userEvent.setup()
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem inset>Profile</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Logout</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )

    await user.click(screen.getByRole("button", { name: "Open menu" }))

    expect(await screen.findByText("Profile")).toHaveClass("pl-8")
    expect(screen.getByRole("separator")).toBeInTheDocument()
    expect(screen.getByText("Logout")).toBeInTheDocument()
  })
})

describe("IconPicker", () => {
  it("renders selected icon label and selects a new icon", async () => {
    const user = userEvent.setup()
    const onIconSelect = vi.fn()
    render(<IconPicker selectedIcon="Home" onIconSelect={onIconSelect} />)

    expect(screen.getByRole("button", { name: /Home/ })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Home/ }))

    await waitFor(() => expect(document.body.querySelectorAll("button").length).toBeGreaterThan(10))
    await user.click(document.body.querySelectorAll("button")[1])

    expect(onIconSelect).toHaveBeenCalledWith("CheckCircle2")
  })

  it("falls back to the generic icon label when no icon is selected", () => {
    render(<IconPicker selectedIcon={null} onIconSelect={vi.fn()} />)

    expect(screen.getByRole("button", { name: /Icon/ })).toBeInTheDocument()
  })
})
