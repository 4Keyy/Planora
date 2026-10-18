import { act, fireEvent, render, screen, within } from "@testing-library/react"
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
