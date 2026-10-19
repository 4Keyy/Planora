import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"
import { AudienceMap, type AudienceMapProps } from "@/components/todos/audience/audience-map"
import type { FriendAffinity } from "@/lib/audience-map"
import type { FriendDto } from "@/types/auth"

const closeness = vi.hoisted(() => ({ map: new Map<string, FriendAffinity>() }))
vi.mock("@/hooks/use-friend-affinity", () => ({ useFriendAffinity: () => closeness.map }))

const friend = (id: string, firstName: string, lastName = "Friend"): FriendDto => ({
  id, firstName, lastName, email: `${id}@x.test`, friendsSince: "2026-01-01T00:00:00Z",
})
const friends = [friend("ada", "Ada"), friend("ben", "Ben"), friend("zoe", "Zoe")]

/** The editor's audience, held the way the editor holds it, with its All friends rule. */
function Harness(props: Partial<AudienceMapProps> & { start?: { mode: "private" | "friends"; ids: string[]; all?: boolean } }) {
  const { start = { mode: "private", ids: [] }, ...rest } = props
  const [mode, setMode] = useState(start.mode)
  const [ids, setIds] = useState(start.ids)
  const [all, setAll] = useState(start.all ?? false)
  const list = rest.friends ?? friends
  return (
    <>
      <AudienceMap
        friends={list}
        mode={mode}
        sharedIds={ids}
        allFriends={all}
        onModeChange={(m) => {
          setMode(m)
          if (m === "private") setAll(false)
          rest.onModeChange?.(m)
        }}
        onSharedIdsChange={(next) => {
          const covers = !all && list.length > 0 && list.every((f) => next.includes(f.id))
          setAll(covers)
          setIds(covers ? [] : next)
          rest.onSharedIdsChange?.(next)
        }}
        readOnly={rest.readOnly}
        allFriendsIds={rest.allFriendsIds}
        chips={rest.chips}
      />
      <output data-testid="state">{`${mode}|${all ? "all" : ids.join(",")}`}</output>
    </>
  )
}

const chip = (name: string) => screen.getByRole("button", { name: `Share with ${name}` })
const state = () => screen.getByTestId("state").textContent

beforeEach(() => {
  closeness.map = new Map()
})

describe("the audience map", () => {
  it("starts with only you in the ring, and nobody's face on the seats", () => {
    render(<Harness />)
    expect(screen.getByText("Only you can see this.")).toBeInTheDocument()
    for (const name of ["Ada Friend", "Ben Friend", "Zoe Friend"]) expect(chip(name)).toHaveAttribute("aria-pressed", "false")
    // The seats are pointer targets inside the hidden picture; none is in yet.
    expect(screen.getAllByRole("button", { name: /^Add /, hidden: true })).toHaveLength(3)
    expect(screen.queryAllByRole("button", { name: /^Remove /, hidden: true })).toHaveLength(0)
  })

  it("seats the closest friends first, both on the map and in the chips", () => {
    closeness.map = new Map([
      ["zoe", { friendId: "zoe", score: 4, sharedByMe: 3, sharedWithMe: 2 }],
      ["ben", { friendId: "ben", score: 1, sharedByMe: 1, sharedWithMe: 0 }],
    ])
    render(<Harness />)
    const chips = within(screen.getByRole("group", { name: "Share with" })).getAllByRole("button")
    expect(chips.map((c) => c.getAttribute("aria-label"))).toEqual([
      "Share with all friends",
      "Share with Zoe Friend",
      "Share with Ben Friend",
      "Share with Ada Friend",
    ])
  })

  it("lets a friend in from a chip or from their seat, and out again, back to private", () => {
    render(<Harness />)
    fireEvent.click(chip("Ada Friend"))
    expect(state()).toBe("friends|ada")
    expect(screen.getByText("You and Ada can see this.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Remove Ada", hidden: true })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Add Ben", hidden: true }))
    expect(state()).toBe("friends|ada,ben")
    expect(screen.getByText("You, Ada and Ben can see this.")).toBeInTheDocument()

    fireEvent.click(chip("Ada Friend"))
    fireEvent.click(screen.getByRole("button", { name: "Remove Ben", hidden: true }))
    expect(state()).toBe("private|")
    expect(screen.getByText("Only you can see this.")).toBeInTheDocument()
  })

  it("turns into All friends when the last friend is let in, and leaves it shared with the rest when one is let out", () => {
    render(<Harness />)
    for (const name of ["Ada Friend", "Ben Friend", "Zoe Friend"]) fireEvent.click(chip(name))
    expect(state()).toBe("friends|all")
    expect(screen.getByText("All your friends can see this.")).toBeInTheDocument()
    expect(chip("all friends")).toHaveAttribute("aria-pressed", "true")
    expect(chip("Ben Friend")).toHaveAttribute("aria-pressed", "true")

    fireEvent.click(chip("Ben Friend"))
    expect(state()).toBe("friends|ada,zoe")
  })

  it("seats only the frozen circle of an All friends task", () => {
    render(<Harness start={{ mode: "friends", ids: [], all: true }} allFriendsIds={["ada", "gone"]} />)
    expect(chip("Ada Friend")).toHaveAttribute("aria-pressed", "true")
    expect(chip("Ben Friend")).toHaveAttribute("aria-pressed", "false")
  })

  it("takes everyone in with the All friends chip, and back out with it or with Only you", () => {
    render(<Harness />)
    expect(screen.queryByRole("button", { name: "Only you" })).toBeNull()
    fireEvent.click(chip("all friends"))
    expect(state()).toBe("friends|all")
    fireEvent.click(chip("all friends"))
    expect(state()).toBe("private|")

    fireEvent.click(chip("Zoe Friend"))
    fireEvent.click(screen.getByRole("button", { name: "Only you" }))
    expect(state()).toBe("private|")
  })

  it("shows a friend's task as it is and changes nothing", () => {
    const onModeChange = vi.fn()
    render(<Harness readOnly start={{ mode: "friends", ids: ["ada"] }} onModeChange={onModeChange} />)
    expect(screen.getByText("Its owner shared it with 1 person you know.")).toBeInTheDocument()
    expect(chip("Ben Friend")).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Add Ben", hidden: true }))
    expect(onModeChange).not.toHaveBeenCalled()
    expect(state()).toBe("friends|ada")
    expect(screen.getByText("Only the task’s owner can change who sees it.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Only you" })).toBeNull()
  })

  it("speaks for a friend's All friends task and a private one too", () => {
    const { unmount } = render(<Harness readOnly start={{ mode: "friends", ids: [], all: true }} />)
    expect(screen.getByText("Its owner shared it with all their friends.")).toBeInTheDocument()
    unmount()
    render(<Harness readOnly />)
    expect(screen.getByText("Only its owner can see this.")).toBeInTheDocument()
  })

  it("says what to do when there is nobody to share with", () => {
    render(<Harness friends={[]} />)
    expect(screen.getByText(/No friends to share with yet/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "profile" })).toHaveAttribute("href", "/profile#friends")
    expect(screen.queryByRole("group", { name: "Share with" })).toBeNull()
  })
})

describe("the limit of twelve by name", () => {
  const crowd = Array.from({ length: 16 }, (_, i) => friend(`f${String(i).padStart(2, "0")}`, `Name${i}`))
  const twelve = crowd.slice(0, 12).map((f) => f.id)

  it("counts the people chosen by name once there are more friends than seats", () => {
    render(<Harness friends={crowd} start={{ mode: "friends", ids: crowd.slice(0, 3).map((f) => f.id) }} />)
    expect(screen.getByLabelText("3 of 12 friends chosen")).toBeInTheDocument()
  })

  it("locks the rest once twelve are chosen, refuses a thirteenth and says why", () => {
    render(<Harness friends={crowd} start={{ mode: "friends", ids: twelve }} />)
    expect(screen.getByLabelText("12 of 12 friends chosen")).toBeInTheDocument()
    expect(screen.getByText(/the most one task can be shared with by name/)).toBeInTheDocument()
    const locked = chip("Name14 Friend")
    expect(locked).toHaveAttribute("aria-disabled", "true")
    fireEvent.click(locked)
    expect(state()).toBe(`friends|${twelve.join(",")}`)
    // A seat outside the first circle refuses the same way.
    fireEvent.click(screen.getByRole("button", { name: "Add Name15", hidden: true }))
    expect(state()).toBe(`friends|${twelve.join(",")}`)

    // Letting one out frees a seat.
    fireEvent.click(chip("Name0 Friend"))
    expect(chip("Name14 Friend")).not.toHaveAttribute("aria-disabled")
    fireEvent.click(chip("Name14 Friend"))
    expect(state()).toBe(`friends|${[...twelve.slice(1), "f14"].join(",")}`)
  })

  it("refuses letting one out of All friends while more than twelve would stay, and says how", () => {
    render(<Harness friends={crowd} start={{ mode: "friends", ids: [], all: true }} />)
    fireEvent.click(chip("Name3 Friend"))
    expect(state()).toBe("friends|all")
    expect(screen.getByText(/start from Only you/)).toBeInTheDocument()
  })

  it("lets the refusal note go after a while", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    try {
      render(<Harness friends={crowd} start={{ mode: "friends", ids: [], all: true }} />)
      fireEvent.click(chip("Name3 Friend"))
      expect(screen.getByText(/start from Only you/)).toBeInTheDocument()
      act(() => {
        vi.advanceTimersByTime(4000)
      })
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() => expect(screen.queryByText(/start from Only you/)).toBeNull())
  })

  it("shows no counter while every friend fits in the first circle", () => {
    render(<Harness start={{ mode: "friends", ids: ["ada"] }} />)
    expect(screen.queryByLabelText(/friends chosen$/)).toBeNull()
  })
})

describe("the map without chips", () => {
  it("makes the seats the buttons: named, pressed and in the tab order", () => {
    render(<Harness chips={false} />)
    expect(screen.queryByRole("group", { name: "Share with" })).toBeNull()
    const map = screen.getByRole("group", { name: /choose who can see this task/ })
    const ada = within(map).getByRole("button", { name: "Share with Ada Friend" })
    expect(ada).toHaveAttribute("aria-pressed", "false")
    expect(ada).toHaveAttribute("tabindex", "0")
    fireEvent.focus(ada)
    fireEvent.click(ada)
    expect(state()).toBe("friends|ada")
    expect(ada).toHaveAttribute("aria-pressed", "true")
  })

  it("puts All friends and Only you on the map", async () => {
    render(<Harness chips={false} />)
    const all = screen.getByRole("button", { name: "All friends" })
    expect(all).toHaveAttribute("aria-pressed", "false")
    fireEvent.click(all)
    expect(state()).toBe("friends|all")
    expect(screen.getByRole("button", { name: "All friends" })).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(screen.getByRole("button", { name: "Only you" }))
    expect(state()).toBe("private|")
    await waitFor(() => expect(screen.queryByRole("button", { name: "Only you" })).toBeNull())
  })

  it("keeps the counter on the map", () => {
    const crowd = Array.from({ length: 14 }, (_, i) => friend(`c${i}`, `Crowd${i}`))
    render(<Harness chips={false} friends={crowd} start={{ mode: "friends", ids: ["c1", "c2"] }} />)
    expect(screen.getByLabelText("2 of 12 friends chosen")).toBeInTheDocument()
  })
})

describe("the map's view", () => {
  const stage = () => screen.getByRole("button", { name: "Zoom in" }).closest("[data-map-control]")!.parentElement as HTMLElement

  it("takes the wheel from the page while the pointer is over it", () => {
    render(<Harness />)
    const wheel = new WheelEvent("wheel", { deltaY: -120, clientX: 10, clientY: 10, bubbles: true, cancelable: true })
    act(() => {
      stage().dispatchEvent(wheel)
    })
    expect(wheel.defaultPrevented).toBe(true)
    // Trackpad pinches arrive as Ctrl+wheel, line-mode wheels in lines.
    const pinch = new WheelEvent("wheel", { deltaY: 3, deltaMode: 1, ctrlKey: true, bubbles: true, cancelable: true })
    act(() => {
      stage().dispatchEvent(pinch)
    })
    expect(pinch.defaultPrevented).toBe(true)
  })

  it("zooms with its buttons and shows everyone again", () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }))
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }))
    fireEvent.click(screen.getByRole("button", { name: "Show everyone" }))
    expect(screen.getByRole("button", { name: "Show everyone" })).toBeInTheDocument()
  })

  it("moves with a drag, and a drag that ends on a seat does not press it", () => {
    render(<Harness />)
    const el = stage()
    const seat = screen.getByRole("button", { name: "Add Ada", hidden: true })
    fireEvent.pointerDown(seat, { pointerId: 1, clientX: 100, clientY: 100, button: 0, pointerType: "mouse" })
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 140, clientY: 120, pointerType: "mouse" })
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 140, clientY: 120, pointerType: "mouse" })
    fireEvent.click(seat)
    expect(state()).toBe("private|")
    // A press that does not move is a press.
    fireEvent.pointerDown(seat, { pointerId: 2, clientX: 100, clientY: 100, button: 0, pointerType: "mouse" })
    fireEvent.pointerUp(seat, { pointerId: 2, clientX: 101, clientY: 100, pointerType: "mouse" })
    fireEvent.click(seat)
    expect(state()).toBe("friends|ada")
  })

  it("pinches with two fingers, and zooms in on a double click", () => {
    render(<Harness />)
    const el = stage()
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100, pointerType: "touch" })
    fireEvent.pointerDown(el, { pointerId: 2, clientX: 140, clientY: 100, pointerType: "touch" })
    fireEvent.pointerMove(el, { pointerId: 2, clientX: 180, clientY: 100, pointerType: "touch" })
    fireEvent.pointerUp(el, { pointerId: 2, pointerType: "touch" })
    fireEvent.pointerCancel(el, { pointerId: 1, pointerType: "touch" })
    fireEvent.doubleClick(el, { clientX: 20, clientY: 20 })
    // A right press is not a drag.
    fireEvent.pointerDown(el, { pointerId: 3, clientX: 10, clientY: 10, button: 2, pointerType: "mouse" })
    expect(state()).toBe("private|")
  })
})
