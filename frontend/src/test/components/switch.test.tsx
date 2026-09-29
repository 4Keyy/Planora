import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { Switch } from "@/components/ui/switch"

describe("Switch", () => {
  it("is a switch named by its own words, with its state", () => {
    render(
      <Switch checked={false} onCheckedChange={vi.fn()}>
        Share with all friends
      </Switch>
    )
    const control = screen.getByRole("switch", { name: "Share with all friends" })
    expect(control).toHaveAttribute("aria-checked", "false")
  })

  it("asks for the opposite of its state when pressed or activated from the keyboard", async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    const { rerender } = render(
      <Switch checked={false} onCheckedChange={onCheckedChange}>
        Greyscale
      </Switch>
    )
    await user.click(screen.getByRole("switch"))
    expect(onCheckedChange).toHaveBeenLastCalledWith(true)

    rerender(
      <Switch checked onCheckedChange={onCheckedChange}>
        Greyscale
      </Switch>
    )
    screen.getByRole("switch").focus()
    await user.keyboard(" ")
    expect(onCheckedChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true")
  })
})
