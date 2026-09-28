import { describe, expect, it } from "vitest"
import {
  IDLE_SENTENCE,
  INITIAL_VIEWER_STATE,
  ownerStatus,
  sentenceFor,
  signalFor,
  viewerCardDone,
  viewerReducer,
  viewerStatus,
  type ViewerAction,
  type ViewerState,
} from "@/lib/landing-viewer"

const play = (...actions: ViewerAction["type"][]): ViewerState =>
  actions.reduce((s, type) => viewerReducer(s, { type } as ViewerAction), INITIAL_VIEWER_STATE)

describe("the viewer's tick", () => {
  it("is theirs alone: ticking leaves the owner's task open", () => {
    const s = play("viewer-toggle-done")
    expect(viewerCardDone(s)).toBe(true)
    expect(viewerStatus(s)).toBe("Done for you")
    expect(ownerStatus(s)).toBe("Open")
    expect(s.last).toBe("viewer-done")
  })

  it("can be reopened by the viewer while the owner has not finished", () => {
    // The page used to claim the opposite; the product allows this.
    const s = play("viewer-toggle-done", "viewer-toggle-done")
    expect(viewerCardDone(s)).toBe(false)
    expect(s.last).toBe("viewer-reopened")
  })

  it("cannot be reopened once the owner has finished it for everyone", () => {
    const s = play("viewer-toggle-done", "owner-toggle-done", "viewer-toggle-done")
    expect(viewerCardDone(s)).toBe(true)
    expect(s.viewerDone).toBe(true)
    expect(s.last).toBe("viewer-refused")
    expect(viewerStatus(s)).toBe("Done for everyone")
  })
})

describe("the owner finishing it", () => {
  it("closes it for the viewer too", () => {
    const s = play("owner-toggle-done")
    expect(viewerCardDone(s)).toBe(true)
    expect(viewerStatus(s)).toBe("Done for everyone")
    expect(ownerStatus(s)).toBe("Done for everyone")
  })

  it("hands the viewer back their own tick when reopened", () => {
    const open = play("owner-toggle-done", "owner-toggle-done")
    expect(viewerCardDone(open)).toBe(false)
    const ticked = play("viewer-toggle-done", "owner-toggle-done", "owner-toggle-done")
    expect(viewerCardDone(ticked)).toBe(true)
    expect(viewerStatus(ticked)).toBe("Done for you")
  })
})

describe("hiding", () => {
  it("is a viewer-side state the owner never sees", () => {
    const s = play("viewer-toggle-hidden")
    expect(viewerStatus(s)).toBe("Hidden")
    expect(ownerStatus(s)).toBe("Open")
    expect(play("viewer-toggle-hidden", "viewer-toggle-hidden").last).toBe("viewer-shown")
  })

  it("is the owner's own business too, and never reaches the viewer", () => {
    const s = play("owner-toggle-hidden")
    expect(s.ownerHidden).toBe(true)
    expect(viewerStatus(s)).toBe("Open")
    expect(sentenceFor(s.last)).toContain("Yours doesn't change")
    expect(play("owner-toggle-hidden", "owner-toggle-hidden").last).toBe("owner-shown")
  })

  it("gives way to done, because a completed card does not collapse", () => {
    expect(viewerStatus(play("viewer-toggle-hidden", "viewer-toggle-done"))).toBe("Done for you")
  })
})

describe("bookkeeping", () => {
  it("counts every action, so a repeated event replays", () => {
    const s = play("viewer-toggle-done", "viewer-toggle-done", "viewer-toggle-done")
    expect(s.seq).toBe(3)
  })

  it("resets everything but the counter", () => {
    const s = play("viewer-toggle-done", "viewer-toggle-hidden", "owner-toggle-done", "reset")
    expect(s).toMatchObject({ viewerDone: false, viewerHidden: false, ownerDone: false, ownerHidden: false, last: "reset" })
    expect(s.seq).toBe(4)
  })
})

describe("explanations", () => {
  it("explains the owner's delete and a press on a card without changing anything", () => {
    for (const type of ["owner-delete", "open-card"] as const) {
      const before = play("viewer-toggle-done")
      const after = viewerReducer(before, { type })
      expect(after).toMatchObject({ viewerDone: true, viewerHidden: false, ownerDone: false })
      expect(after.seq).toBe(before.seq + 1)
    }
    expect(sentenceFor("owner-delete-note")).toContain("Only Dana can delete it")
    expect(sentenceFor("open-note")).toContain("opens its branch")
  })
})

describe("words and signals", () => {
  it("says something true for every event, and invites a first move at rest", () => {
    expect(sentenceFor(null)).toBe(IDLE_SENTENCE)
    expect(sentenceFor("viewer-done")).toContain("Dana's list is unchanged")
    expect(sentenceFor("viewer-refused")).toContain("only Dana can reopen")
    expect(sentenceFor("viewer-hidden")).toContain("stops sending you its title")
  })

  it("draws a change staying on the viewer's side, and the owner's crossing over", () => {
    expect(signalFor("viewer-done")).toBe("stays-with-viewer")
    expect(signalFor("viewer-reopened")).toBe("stays-with-viewer")
    expect(signalFor("owner-done")).toBe("owner-to-viewer")
    expect(signalFor("owner-reopened")).toBe("owner-to-viewer")
    expect(signalFor("viewer-hidden")).toBeNull()
    expect(signalFor("viewer-refused")).toBeNull()
    expect(signalFor(null)).toBeNull()
  })
})
