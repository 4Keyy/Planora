/**
 * How the app's droplet bar answers the scroll, as a pure function.
 *
 * The bar floats over the page as a droplet. While the reader scrolls down into a list it
 * gets out of the way — on a desktop it condenses to the mark, the page you are on, and the
 * buttons; on a phone it slides up out of sight — and the moment they scroll back up, or
 * return to the top, it is whole again. Kept pure so the part that can go wrong (jitter, slow
 * scrolls, the top of the page) is tested without a browser.
 */

export interface DropletScroll {
  /** Desktop: tabs other than the current one fold away. */
  condensed: boolean
  /** Phone: the droplet slides up out of the way. */
  hidden: boolean
}

export const DROPLET_OPEN: DropletScroll = { condensed: false, hidden: false }
const DROPLET_FOLDED: DropletScroll = { condensed: true, hidden: true }

/** Within this many pixels of the top the droplet is always whole. */
export const DROPLET_TOP_ZONE = 96

/**
 * How far the reader must travel in one direction before the droplet answers. Trackpads and
 * momentum emit tiny opposite deltas, and a bar that answered each one would shiver.
 *
 * It is distance travelled since the scroll last turned, not distance per event: the scroll
 * position arrives once a frame, so a per-event threshold of 8px ignored every scroll slower
 * than 480px a second at 60Hz — a reader dragging gently up to get the bar back never did.
 */
export const DROPLET_TRAVEL = 12

export interface DropletTrack {
  state: DropletScroll
  /** Where the scroll last turned around. */
  anchor: number
  lastY: number
  /** The direction of the last movement: 1 down, -1 up, 0 none yet. */
  direction: 1 | -1 | 0
}

export const DROPLET_START: DropletTrack = { state: DROPLET_OPEN, anchor: 0, lastY: 0, direction: 0 }

/**
 * The next track for a scroll position. `state` keeps its identity when nothing changes, so
 * a caller that renders only on a new `state` renders only when the droplet changes shape.
 */
export function trackDropletScroll(track: DropletTrack, y: number): DropletTrack {
  if (!Number.isFinite(y) || y < DROPLET_TOP_ZONE) {
    return { state: DROPLET_OPEN, anchor: Number.isFinite(y) ? y : 0, lastY: Number.isFinite(y) ? y : 0, direction: 0 }
  }
  const step = y - track.lastY
  const direction: DropletTrack["direction"] = step > 0 ? 1 : step < 0 ? -1 : track.direction
  // A turn moves the anchor to where the scroll turned, so travel is measured from there.
  const anchor = direction !== track.direction ? track.lastY : track.anchor
  const travel = y - anchor
  const state =
    travel > DROPLET_TRAVEL ? DROPLET_FOLDED : travel < -DROPLET_TRAVEL ? DROPLET_OPEN : track.state
  return { state: sameShape(state, track.state) ? track.state : state, anchor, lastY: y, direction }
}

function sameShape(a: DropletScroll, b: DropletScroll) {
  return a.condensed === b.condensed && a.hidden === b.hidden
}
