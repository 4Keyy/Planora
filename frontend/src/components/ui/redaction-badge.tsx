"use client"

import { motion } from "framer-motion"
import { NumberRoll } from "@/components/ui/number-roll"
import { DURATION_UI, EASE_OUT_EXPO } from "@/lib/animations"
import { cn } from "@/lib/utils"

/**
 * Redaction as a shape you watch narrow.
 *
 * "Private", "Shared" and "Public" are three words that differ by a glance. The one
 * thing this product promises that a list app does not is that a task can be shown
 * to some people and not others — and a promise rendered as a word is a promise the
 * eye skips on its way to the title. So the state is a ring, and changing it moves:
 * the arc opens or closes over 220ms, which is legible in peripheral vision before
 * any of the three words has been read.
 *
 * Geometry, not hue. The product spends its one saturated colour on `alert`, and a
 * privacy scale painted green/amber/red would both compete with overdue and collapse
 * under dichromacy the way the old five-colour priority palette did. The drawn arc is
 * `ink`, the cut arc is `line`, so the mark survives greyscale and every kind of
 * colour blindness.
 *
 * `private` and `public` are only one narrow gap apart as pure geometry, and at the
 * 14px `sm` size that difference is a couple of pixels. The filled centre — you, the
 * only viewer — is what actually separates them, and the word ships beside the ring
 * in every case. The ring is the thing that *moves*; it was never asked to carry the
 * meaning on its own.
 *
 * Animating `stroke-dasharray` is the one exception to "transform and opacity only",
 * and it is a real exception rather than a shortcut: no transform turns an arc into a
 * longer arc. Scaling the circle changes its size, rotating it moves the gap without
 * resizing it. framer-motion's `pathLength`/`pathOffset` set `pathLength="1"` on the
 * element and write the dash pattern in normalised units, so each frame interpolates
 * two attributes of one SVG element — no layout, no reflow of the label beside it.
 */

export type Audience = "private" | "shared" | "public"

export interface RedactionBadgeProps {
  audience: Audience
  /** How many people can currently see it (shared only). */
  viewerCount?: number
  size?: "sm" | "md"
  /** Renders as a button when set, so the badge itself can cycle the audience. */
  onClick?: () => void
  className?: string
}

/** The two arcs of the ring, as fractions of the circumference. They always sum to 1. */
export interface RedactionArc {
  /** The part that is drawn, in `ink`. */
  dash: number
  /** The part that is cut away, showing the `line` track underneath. */
  gap: number
}

/**
 * A sealed ring still needs one break in it, or `private` and `public` are the same
 * drawing. Twelve percent of the circumference is the smallest cut that survives the
 * 14px size once the stroke has thickness.
 */
const PRIVATE_GAP = 0.12

/** `shared` is visibly cut open before the first viewer is counted, so an unknown audience still reads as "not just you". */
const SHARED_BASE_GAP = 0.16

/** Each viewer widens the cut. Linear, because the count beside it is linear too. */
const SHARED_GAP_PER_VIEWER = 0.045

/**
 * Past half the circumference the mark stops reading as a ring and starts reading as
 * a bracket, so the cut saturates at 8 viewers. Growth stays linear right up to the
 * cap, which is what keeps two viewers and three viewers distinguishable — the
 * alternative, a curve that eases into the limit, compresses exactly the small counts
 * a person can actually count.
 */
const SHARED_MAX_GAP = 0.5

/** Four decimals: enough that `dash + gap` is exactly 1 and the attribute string stays short. */
const round = (n: number) => Math.round(n * 1e4) / 1e4

/**
 * The geometry, separated from the drawing so it can be checked without a DOM.
 *
 * Exported because the arc is the component's only real logic; everything else is
 * markup, and a test that renders SVG to assert on a number is testing jsdom.
 */
export function redactionArc(audience: Audience, viewerCount?: number): RedactionArc {
  if (audience === "public") return { dash: 1, gap: 0 }
  if (audience === "private") return { dash: round(1 - PRIVATE_GAP), gap: PRIVATE_GAP }

  // A negative, fractional or NaN count is a caller bug, and a caller bug should not
  // be able to draw an inside-out ring. Clamp instead of trusting it.
  const viewers = normaliseCount(viewerCount) ?? 0
  const gap = round(Math.min(SHARED_MAX_GAP, SHARED_BASE_GAP + viewers * SHARED_GAP_PER_VIEWER))
  return { dash: round(1 - gap), gap }
}

/** `undefined` for "no count given"; any nonsense the caller passes becomes a whole number ≥ 0. */
function normaliseCount(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.floor(value))
}

const AUDIENCE_WORD: Record<Audience, string> = {
  private: "Private",
  shared: "Shared",
  public: "Public",
}

/**
 * The whole fact, in one sentence.
 *
 * Full stops rather than dashes: a screen reader pauses on a full stop and reads an
 * em dash aloud in some voices.
 */
function describeAudience(audience: Audience, viewerCount?: number): string {
  if (audience === "private") return "Private. Only you can see this."
  if (audience === "public") return "Public. Anyone with the link can see this."
  const viewers = normaliseCount(viewerCount)
  if (viewers === undefined) return "Shared. Some people can see this."
  return `Shared with ${viewers} ${viewers === 1 ? "person" : "people"}.`
}

/** Pixel size of the mark. The viewBox is fixed at 24, so stroke weight scales with it. */
const MARK_PX: Record<NonNullable<RedactionBadgeProps["size"]>, number> = { sm: 14, md: 18 }

export function RedactionBadge({
  audience,
  viewerCount,
  size = "md",
  onClick,
  className,
}: RedactionBadgeProps) {
  const { dash, gap } = redactionArc(audience, viewerCount)
  const sentence = describeAudience(audience, viewerCount)
  const viewers = audience === "shared" ? normaliseCount(viewerCount) : undefined
  const px = MARK_PX[size]

  const mark = (
    <svg
      viewBox="0 0 24 24"
      width={px}
      height={px}
      fill="none"
      aria-hidden="true"
      className="flex-shrink-0 overflow-visible"
    >
      {/* Start the ring at twelve o'clock. An SVG circle starts at three o'clock, which
          would put the cut on the right-hand edge where the label is. */}
      <g transform="rotate(-90 12 12)">
        {/* The cut arc: always the full circle, always underneath. Drawing only the
            missing piece would need a second set of dash maths that has to stay in
            sync with the first, and the two would drift the moment either changed. */}
        <circle cx="12" cy="12" r="9" strokeWidth="3" className="stroke-line" />
        <motion.circle
          cx="12"
          cy="12"
          r="9"
          strokeWidth="3"
          // Butt caps, not round. The cut is a cut: round caps would extend half a
          // stroke width past each end and close a narrow gap back up.
          strokeLinecap="butt"
          className="stroke-ink"
          // `initial={false}` — the badge must be correct on its first paint. Animating
          // in from a closed ring would show every task as private for 220ms on load.
          initial={false}
          // `pathOffset` is half the gap, so the cut sits centred on twelve o'clock
          // rather than growing off one edge.
          animate={{ pathLength: dash, pathOffset: gap / 2 }}
          transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO }}
        />
      </g>
      {/* You, at the centre, when you are the only one. This is what tells `private`
          apart from `public` at a size where a 12% gap is two pixels. */}
      {audience === "private" && <circle cx="12" cy="12" r="3" className="fill-ink" />}
    </svg>
  )

  const label = (
    <span
      className={cn(
        "font-semibold text-ink-muted",
        size === "sm" ? "text-caption" : "text-body-sm",
      )}
    >
      {AUDIENCE_WORD[audience]}
    </span>
  )

  const count =
    viewers === undefined ? null : (
      <span
        className={cn(
          "font-semibold text-ink",
          size === "sm" ? "text-caption" : "text-body-sm",
        )}
      >
        <NumberRoll value={viewers} />
      </span>
    )

  const contents = (
    <>
      {mark}
      {label}
      {count}
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        // The label names where you are and what pressing does. "Private" alone tells a
        // screen-reader user the state and hides the fact that the badge is the control.
        aria-label={`${sentence} Change who can see it.`}
        className={cn(
          // `min-h-touch`, not the `touch-target` pseudo-element: the badge already
          // fills its own 44px, and the pseudo-element would spill over whatever chip
          // sits beside it in a task row and steal that chip's taps.
          "inline-flex min-h-touch items-center gap-2 rounded-full px-3 py-1.5",
          "bg-paper-sunken transition duration-fast hover:bg-paper-muted active:scale-95",
          className,
        )}
      >
        {contents}
      </button>
    )
  }

  return (
    /**
     * `role="img"` collapses the mark, the word and the rolling count into one node
     * with one name. Without it a screen reader reads "Private" from the label and
     * then the digit from NumberRoll's own sr-only value, so the audience is
     * announced twice and the number arrives with no noun attached to it.
     */
    <span
      role="img"
      aria-label={sentence}
      className={cn("inline-flex items-center gap-2", className)}
    >
      {contents}
    </span>
  )
}
