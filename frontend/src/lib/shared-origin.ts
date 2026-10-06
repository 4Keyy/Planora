/**
 * The card-to-branch shared element.
 *
 * Opening a task is the one navigation in the product that carries a claim: *this
 * card is that screen*. A dialog that fades in from the centre of the viewport
 * says the opposite — that a new, unrelated thing appeared — so the reader has to
 * re-find their place in the list when it closes. Growing the editor out of the
 * exact card that was pressed removes that re-orientation entirely.
 *
 * Two implementations were possible:
 *
 *   1. framer-motion `layoutId` on the card surface and the dialog surface. This
 *      is the documented shared-element technique, but it makes every card in the
 *      list a layout-animated node. The tasks list renders up to 200 memoised
 *      `TodoCard`s inside a masonry; giving each one a projection node costs a
 *      measure on every list change — filtering, completing, the undo window
 *      closing — for an effect that is used on one card at a time.
 *   2. Record the pressed card's rect once, on the press, and let the dialog
 *      animate from it. One `getBoundingClientRect()` per open, nothing attached
 *      to the list at rest.
 *
 * This module is (2). It is deliberately a module-level slot rather than context:
 * `TodoCard` is `memo`'d specifically so that list churn does not re-render every
 * card, and threading a setter through its props would defeat that.
 *
 * The slot is *consumed* — `takeOrigin()` clears it — so a dialog opened by any
 * other route (the command palette, a notification, a deep link) finds nothing
 * and falls back to the plain entrance instead of flying out of whatever card
 * happened to be pressed last.
 */

export interface OriginRect {
  top: number
  left: number
  width: number
  height: number
}

/** How a surface must start in order to appear to grow out of {@link OriginRect}. */
export interface OriginTransform {
  x: number
  y: number
  scale: number
}

/**
 * A recorded origin goes stale quickly. The dialog is code-split
 * (`next/dynamic`), so on a cold open the chunk has to arrive before it can read
 * the slot; anything beyond a second means the user did something else in
 * between and the rect no longer describes anything on screen.
 */
const MAX_AGE_MS = 1000

let slot: { rect: OriginRect; at: number } | null = null

/** Records the element the user pressed. Call it in the click handler, not later. */
export function rememberOrigin(element: HTMLElement | null | undefined): void {
  if (!element) {
    slot = null
    return
  }
  const r = element.getBoundingClientRect()
  // A zero-area rect means the element is display:none or detached — animating
  // from it would scale the dialog to nothing and flash.
  if (r.width <= 0 || r.height <= 0) {
    slot = null
    return
  }
  slot = {
    rect: { top: r.top, left: r.left, width: r.width, height: r.height },
    at: typeof performance !== "undefined" ? performance.now() : 0,
  }
}

/** Reads and clears the slot. Returns null when nothing was recorded, or it is stale. */
export function takeOrigin(): OriginRect | null {
  const held = slot
  slot = null
  if (!held) return null
  const now = typeof performance !== "undefined" ? performance.now() : 0
  if (now - held.at > MAX_AGE_MS) return null
  return held.rect
}

/** Drops anything recorded. Used when a press turns out not to open the editor. */
export function forgetOrigin(): void {
  slot = null
}

/**
 * The transform that makes `target` look like it started life as `origin`.
 *
 * The scale is **uniform**, taken from the width ratio. Scaling x and y
 * independently would match the card's rectangle exactly but shear every glyph
 * inside the dialog on the way — text stretched vertically for 220ms reads as a
 * rendering fault, not as motion. A uniform scale plus the opacity ramp lands the
 * same "it came from there" reading without distorting a single character.
 *
 * It is also clamped. A card 1/12th the width of the dialog would start at
 * `scale: 0.08`, which is a speck expanding across the whole screen — theatre,
 * not orientation. Below the floor the effect stops being informative, so the
 * floor is where it stops.
 */
export function originTransform(origin: OriginRect, target: OriginRect): OriginTransform {
  const MIN_SCALE = 0.55
  const MAX_SCALE = 1

  const ratio = target.width > 0 ? origin.width / target.width : 1
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, ratio))

  // Centre-to-centre, because the surface scales about its own centre.
  const originCx = origin.left + origin.width / 2
  const originCy = origin.top + origin.height / 2
  const targetCx = target.left + target.width / 2
  const targetCy = target.top + target.height / 2

  return {
    x: Math.round(originCx - targetCx),
    y: Math.round(originCy - targetCy),
    scale,
  }
}

/**
 * Where the editor dialog will actually sit, from the same rules its style block
 * applies. Exported so the geometry exists once: a second hand-written copy would
 * drift the moment the dialog's max width changed, and the only symptom would be
 * a transition that lands slightly off — the kind of defect nobody files.
 */
export function editorDialogRect(
  viewportWidth: number,
  viewportHeight: number,
  geometry: { maxWidth: number; maxHeight: number; gutter: number; heightRatio: number },
): OriginRect {
  const width = Math.min(viewportWidth - geometry.gutter * 2, geometry.maxWidth)
  const height = Math.min(viewportHeight * geometry.heightRatio, geometry.maxHeight)
  return {
    width,
    height,
    left: (viewportWidth - width) / 2,
    top: (viewportHeight - height) / 2,
  }
}
