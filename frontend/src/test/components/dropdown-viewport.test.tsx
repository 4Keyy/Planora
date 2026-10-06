import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useRef, useState } from "react"
import { Popover } from "@/components/todos/edit-todo-modal/popover"
import { DateFilterPopover } from "@/components/todos/date-filter-popover"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { IconPicker } from "@/components/ui/icon-picker"

const observers = new Set<ViewportObserver>()

class ViewportObserver {
  readonly targets = new Set<Element>()
  constructor(readonly callback: IntersectionObserverCallback) { observers.add(this) }
  observe(target: Element) { this.targets.add(target) }
  unobserve(target: Element) { this.targets.delete(target) }
  disconnect() { this.targets.clear(); observers.delete(this) }
}

function intersection(visible: boolean, ratio = visible ? 0.5 : 0) {
  act(() => {
    for (const observer of observers) {
      const entries = [...observer.targets].map((target) => ({
        target, isIntersecting: visible, intersectionRatio: ratio,
        intersectionRect: { width: visible ? 30 : 0, height: visible ? 10 : 0 },
      } as IntersectionObserverEntry))
      observer.callback(entries, observer as unknown as IntersectionObserver)
    }
  })
}

function Picker({ portal = false }: { portal?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(true)
  return <div ref={ref}>
    <button aria-expanded={open}>Picker</button>
    <Popover open={open} onClose={() => setOpen(false)} containerRef={ref} portal={portal}>Choices</Popover>
  </div>
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", ViewportObserver)
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 100, 40))
})

afterEach(() => {
  observers.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("dropdowns follow their visible trigger", () => {
  it.each([false, true])("closes an %s portal picker through its normal exit when the field leaves view", (portal) => {
    render(<Picker portal={portal} />)
    intersection(true)
    fireEvent.scroll(window)
    expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "open")

    intersection(false)
    expect(screen.getByRole("button", { name: "Picker" })).toHaveAttribute("aria-expanded", "false")
    const surface = screen.getByRole("dialog")
    expect(surface).toHaveAttribute("data-state", "closed")
    fireEvent(surface, new Event("webkitAnimationEnd", { bubbles: true }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("closes even when the trigger merely touches the viewport edge with zero visible area", () => {
    render(<Picker />)
    intersection(true, 0)
    expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "closed")
  })

  it("keeps a portalled picker at its last visible position while it folds away", () => {
    render(<Picker portal />)
    const surface = screen.getByRole("dialog")
    const position = surface.style.top
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(100, -100, 100, 40))
    fireEvent.scroll(window)
    intersection(false)
    expect(surface).toHaveAttribute("data-state", "closed")
    expect(surface.style.top).toBe(position)
  })

  it("closes the completion-date calendar through its normal fold", () => {
    render(<DateFilterPopover start="" end="" onChange={vi.fn()} onClear={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /By date/i }))
    intersection(false)
    expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "closed")
  })

  it.each([false, true])("closes a %s controlled Radix menu through onOpenChange", (controlled) => {
    function Menu() {
      const [open, setOpen] = useState(true)
      return <DropdownMenu modal={false} defaultOpen={!controlled} open={controlled ? open : undefined} onOpenChange={setOpen}>
        <DropdownMenuTrigger>Options</DropdownMenuTrigger>
        <DropdownMenuContent><DropdownMenuItem>Choice</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu>
    }
    render(<Menu />)
    intersection(false)
    expect(screen.getByRole("button", { name: "Options" })).toHaveAttribute("aria-expanded", "false")
  })

  it("closes the Radix icon picker when its field is hidden", () => {
    render(<IconPicker selectedIcon={null} onIconSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Icon" }))
    intersection(false)
    expect(screen.getByRole("button", { name: "Icon" })).toHaveAttribute("aria-expanded", "false")
  })

  it("does not restore Radix focus to a hidden trigger and scroll the page back", async () => {
    render(<DropdownMenu defaultOpen modal={false}>
      <DropdownMenuTrigger>Options</DropdownMenuTrigger>
      <DropdownMenuContent><DropdownMenuItem>Choice</DropdownMenuItem></DropdownMenuContent>
    </DropdownMenu>)
    const trigger = screen.getByRole("button", { name: "Options" })
    const focus = vi.spyOn(trigger, "focus")
    intersection(false)
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
    expect(focus).not.toHaveBeenCalled()
  })

  it("disconnects the visibility observer after unmount", () => {
    const { unmount } = render(<Picker />)
    expect(observers.size).toBe(1)
    unmount()
    expect(observers.size).toBe(0)
  })
})

describe("completion-date calendar stays inside the viewport", () => {
  it("opens above a field near the bottom edge without changing the filter plate", () => {
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(700)
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(600, 620, 140, 40))
    render(<DateFilterPopover start="" end="" onChange={vi.fn()} onClear={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /By date/i }))
    const surface = screen.getByRole("dialog")
    expect(surface.style.position).toBe("fixed")
    expect(surface.style.bottom).toBe("88px")
    expect(surface).toHaveClass("dropdown-above")
    expect(surface.style.maxHeight).toBe("596px")
  })

  it("caps its width and height in a narrow, short viewport", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(280)
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(200)
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(220, 80, 40, 40))
    render(<DateFilterPopover start="" end="" onChange={vi.fn()} onClear={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /By date/i }))
    const surface = screen.getByRole("dialog")
    expect(surface.style.position).toBe("fixed")
    expect(parseFloat(surface.style.left)).toBeGreaterThanOrEqual(16)
    expect(parseFloat(surface.style.left) + parseFloat(surface.style.width)).toBeLessThanOrEqual(264)
    expect(parseFloat(surface.style.maxHeight)).toBeLessThanOrEqual(56)
    expect(surface.style.overflowY).toBe("auto")
  })
})
