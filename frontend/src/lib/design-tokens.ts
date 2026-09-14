/**
 * Planora design tokens — the single source of truth for every visual value.
 *
 * This file is consumed by `tailwind.config.ts`, which derives its theme from it.
 * Nothing here is duplicated in the Tailwind config; changing a value here changes
 * the utility classes the whole product uses.
 *
 * Rules this file exists to enforce (checked by
 * `src/test/quality/design-tokens.contract.test.ts`):
 *
 *   1. No colour literal appears in a component. Ever.
 *   2. No text smaller than `caption` (12px) ships.
 *   3. Only the four declared font weights are used — 400/500/600/700. Those are
 *      exactly the four faces `app/layout.tsx` loads, so a weight outside the
 *      scale has no file behind it and the browser answers with a synthetic
 *      (smeared) bold instead of an error.
 *   4. Every focus indicator clears WCAG 2.2 §2.4.11 at >= 3:1 against its background.
 *   5. Priority is never encoded by hue — see `PriorityMeter`. Five hues collapse
 *      under deuteranopia (measured OKLab distance 0.049 between the two lowest).
 *
 * Contrast figures below are computed against `paper` (#ffffff) with the WCAG 2.2
 * relative-luminance formula by `docs/ui-audit/tools/contrast-scan.mjs`.
 */

// ─── Colour ─────────────────────────────────────────────────────────────────

/**
 * Ink on paper. The product has one saturated colour (`alert`) and one accent;
 * everything else is a neutral. Restraint is the design, not a limitation.
 */
const color = {
  /** Primary text. 17.93:1 */
  ink: "#171717",
  /** Secondary text, and the minimum for anything under 14px. 7.81:1 */
  inkMuted: "#525252",
  /** Muted text at 14px and above. 4.74:1 — the floor for body copy. */
  inkSubtle: "#737373",
  /**
   * NON-TEXT ONLY: dividers, inactive icons, decorative strokes.
   * 2.52:1 — fails 1.4.3 for text at any size. Never `text-ink-faint`.
   */
  inkFaint: "#a3a3a3",

  /** Card and section borders. Decorative, not an affordance. 1.26:1 */
  line: "#e5e5e5",
  /** Form-control borders. 4.54:1 — clears 1.4.11's 3:1 for UI components. */
  lineStrong: "#767676",

  /** Surfaces. */
  paper: "#ffffff",
  /**
   * Text ON an ink surface. The auth pages carry a dark marketing panel, so the
   * ink ramp has to run in reverse there: reusing `inkMuted` on `#171717`
   * measured 2.29:1.
   */
  paperMuted: "#e5e5e5",   // 14.23:1 on ink
  paperSubtle: "#a3a3a3",  // 7.11:1 on ink — muted, still compliant
  paperSunken: "#fafafa",
  paperRaised: "#ffffff",

  /**
   * The single accent. Links, active tab, selection.
   * 5.93:1 — the previous #0ea5e9 measured 2.77:1 and could not carry text.
   */
  accent: "#0369a1",
  accentSurface: "#e0f2fe",
  accentInk: "#ffffff",

  /**
   * The only saturated colour in the product, and it means exactly one thing:
   * something is overdue, or a destructive action is being confirmed. 6.47:1
   */
  alert: "#b91c1c",
  alertSurface: "#fef2f2",
  alertInk: "#ffffff",

  /** Confirmation. Used for state, never for decoration. 5.02:1 */
  positive: "#15803d",
  positiveSurface: "#f0fdf4",

  /** Caution: approaching a limit, unverified email. 4.92:1 */
  warn: "#a16207",
  warnSurface: "#fffbeb",

  /** Focus indicator. 19.80:1 on paper; the halo keeps it visible on dark. */
  focus: "#0a0a0a",
  focusHalo: "rgba(255, 255, 255, 0.9)",

  /** Neutral ramp. Kept because it is genuinely well-spaced; use the semantic
   *  names above in components — these exist for the ramp's own sake. */
  gray: {
    50: "#fafafa",
    100: "#f5f5f5",
    150: "#eeeeee",
    200: "#e5e5e5",
    300: "#d4d4d4",
    400: "#a3a3a3",
    500: "#737373",
    600: "#525252",
    700: "#404040",
    800: "#262626",
    900: "#171717",
  },
} as const

// ─── Type ───────────────────────────────────────────────────────────────────

/**
 * Eight steps. 12px is the floor: 47% of the product's text used to sit below it
 * (9px x57, 10px x729, 11px x573 measured), which is why the scale starts here.
 *
 * Tuple shape matches Tailwind's `fontSize` config: [size, { lineHeight, ... }].
 */
const fontSize = {
  caption: ["0.75rem", { lineHeight: "1rem", letterSpacing: "0" }],
  "body-sm": ["0.875rem", { lineHeight: "1.25rem", letterSpacing: "0" }],
  body: ["1rem", { lineHeight: "1.5rem", letterSpacing: "0" }],
  "title-sm": ["1.25rem", { lineHeight: "1.75rem", letterSpacing: "-0.01em" }],
  title: ["1.5rem", { lineHeight: "2rem", letterSpacing: "-0.015em" }],
  "display-sm": ["2rem", { lineHeight: "2.375rem", letterSpacing: "-0.02em" }],
  display: ["2.75rem", { lineHeight: "3rem", letterSpacing: "-0.025em" }],
  hero: ["4rem", { lineHeight: "4rem", letterSpacing: "-0.03em" }],
} as const

/**
 * Four weights, and only four — and `app/layout.tsx` loads exactly these four, in
 * the latin and latin-ext subsets. Asking for anything else costs a synthetic
 * face: the browser smears the nearest real weight and reports nothing. The
 * product used to ship six weights (300-800) across four subsets — 24 font files
 * for an English UI — while one stray `font-weight: 900` in the colour picker
 * asked for a face that has never existed here.
 */
const fontWeight = {
  normal: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const

// ─── Space ──────────────────────────────────────────────────────────────────

/** Ten steps on a 4px grid. */
const space = {
  0: "0",
  1: "0.25rem", // 4
  2: "0.5rem", // 8
  3: "0.75rem", // 12
  4: "1rem", // 16
  6: "1.5rem", // 24
  8: "2rem", // 32
  12: "3rem", // 48
  16: "4rem", // 64
  24: "6rem", // 96
} as const

// ─── Shape ──────────────────────────────────────────────────────────────────

const radius = {
  none: "0",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "20px",
  full: "9999px",
} as const

/**
 * Five elevations, each two-layered so the shadow reads as depth rather than blur.
 * Tailwind's defaults (`shadow-sm/md/lg/xl/2xl`) are removed in the config: they
 * used to win 98 uses to 19 against this scale.
 */
const shadow = {
  none: "none",
  sm: "0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.06)",
  md: "0 2px 4px rgba(0,0,0,0.04), 0 4px 8px rgba(0,0,0,0.06)",
  lg: "0 4px 8px rgba(0,0,0,0.04), 0 12px 24px rgba(0,0,0,0.08)",
  xl: "0 8px 16px rgba(0,0,0,0.06), 0 24px 48px rgba(0,0,0,0.12)",
} as const

// ─── Layers ─────────────────────────────────────────────────────────────────

/**
 * Eight named tiers, used literally. There are no numeric z-index values in the
 * product: `toast` sits ABOVE `modal` so a message can never be hidden behind the
 * dialog that triggered it.
 */
const layer = {
  base: 0,
  dropdown: 1000,
  sticky: 1100,
  overlay: 1200,
  modal: 1300,
  popover: 1400,
  toast: 1500,
  tooltip: 1600,
} as const

// ─── Motion ─────────────────────────────────────────────────────────────────

/**
 * Five durations, three curves, three springs. Every animated value is a
 * `transform` or an `opacity` — nothing else composites on the GPU.
 */
const motion = {
  duration: {
    /** 100ms — colour change, press feedback. */
    instant: 100,
    /** 160ms — tooltip, chip, inline error. */
    fast: 160,
    /** 220ms — modal, popover, toast, element move. The default. */
    base: 220,
    /** 320ms — bottom sheet, large layout change. The UI ceiling. */
    slow: 320,
    /** 480ms — NON-UI only: number roller, progress ring. */
    deliberate: 480,
  },
  ease: {
    /** Fast out, soft landing. For things arriving. */
    emphasized: [0.16, 1, 0.3, 1],
    /** Symmetric. For things moving or resizing. */
    standard: [0.4, 0, 0.2, 1],
    /** Accelerates away. For things leaving. */
    exit: [0.4, 0, 1, 1],
  },
  spring: {
    /** Modals, cards. Settles without overshoot. */
    standard: { type: "spring", stiffness: 400, damping: 28 },
    /** Chips, buttons, small elements. Matches a finger tap. */
    responsive: { type: "spring", stiffness: 416, damping: 20 },
    /** Presence, decorative. Floats into place. */
    gentle: { type: "spring", stiffness: 260, damping: 24 },
  },
} as const

// ─── Component sizing ───────────────────────────────────────────────────────

/**
 * `md` is 44px, not 40: it is the default control size and 44 is the touch
 * threshold. Two thirds of this product's interactive elements used to measure
 * under 44x44 at 390px.
 */
const size = {
  control: { sm: "36px", md: "44px", lg: "52px" },
  icon: { xs: 14, sm: 16, md: 20, lg: 24, xl: 32 },
  /** Bottom-bar targets on phones. */
  tab: "56px",
  /** Avatar diameters. */
  avatar: { sm: 20, md: 24, lg: 32, xl: 48 },
} as const

// ─── The token object ───────────────────────────────────────────────────────

export const tokens = {
  color,
  fontSize,
  fontWeight,
  space,
  radius,
  shadow,
  layer,
  motion,
  size,
} as const

export type Tokens = typeof tokens

// ─── Tailwind bridge ────────────────────────────────────────────────────────

/**
 * The Tailwind theme, derived. `tailwind.config.ts` spreads this; it declares no
 * values of its own, so the two can never drift apart.
 */
export const tailwindTheme = {
  colors: {
    transparent: "transparent",
    current: "currentColor",
    inherit: "inherit",

    ink: color.ink,
    "ink-muted": color.inkMuted,
    "ink-subtle": color.inkSubtle,
    "ink-faint": color.inkFaint,

    line: color.line,
    "line-strong": color.lineStrong,

    paper: color.paper,
    "paper-muted": color.paperMuted,
    "paper-subtle": color.paperSubtle,
    "paper-sunken": color.paperSunken,
    "paper-raised": color.paperRaised,

    accent: color.accent,
    "accent-surface": color.accentSurface,
    "accent-ink": color.accentInk,

    alert: color.alert,
    "alert-surface": color.alertSurface,
    "alert-ink": color.alertInk,

    positive: color.positive,
    "positive-surface": color.positiveSurface,

    warn: color.warn,
    "warn-surface": color.warnSurface,

    focus: color.focus,

    white: color.paper,
    black: "#000000",
    gray: color.gray,
  },

  // Tailwind's types want mutable tuples; `as const` above makes them readonly.
  fontSize: Object.fromEntries(
    Object.entries(fontSize).map(([k, v]) => [k, [v[0], { ...v[1] }]]),
  ) as Record<string, [string, { lineHeight: string; letterSpacing: string }]>,
  fontWeight: { ...fontWeight },
  spacing: space,
  borderRadius: { ...radius },
  boxShadow: { ...shadow },
  zIndex: Object.fromEntries(Object.entries(layer).map(([k, v]) => [k, String(v)])),

  transitionDuration: Object.fromEntries(
    Object.entries(motion.duration).map(([k, v]) => [k, `${v}ms`]),
  ),
  transitionTimingFunction: Object.fromEntries(
    Object.entries(motion.ease).map(([k, v]) => [k, `cubic-bezier(${v.join(", ")})`]),
  ),
} as const

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Stacking context for a named tier. */
export function getLayerStyles(tier: keyof typeof layer) {
  return { zIndex: layer[tier] }
}

/**
 * The one focus indicator in the product. A dark outline carries it on light
 * surfaces; the light halo keeps it visible on dark ones, so a single token works
 * on the register page's dark panel as well as on paper.
 */
export function getFocusStyles() {
  return {
    outline: `2px solid ${color.focus}`,
    outlineOffset: "2px",
    boxShadow: `0 0 0 4px ${color.focusHalo}`,
  }
}

/** Framer Motion transition from a duration and easing token. */
export function getTransition(
  duration: keyof typeof motion.duration = "base",
  ease: keyof typeof motion.ease = "emphasized",
) {
  return { duration: motion.duration[duration] / 1000, ease: motion.ease[ease] }
}
