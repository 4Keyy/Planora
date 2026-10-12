import { echoKey } from "@/lib/key-echo"
import { isTextEntry } from "@/lib/text-entry"

/**
 * Number keys set a task's priority: `1` to `5`, on the card under the pointer.
 *
 * ## Why the pointer
 *
 * The task list already gave `1`–`5` to the card under its keyboard cursor, and only
 * there. Someone with a mouse — most people — had to Tab into the list and walk the
 * cursor to a card before a number meant anything, and on the dashboard it meant
 * nothing at all. Pointing at a card is the cheaper way to say "this one", so every
 * task card answers the keys while the pointer rests on it, wherever cards are shown.
 *
 * ## One target, never two
 *
 * A pointer can rest on one card while the keyboard cursor sits on another. A number
 * must change exactly one of them: the one aimed with last. The pointer counts as aimed
 * when it moves, wheels or presses; the cursor when the list moves or shows it
 * (`noteKeyboardAim`). Both readers ask the same question — the list hook asks
 * `pointerAimsAtCard()` before acting on its cursor, this module asks it before acting on
 * the pointer — so which window listener happens to run first decides nothing.
 *
 * ## What "under the pointer" means
 *
 * It is read when the key lands, with `elementFromPoint` at the last pointer position,
 * and never remembered from a `pointerenter`. Cards re-sort and glide under a still
 * pointer, the page scrolls under it, and a dialog or a popover may cover the card by
 * now: whatever is on top at that point is the target, and a card under a dialog is not.
 *
 * A new priority can move the card away — lists sort by it. A second number pressed
 * straight after, with the pointer still, goes to the same card for a moment
 * (`HOLD_MS`), not to whichever card slid under the pointer: correcting a 5 that should
 * have been a 4 must not re-prioritise a neighbour.
 *
 * Six to nine and zero do nothing, and are left alone for whatever else wants them.
 */

export const MIN_PRIORITY = 1
export const MAX_PRIORITY = 5

/** How long a just-changed card keeps the keys while the pointer has not moved. */
const HOLD_MS = 800
/** Pointer travel that ends that hold: a hand on the mouse, not sensor noise. */
const MOVE_SLOP_PX = 4

export interface PriorityKeyTarget {
  /** Whether the card takes this level now. Asked when the key lands, never cached. */
  accepts: (level: number) => boolean
  apply: (level: number) => void
}

interface Hit {
  node: Element
  target: PriorityKeyTarget
}

const targets = new Map<Element, PriorityKeyTarget>()
const aim = {
  x: Number.NaN,
  y: Number.NaN,
  /** When the pointer last moved, wheeled or pressed. */
  pointerAt: 0,
  /** When the keyboard cursor last moved or was shown. */
  keyboardAt: 0,
}
let held: (Hit & { x: number; y: number; at: number }) | null = null
let detach: (() => void) | null = null

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now())

/**
 * The digit a key stands for, or null.
 *
 * `key` first, which covers the number row and a numpad with NumLock on in every layout
 * that types digits. A number row that types symbols unshifted (AZERTY's `&`, `é`, `"`)
 * still carries the digit on the physical key, so `code` decides there — the way the
 * palette reads `K` on a Cyrillic layout. Shifted, that key is a symbol (`Shift+1` is
 * `!`), and a numpad key that does not type its digit has NumLock off: it is an arrow,
 * Home or End, and taking it would steal the list's navigation.
 */
export function priorityDigit(event: Pick<KeyboardEvent, "key" | "code" | "shiftKey">): number | null {
  if (/^[0-9]$/.test(event.key)) return Number(event.key)
  const row = /^Digit([0-9])$/.exec(event.code ?? "")
  if (row && !event.shiftKey) return Number(row[1])
  return null
}

/** A key typed inside a dialog belongs to the dialog, whatever lies under the pointer. */
function insideDialog(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[role='dialog'], [role='alertdialog'], [aria-modal='true']") !== null
}

function cardAt(x: number, y: number): Hit | null {
  if (typeof document === "undefined" || typeof document.elementFromPoint !== "function") return null
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  for (let node = document.elementFromPoint(x, y); node; node = node.parentElement) {
    const target = targets.get(node)
    if (target) return { node, target }
  }
  return null
}

/** The card under a pointer that was aimed more recently than the keyboard cursor. */
function pointedCard(): Hit | null {
  if (aim.keyboardAt > 0 && aim.keyboardAt >= aim.pointerAt) return null
  return cardAt(aim.x, aim.y)
}

function resolveTarget(): Hit | null {
  if (held) {
    const stale =
      now() - held.at > HOLD_MS ||
      Math.hypot(aim.x - held.x, aim.y - held.y) > MOVE_SLOP_PX ||
      aim.keyboardAt > held.at ||
      !held.node.isConnected ||
      targets.get(held.node) !== held.target
    if (!stale) return held
    held = null
  }
  return pointedCard()
}

/**
 * Whether the pointer, aimed after the keyboard cursor, rests on a task card — any card,
 * one that takes the key or one that does not. The list asks before acting on its cursor:
 * pointing at a friend's task and pressing 3 must change nothing, not the card the cursor
 * happened to be left on.
 */
export function pointerAimsAtCard(): boolean {
  return resolveTarget() !== null
}

/** The list moved or showed its cursor: the keyboard is now the thing aimed with last. */
export function noteKeyboardAim(): void {
  aim.keyboardAt = now()
}

/**
 * The window's handler. Exported for the tests; on a page it is attached once, while at
 * least one card is registered, in the bubble phase, so a widget that claims a number key
 * with `stopPropagation()` or `preventDefault()` keeps it.
 */
export function handlePriorityKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.repeat || event.isComposing) return false
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  const level = priorityDigit(event)
  if (level === null || level < MIN_PRIORITY || level > MAX_PRIORITY) return false
  if (isTextEntry(event.target) || insideDialog(event.target)) return false
  const hit = resolveTarget()
  if (!hit || !hit.target.accepts(level)) return false
  event.preventDefault()
  hit.target.apply(level)
  held = { ...hit, x: aim.x, y: aim.y, at: now() }
  echoKey("1–5")
  return true
}

function attach(): () => void {
  const onPointer = (event: PointerEvent) => {
    // A finger has no hover: a tap must not leave the keys aimed at what it touched.
    if (event.pointerType === "touch") return
    // Browsers send a move with no travel after layout changes; only real travel aims.
    if (event.type === "pointermove" && event.clientX === aim.x && event.clientY === aim.y) return
    aim.x = event.clientX
    aim.y = event.clientY
    aim.pointerAt = now()
  }
  const onWheel = (event: WheelEvent) => {
    aim.x = event.clientX
    aim.y = event.clientY
    aim.pointerAt = now()
  }
  // Out of the window, the pointer is over nothing of ours: the card at the edge it left
  // across must not take a key pressed while the mouse rests on the taskbar.
  const onLeave = (event: PointerEvent) => {
    if (event.relatedTarget !== null) return
    aim.x = Number.NaN
    aim.y = Number.NaN
  }
  const onKey = (event: KeyboardEvent) => {
    handlePriorityKey(event)
  }
  const passive = { capture: true, passive: true } as const
  window.addEventListener("pointermove", onPointer, passive)
  window.addEventListener("pointerdown", onPointer, passive)
  window.addEventListener("wheel", onWheel, passive)
  document.documentElement.addEventListener("pointerleave", onLeave)
  window.addEventListener("keydown", onKey)
  return () => {
    window.removeEventListener("pointermove", onPointer, passive)
    window.removeEventListener("pointerdown", onPointer, passive)
    window.removeEventListener("wheel", onWheel, passive)
    document.documentElement.removeEventListener("pointerleave", onLeave)
    window.removeEventListener("keydown", onKey)
  }
}

/**
 * Lets a card take number keys while the pointer rests on it. Returns the unregister.
 * The window listeners exist only while some card is registered.
 */
export function registerPriorityTarget(node: Element, target: PriorityKeyTarget): () => void {
  targets.set(node, target)
  if (!detach && typeof window !== "undefined") detach = attach()
  return () => {
    if (targets.get(node) === target) targets.delete(node)
    if (held?.node === node) held = null
    if (targets.size === 0 && detach) {
      detach()
      detach = null
    }
  }
}

/** Test seam: forget every target, every aim and the hold. */
export function resetPriorityKeysForTests(): void {
  targets.clear()
  held = null
  aim.x = Number.NaN
  aim.y = Number.NaN
  aim.pointerAt = 0
  aim.keyboardAt = 0
  detach?.()
  detach = null
}
