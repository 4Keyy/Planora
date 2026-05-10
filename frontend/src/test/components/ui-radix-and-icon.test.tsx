import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { IconPicker } from "@/components/ui/icon-picker"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

describe("dialog primitives", () => {
  it("renders an open dialog with title, description, content, and close affordance", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>Configure your workspace</DialogDescription>
          </DialogHeader>
          <DialogFooter>Actions</DialogFooter>
        </DialogContent>
      </Dialog>,
    )

    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument()
    expect(screen.getByText("Configure your workspace")).toBeInTheDocument()
    expect(screen.getByText("Actions")).toBeInTheDocument()
    expect(screen.getByText("Close")).toHaveClass("sr-only")
  })
})

describe("select primitives", () => {
  it("renders the trigger and selected value through Radix context", () => {
    render(
      <Select value="High">
        <SelectTrigger aria-label="priority">
          <SelectValue placeholder="Priority" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Priority</SelectLabel>
            <SelectItem value="Low">Low</SelectItem>
            <SelectSeparator />
            <SelectItem value="High">High</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>,
    )

    expect(screen.getByRole("combobox", { name: "priority" })).toHaveTextContent("High")
  })
})

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
