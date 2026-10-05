import { tokens } from "@/lib/design-tokens"

/**
 * Motion presets for framer-motion.
 *
 * The numbers are NOT declared here — they are read from `design-tokens.ts`, so
 * the CSS utilities (`duration-base`, `ease-emphasized`) and the JS transitions
 * below cannot drift apart. This file only names the combinations.
 *
 * Four rules, and the file obeys them:
 *
 *   1. Animate `transform` and `opacity` only. Nothing else composites on the
 *      GPU, and everything else risks a layout pass on every frame.
 *   2. A UI interaction finishes within 320ms. `deliberate` (480ms) is for
 *      number rollers and progress rings, never for a response to a tap.
 *   3. No `transition: all`, no `filter`, no `box-shadow` inside a motion
 *      variant. A shadow on hover belongs in CSS (`hover:shadow-md`), where it
 *      costs nothing.
 *   4. One preset per meaning. An earlier generation of this file kept both
 *      `VARIANTS_MODAL` and `VARIANTS_MODAL_BOUNCE`, both `TAP_PRESS` and
 *      `TAP_PRESS_ENHANCED`, and 30 of its 47 exports were used nowhere.
 *
 * `MotionConfig reducedMotion="user"` at the app root already honours
 * `prefers-reduced-motion` for everything here, so no component needs its own
 * `useReducedMotion()` guard.
 */

const { duration, ease, spring } = tokens.motion

// ─── Easing ─────────────────────────────────────────────────────────────────

/** Fast out, soft landing. For things arriving. */
export const EASE_OUT_EXPO = ease.emphasized

/** Symmetric. For things moving or resizing in place. */
export const EASE_STANDARD = ease.standard

/** Accelerates away. For things leaving. */
export const EASE_EXIT = ease.exit

/** Only for animations that repeat: spinners, shimmer, progress. */
export const EASE_LINEAR = "linear" as const

// ─── Durations, in framer-motion's seconds ──────────────────────────────────

/** 100ms — press feedback, colour change. */
export const DURATION_INSTANT = duration.instant / 1000
/** 160ms — tooltip, chip, inline error. */
export const DURATION_FAST = duration.fast / 1000
/** 220ms — the default: modal, popover, toast, element move. */
export const DURATION_UI = duration.base / 1000
/** 320ms — bottom sheet, large layout change. The ceiling for a UI response. */
export const DURATION_SLOW = duration.slow / 1000
/** 480ms — NOT a UI response. Number rollers and progress rings only. */
export const DURATION_DELIBERATE = duration.deliberate / 1000

// ─── Springs ────────────────────────────────────────────────────────────────

/** Modals and cards. Settles without overshoot. */
export const SPRING_STANDARD = spring.standard

/** Chips, buttons, small elements. Matches a finger tap. */
export const SPRING_RESPONSIVE = spring.responsive

/** Presence and decorative motion. Floats into place. */
export const SPRING_GENTLE = spring.gentle

// ─── Tweens ─────────────────────────────────────────────────────────────────

/** The default. Modals, panels, toasts. */
export const TWEEN_UI = { duration: DURATION_UI, ease: EASE_OUT_EXPO } as const

/** Inline errors, badges, hints. */
export const TWEEN_FAST = { duration: DURATION_FAST, ease: EASE_OUT_EXPO } as const

/** Page-level entrances and large layout changes. */
export const TWEEN_DELIBERATE = { duration: DURATION_SLOW, ease: EASE_OUT_EXPO } as const

/** A backdrop fades on the same beat as the surface it sits behind. */
export const TWEEN_BACKDROP = { duration: DURATION_UI, ease: EASE_OUT_EXPO } as const

/** Things leaving accelerate away rather than easing out. */
export const TWEEN_EXIT = { duration: DURATION_FAST, ease: EASE_EXIT } as const

// ─── Variants ───────────────────────────────────────────────────────────────

/** Enters from 12px below, leaves 8px above. The general-purpose entrance. */
export const VARIANTS_FADE_UP = {
  hidden: { opacity: 0, y: 12, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -8, scale: 0.97 },
} as const

/** Modal surface. Pair with SPRING_STANDARD. */
export const VARIANTS_MODAL = {
  hidden: { opacity: 0, scale: 0.95, y: 16 },
  visible: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.95, y: 16 },
} as const

/** Dropdown and popover. Pair with TWEEN_FAST. */
export const VARIANTS_DROPDOWN = {
  hidden: { opacity: 0, y: -4, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -4, scale: 0.97 },
} as const

/** Toast. Arrives from above, leaves the way it came. */
export const VARIANTS_TOAST = {
  hidden: { opacity: 0, y: -16, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -8, scale: 0.97 },
} as const

/** List card. Pair with SPRING_RESPONSIVE. */
export const VARIANTS_CARD = {
  hidden: { opacity: 0, y: 15, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
} as const

/** Opacity only — a backdrop should never move. */
export const VARIANTS_BACKDROP = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
} as const

/**
 * Sequences children. The default 80ms stagger holds for the first handful of
 * items; past the eighth the delay outlasts the reader's patience, so callers
 * rendering long lists should cap it.
 */
export const staggerContainer = (staggerDelay = 0.08, delayChildren = 0.05) => ({
  hidden: {},
  visible: { transition: { staggerChildren: staggerDelay, delayChildren } },
})

/** The child of a staggerContainer. Pair with TWEEN_UI. */
export const VARIANTS_STAGGER_ITEM = {
  hidden: { opacity: 0, y: 10, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1 },
} as const

// ─── Hover and tap ──────────────────────────────────────────────────────────
//
// A shadow on hover belongs in CSS (`hover:shadow-md`). Animating box-shadow
// through framer-motion repaints on every frame for no visual gain.

/** Card hover: lifts 2px. */
export const HOVER_LIFT = { y: -2 } as const

/** Denser layouts: 1px. */
export const HOVER_LIFT_SUBTLE = { y: -1 } as const

/** Button press. */
export const TAP_PRESS = { scale: 0.97 } as const

/** Card press — gentler, because the surface is larger. */
export const TAP_CARD = { scale: 0.985 } as const

// ─── Scrolling ──────────────────────────────────────────────────────────────

/** Bring an element into view without yanking the page. */
export const SCROLL_BEHAVIOR = {
  behavior: "smooth" as const,
  block: "nearest" as const,
  inline: "nearest" as const,
}
