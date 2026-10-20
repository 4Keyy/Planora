import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { KEY_ECHO_EVENT } from "@/lib/key-echo"
import {
  handlePriorityKey,
  noteKeyboardAim,
  pointerAimsAtCard,
  priorityDigit,
  registerPriorityTarget,
  resetPriorityKeysForTests,
  type PriorityKeyTarget,
} from "@/lib/priority-keys"

/*
 * jsdom has no layout, so "what is under the pointer" is a table the test writes:
 * `place(x, y, node)` decides what `elementFromPoint` answers at that point.
 */
const surface = new Map<string, Element>()
const place = (x: number, y: number, node: Element | null) => {
  if (node) surface.set(`${x},${y}`, node)
  else surface.delete(`${x},${y}`)
}

let clock = 1_000
const tick = (ms: number) => {
  clock += ms
}

function card(label: string) {
  const node = document.createElement("article")
  node.dataset.card = label
  const inner = document.createElement("span")
  node.appendChild(inner)
  document.body.appendChild(node)
  return { node, inner }
}

function target(accepts = true) {
  const t = {
    accepts: vi.fn<(level: number) => boolean>(() => accepts),
    apply: vi.fn<(level: number) => void>(),
  }
  return t satisfies PriorityKeyTarget
}

/** A pointer that moved, the way a browser reports it: one event on the window. */
function movePointer(x: number, y: number, pointerType = "mouse") {
  tick(16)
  const event = new MouseEvent("pointermove", { clientX: x, clientY: y, bubbles: true })
  Object.defineProperty(event, "pointerType", { value: pointerType })
  window.dispatchEvent(event)
}

function press(key: string, init: KeyboardEventInit = {}, on: EventTarget = document.body): KeyboardEvent {
  tick(16)
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })
  on.dispatchEvent(event)
  return event
}

const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, "elementFromPoint")

beforeEach(() => {
  resetPriorityKeysForTests()
  surface.clear()
  clock = 1_000
  vi.spyOn(performance, "now").mockImplementation(() => clock)
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: (x: number, y: number) => surface.get(`${x},${y}`) ?? null,
  })
})

afterEach(() => {
  resetPriorityKeysForTests()
  document.body.replaceChildren()
  vi.restoreAllMocks()
  if (originalElementFromPoint) Object.defineProperty(document, "elementFromPoint", originalElementFromPoint)
  else Reflect.deleteProperty(document, "elementFromPoint")
})

describe("priorityDigit", () => {
  it("reads the digit a key types", () => {
    for (let n = 0; n <= 9; n++) expect(priorityDigit({ key: String(n), code: `Digit${n}`, shiftKey: false })).toBe(n)
  })

  it("reads the number row of a layout that types symbols there unshifted (AZERTY)", () => {
    expect(priorityDigit({ key: "&", code: "Digit1", shiftKey: false })).toBe(1)
    expect(priorityDigit({ key: "é", code: "Digit2", shiftKey: false })).toBe(2)
  })

  it("treats a shifted number row as the symbol it types", () => {
    expect(priorityDigit({ key: "!", code: "Digit1", shiftKey: true })).toBeNull()
  })

  it("takes the numpad with NumLock on and leaves it alone with NumLock off", () => {
    expect(priorityDigit({ key: "4", code: "Numpad4", shiftKey: false })).toBe(4)
    expect(priorityDigit({ key: "ArrowLeft", code: "Numpad4", shiftKey: false })).toBeNull()
    expect(priorityDigit({ key: "End", code: "Numpad1", shiftKey: false })).toBeNull()
  })

  it("reads nothing into a letter", () => {
    expect(priorityDigit({ key: "j", code: "KeyJ", shiftKey: false })).toBeNull()
  })
})

describe("the card under the pointer", () => {
  it("takes 1 to 5 and claims the key", () => {
    const a = card("a")
    const t = target()
    registerPriorityTarget(a.node, t)
    place(10, 10, a.inner)
    movePointer(10, 10)

    const event = press("3")

    expect(t.apply).toHaveBeenCalledWith(3)
    expect(event.defaultPrevented).toBe(true)
  })

  it("takes the numpad's digits too", () => {
    const a = card("a")
    const t = target()
    registerPriorityTarget(a.node, t)
    place(10, 10, a.node)
    movePointer(10, 10)

    press("5", { code: "Numpad5" })

    expect(t.apply).toHaveBeenCalledWith(5)
  })

  it("does nothing at all for a number above five, or zero", () => {
    const a = card("a")
    const t = target()
    registerPriorityTarget(a.node, t)
    place(10, 10, a.node)
    movePointer(10, 10)

    for (const key of ["6", "7", "8", "9", "0"]) {
      const event = press(key)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(t.accepts).not.toHaveBeenCalled()
    expect(t.apply).not.toHaveBeenCalled()
  })

  it("leaves a card that declines alone, and the key unclaimed", () => {
    const a = card("a")
    const t = target(false)
    registerPriorityTarget(a.node, t)
    place(10, 10, a.node)
    movePointer(10, 10)

    const event = press("2")

    expect(t.accepts).toHaveBeenCalledWith(2)
    expect(t.apply).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it("does nothing when the pointer rests on no card", () => {
    const a = card("a")
    const t = target()
    registerPriorityTarget(a.node, t)
    place(10, 10, document.body)
    movePointer(10, 10)

    press("4")

    expect(t.apply).not.toHaveBeenCalled()
  })

  it("asks what is on top when the key lands, not what was hovered", () => {
    const a = card("a")
    const ta = target()
    registerPriorityTarget(a.node, ta)
    place(10, 10, a.node)
    movePointer(10, 10)
    // A dialog's scrim now covers the card under the still pointer.
    const scrim = document.createElement("div")
    document.body.appendChild(scrim)
    place(10, 10, scrim)

    press("4")

    expect(ta.apply).not.toHaveBeenCalled()
  })

  it("echoes the key for the legends that light up", () => {
    const a = card("a")
    registerPriorityTarget(a.node, target())
    place(10, 10, a.node)
    movePointer(10, 10)
    const heard: string[] = []
    const listen = (event: Event) => heard.push((event as CustomEvent<string>).detail)
    window.addEventListener(KEY_ECHO_EVENT, listen)

    press("1")
    window.removeEventListener(KEY_ECHO_EVENT, listen)

    expect(heard).toEqual(["1–5"])
  })
})

describe("keys that belong to something else", () => {
  function aimed() {
    const a = card("a")
    const t = target()
    registerPriorityTarget(a.node, t)
    place(10, 10, a.node)
    movePointer(10, 10)
    return t
  }

  it("leaves a digit typed into a field to the field", () => {
    const t = aimed()
    const input = document.createElement("input")
    document.body.appendChild(input)

    press("3", {}, input)

    expect(t.apply).not.toHaveBeenCalled()
  })

  it("leaves a digit typed inside a dialog to the dialog", () => {
    const t = aimed()
    const dialog = document.createElement("div")
    dialog.setAttribute("role", "dialog")
    const button = document.createElement("button")
    dialog.appendChild(button)
    document.body.appendChild(dialog)

    press("3", {}, button)

    expect(t.apply).not.toHaveBeenCalled()
  })

  it("leaves modified digits to the browser — Ctrl+1 switches tabs", () => {
    const t = aimed()
    press("1", { ctrlKey: true })
    press("1", { metaKey: true })
    press("1", { altKey: true })
    expect(t.apply).not.toHaveBeenCalled()
  })

  it("ignores a held key's repeats", () => {
    const t = aimed()
    press("2", { repeat: true })
    expect(t.apply).not.toHaveBeenCalled()
  })

  it("stands down for a key another handler already claimed", () => {
    const t = aimed()
    const claim = (event: Event) => event.preventDefault()
    document.body.addEventListener("keydown", claim)

    press("2")
    document.body.removeEventListener("keydown", claim)

    expect(t.apply).not.toHaveBeenCalled()
  })
})

describe("the keyboard cursor and the pointer", () => {
  it("gives the keys to the cursor when it was moved after the pointer", () => {
    const a = card("a")
    const t = target()
    registerPriorityTarget(a.node, t)
    place(10, 10, a.node)
    movePointer(10, 10)
    tick(50)
    noteKeyboardAim()

    expect(pointerAimsAtCard()).toBe(false)
    press("3")
    expect(t.apply).not.toHaveBeenCalled()
  })

  it("gives them back to the pointer once it moves again", () => {
    const a = card("a")
    const t = target()
    registerPriorityTarget(a.node, t)
    place(10, 10, a.node)
    place(11, 10, a.node)
    movePointer(10, 10)
    noteKeyboardAim()
    movePointer(11, 10)

    expect(pointerAimsAtCard()).toBe(true)
    press("3")
    expect(t.apply).toHaveBeenCalledWith(3)
  })

  it("does not count a move that went nowhere — browsers send those after layout changes", () => {
    const a = card("a")
    const t = target()
    registerPriorityTarget(a.node, t)
    place(10, 10, a.node)
    movePointer(10, 10)
    tick(50)
    noteKeyboardAim()
    movePointer(10, 10)

    expect(pointerAimsAtCard()).toBe(false)
  })

  it("reports a pointer resting on a card that declines, so the cursor does not act instead", () => {
    const a = card("a")
    registerPriorityTarget(a.node, target(false))
    place(10, 10, a.node)
    movePointer(10, 10)

    expect(pointerAimsAtCard()).toBe(true)
  })

  it("does not let a finger aim the keys", () => {
    const a = card("a")
    const t = target()
    registerPriorityTarget(a.node, t)
    place(10, 10, a.node)
    movePointer(10, 10, "touch")

    press("3")

    expect(t.apply).not.toHaveBeenCalled()
  })

  it("forgets the pointer once it leaves the window", () => {
    const a = card("a")
    const t = target()
    registerPriorityTarget(a.node, t)
    place(10, 10, a.node)
    movePointer(10, 10)
    const leave = new MouseEvent("pointerleave", { relatedTarget: null })
    document.documentElement.dispatchEvent(leave)

    press("3")

    expect(t.apply).not.toHaveBeenCalled()
  })
})

describe("a card that moved after its key", () => {
  function changedThenSlid() {
    const a = card("a")
    const b = card("b")
    const ta = target()
    const tb = target()
    registerPriorityTarget(a.node, ta)
    registerPriorityTarget(b.node, tb)
    place(10, 10, a.node)
    movePointer(10, 10)
    press("5")
    // The list re-sorted: a glided up, and b now sits under the still pointer.
    place(10, 10, b.node)
    return { ta, tb, b }
  }

  it("keeps the next key for the same card while the pointer is still", () => {
    const { ta, tb } = changedThenSlid()

    press("4")

    expect(ta.apply).toHaveBeenNthCalledWith(2, 4)
    expect(tb.apply).not.toHaveBeenCalled()
  })

  it("lets go as soon as the pointer moves", () => {
    const { ta, tb, b } = changedThenSlid()
    place(30, 10, b.node)
    movePointer(30, 10)

    press("4")

    expect(ta.apply).toHaveBeenCalledTimes(1)
    expect(tb.apply).toHaveBeenCalledWith(4)
  })

  it("lets go after a moment", () => {
    const { ta, tb } = changedThenSlid()
    tick(1_000)

    press("4")

    expect(ta.apply).toHaveBeenCalledTimes(1)
    expect(tb.apply).toHaveBeenCalledWith(4)
  })
})

describe("registration", () => {
  it("stops listening once the last card is gone", () => {
    const a = card("a")
    const t = target()
    const unregister = registerPriorityTarget(a.node, t)
    place(10, 10, a.node)
    movePointer(10, 10)
    unregister()

    const event = new KeyboardEvent("keydown", { key: "3", bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)

    expect(t.apply).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it("answers through handlePriorityKey with whether it acted", () => {
    const a = card("a")
    registerPriorityTarget(a.node, target())
    place(10, 10, a.node)
    movePointer(10, 10)
    const event = new KeyboardEvent("keydown", { key: "2", cancelable: true })
    Object.defineProperty(event, "target", { value: document.body })

    expect(handlePriorityKey(event)).toBe(true)
  })
})
