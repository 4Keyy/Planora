/**
 * Animation system tokens — single source of truth for all motion in the app.
 *
 * Design principles (Emil Kowalski):
 *  - GPU composited only: transform (translate/scale) + opacity
 *  - UI interactions ≤ 300ms; data viz up to 1500ms is acceptable
 *  - Natural spring physics for elements that feel physical
 *  - Exponential-out easing (expo-out) for tween-based animations
 *  - No filter/blur, no box-shadow in whileHover, no transition:all
 *  - useReducedMotion() must be respected in every component
 */

// ─── Easing curves ─────────────────────────────────────────────────────────

/** Primary easing: fast-out, slow-approach. Use for most enter/exit animations. */
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const

/** Linear: use only for repeating animations (spinners, progress). */
export const EASE_LINEAR = "linear" as const

/** Ease-out standard: slightly softer than expo, for large layout shifts. */
export const EASE_OUT = [0.0, 0.0, 0.2, 1] as const

// ─── Duration tokens (ms → Framer Motion seconds) ──────────────────────────

/** Instant micro-interactions: button hover state, icon swap. 100ms */
export const DURATION_INSTANT = 0.1

/** Fast feedback: error messages, badge appear, tooltip. 180ms */
export const DURATION_FAST = 0.18

/** Standard UI: modals, panels, toasts, dropdowns. 220–280ms */
export const DURATION_UI = 0.22

/** Deliberate: page hero section, first-load stagger container entry. 280–400ms */
export const DURATION_DELIBERATE = 0.28

/** Data viz only: progress circles, chart paths. 1500ms is acceptable here. */
export const DURATION_DATA_VIZ = 1.5

// ─── Spring configs ─────────────────────────────────────────────────────────

/**
 * Standard spring: snappy with gentle settle. Use for modals, cards, tooltips.
 * Feels physical without overshooting.
 */
export const SPRING_STANDARD = {
  type: "spring" as const,
  stiffness: 400,
  damping: 28,
}

/**
 * Responsive spring: tighter, faster. Use for small interactive elements
 * (buttons, chips, badges). Matches finger-tap expectation.
 */
export const SPRING_RESPONSIVE = {
  type: "spring" as const,
  stiffness: 416,
  damping: 20,
}

/**
 * Gentle spring: loose and airy. Use for hero sections and decorative motion
 * where a slower settle reads as "floating".
 */
export const SPRING_GENTLE = {
  type: "spring" as const,
  stiffness: 260,
  damping: 24,
}

// ─── Tween shortcuts ────────────────────────────────────────────────────────

/** Standard UI tween — modals, panels, toasts. */
export const TWEEN_UI = {
  duration: DURATION_UI,
  ease: EASE_OUT_EXPO,
} as const

/** Fast tween — inline errors, badges, hints. */
export const TWEEN_FAST = {
  duration: DURATION_FAST,
  ease: EASE_OUT_EXPO,
} as const

/** Deliberate tween — hero section, page-level enter. */
export const TWEEN_DELIBERATE = {
  duration: DURATION_DELIBERATE,
  ease: EASE_OUT_EXPO,
} as const

/** Backdrop fade — slightly slower than the modal it accompanies. */
export const TWEEN_BACKDROP = {
  duration: 0.2,
  ease: EASE_OUT_EXPO,
} as const

// ─── Reusable Framer Motion variants ────────────────────────────────────────

/**
 * Standard fade-up: enters from 12px below, exits to 8px above.
 * Use with TWEEN_UI.
 */
export const VARIANTS_FADE_UP = {
  hidden: { opacity: 0, y: 12, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -8, scale: 0.97 },
} as const

/**
 * Modal enter: scales up from 0.95, translates up from 16px.
 * Pair with SPRING_STANDARD for natural deceleration.
 */
export const VARIANTS_MODAL = {
  hidden: { opacity: 0, scale: 0.95, y: 16 },
  visible: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.95, y: 16 },
} as const

/**
 * Dropdown: small y + scale. Symmetric enter/exit.
 * Pair with TWEEN_FAST for snappiness.
 */
export const VARIANTS_DROPDOWN = {
  hidden: { opacity: 0, y: -4, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -4, scale: 0.97 },
} as const

/**
 * Toast: enters from top (-16px), exits upward (-8px).
 * Pair with TWEEN_UI.
 */
export const VARIANTS_TOAST = {
  hidden: { opacity: 0, y: -16, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -8, scale: 0.97 },
} as const

/**
 * Card entrance: subtle lift from 15px below.
 * Pair with SPRING_RESPONSIVE.
 */
export const VARIANTS_CARD = {
  hidden: { opacity: 0, y: 15, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
} as const

/** Simple backdrop: opacity only. */
export const VARIANTS_BACKDROP = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
} as const

/** Stagger container: sequences children. */
export const staggerContainer = (staggerDelay = 0.08, delayChildren = 0.05) => ({
  hidden: {},
  visible: {
    transition: {
      staggerChildren: staggerDelay,
      delayChildren,
    },
  },
})

/** Stagger item: used as child inside staggerContainer. Pair with TWEEN_UI. */
export const VARIANTS_STAGGER_ITEM = {
  hidden: { opacity: 0, y: 10, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1 },
} as const

// ─── whileHover / whileTap presets ─────────────────────────────────────────

/** Standard card hover: lifts 2px. No box-shadow in Framer Motion — use CSS hover:shadow-* instead. */
export const HOVER_LIFT = { y: -2 } as const

/** Subtle card hover: 1px lift for denser layouts. */
export const HOVER_LIFT_SUBTLE = { y: -1 } as const

/** Button tap: slight compression. */
export const TAP_PRESS = { scale: 0.97 } as const

/** Card tap: gentler compression. */
export const TAP_CARD = { scale: 0.985 } as const

/**
 * Burst spring: high-bounce for micro-interaction feedback (e.g. task completion pulse).
 * Low damping = visible overshoot, which reads as satisfying tactile confirmation.
 */
export const SPRING_BURST = {
  type: "spring" as const,
  stiffness: 400,
  damping: 15,
  duration: 0.4,
}

// ─── Navbar ─────────────────────────────────────────────────────────────────

/** Navbar entrance: slides down from -8px. */
export const VARIANTS_NAVBAR = {
  hidden: { opacity: 0, y: -8 },
  visible: { opacity: 1, y: 0 },
} as const

export const TWEEN_NAVBAR = {
  duration: 0.4,
  ease: EASE_OUT_EXPO,
} as const

// ─── Enhanced animations for UI/UX overhaul ─────────────────────────────────

/** Page enter from left (for dashboard transitions). */
export const VARIANTS_PAGE_ENTER = {
  hidden: { opacity: 0, x: -12, y: 8 },
  visible: { opacity: 1, x: 0, y: 0 },
  exit: { opacity: 0, x: 12, y: -8 },
} as const

/** Success celebration pulse */
export const SPRING_SUCCESS = {
  type: "spring" as const,
  stiffness: 500,
  damping: 18,
  mass: 0.8,
}

/** Stat card entrance with stagger */
export const VARIANTS_STAT_CARD = {
  hidden: { opacity: 0, y: 20, scale: 0.92 },
  visible: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -10, scale: 0.95 },
} as const

/** Input focus glow animation */
export const VARIANTS_INPUT_FOCUS = {
  rest: { boxShadow: "0 0 0 0px rgba(0,0,0,0.1)" },
  focus: { boxShadow: "0 0 0 3px rgba(0,0,0,0.08)" },
} as const

/** Button hover with slight grow */
export const HOVER_GROW = { scale: 1.02, y: -1 } as const

/** Enhanced tap with more feedback */
export const TAP_PRESS_ENHANCED = { scale: 0.96 } as const

/** Completion animation - celebratory bounce */
export const VARIANTS_COMPLETION = {
  initial: { scale: 1, opacity: 1 },
  complete: {
    scale: [1, 1.15, 0.95, 1.05, 1],
    opacity: [1, 1, 1, 1, 0],
  },
} as const

/** Smooth exit animation for cards */
export const VARIANTS_CARD_EXIT = {
  hidden: { opacity: 0, y: 8, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -12, scale: 0.95 },
} as const

/** Floating animation for hero elements */
export const VARIANTS_FLOAT = {
  initial: { y: 0 },
  animate: {
    y: [0, -8, 0],
    transition: {
      duration: 4,
      repeat: Infinity,
      ease: "easeInOut",
    }
  },
} as const

/** Stagger animation for lists - tighter timing */
export const TWEEN_STAGGER_TIGHT = {
  duration: DURATION_UI,
  ease: EASE_OUT_EXPO,
  staggerChildren: 0.06,
  delayChildren: 0.02,
} as const

/** Modal bounce entrance */
export const VARIANTS_MODAL_BOUNCE = {
  hidden: { opacity: 0, scale: 0.92, y: 20 },
  visible: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.92, y: 20 },
} as const

/** Slide and fade for sidebar/panels */
export const VARIANTS_SLIDE_FADE = {
  hidden: { opacity: 0, x: -16 },
  visible: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -16 },
} as const

// ─── Card Hover Enhancements ────────────────────────────────────────────────

/** Smooth card background transition on hover */
export const VARIANTS_CARD_HOVER = {
  rest: { backgroundColor: "rgba(255, 255, 255, 0)" },
  hover: { backgroundColor: "rgba(255, 255, 255, 0.4)" },
} as const

/** Text darkening for completed cards on hover */
export const VARIANTS_TEXT_HOVER_DARK = {
  rest: { color: "rgba(107, 114, 128, 1)" },
  hover: { color: "rgba(55, 65, 81, 1)" },
} as const

// ─── Dropdown Performance ────────────────────────────────────────────────────

/** Ultra-fast dropdown open/close - prevents jitter */
export const TWEEN_DROPDOWN = {
  duration: 0.15,
  ease: EASE_OUT_EXPO,
} as const

/** Dropdown content animation - smooth scale and fade */
export const VARIANTS_DROPDOWN_ENHANCED = {
  hidden: { opacity: 0, scale: 0.95, y: -6 },
  visible: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.95, y: -6 },
} as const

// ─── Scroll Performance Optimization ─────────────────────────────────────────

/** Scroll smoothness without jank */
export const SCROLL_BEHAVIOR = {
  behavior: "smooth" as const,
  block: "nearest" as const,
  inline: "nearest" as const,
}
