import type { Config } from "tailwindcss"
import { tailwindTheme, tokens } from "./src/lib/design-tokens"

/**
 * Derived config. This file declares no visual value of its own — everything
 * comes from `src/lib/design-tokens.ts`, so the two cannot drift apart.
 *
 * Scales listed under `theme` REPLACE Tailwind's defaults. That is deliberate:
 * the audit measured Tailwind's default shadows beating the project's own scale
 * 98 uses to 19, simply because `extend` left both available. A scale that can be
 * bypassed is not a scale.
 *
 * `spacing` is the exception and stays on Tailwind's full default scale — which
 * means the 4px grid PLUS its half-steps: `0.5` (2px), `1.5` (6px), `2.5` (10px)
 * and `3.5` (14px), 214 uses between them. An earlier version of this comment
 * claimed every spacing value in the codebase sat on the 4px grid; it does not,
 * and saying so made the scale look tidier than it is.
 *
 * Keeping them is still the right call. The half-steps are what optical alignment
 * is made of — a 6px gap between an icon and its label, a 10px inset on a chip —
 * and the alternative is 214 arbitrary values, which the design system forbids
 * outright. `space` in `design-tokens.ts` is therefore the LAYOUT scale, the ten
 * steps a section or a card is built from; the half-steps exist below it for
 * setting one element against another inside a single control.
 */
const config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    // ── replaced scales ──
    colors: tailwindTheme.colors,
    fontSize: tailwindTheme.fontSize,
    fontWeight: tailwindTheme.fontWeight,
    boxShadow: tailwindTheme.boxShadow,
    borderRadius: { ...tailwindTheme.borderRadius, DEFAULT: tokens.radius.md },
    transitionTimingFunction: {
      ...tailwindTheme.transitionTimingFunction,
      DEFAULT: `cubic-bezier(${tokens.motion.ease.emphasized.join(", ")})`,
      linear: "linear",
    },

    container: {
      center: true,
      padding: "1rem",
      screens: { "2xl": "1280px" },
    },

    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "sans-serif"],
      },

      // Named tiers sit alongside Tailwind's local 0-50. Anything portaled,
      // fixed or sticky uses a tier; 0-50 is for stacking inside one component.
      zIndex: tailwindTheme.zIndex,

      // Named durations sit alongside the numeric defaults so nothing breaks
      // silently; the contract test is what keeps numeric ones out of source.
      transitionDuration: tailwindTheme.transitionDuration,
      animationDuration: tailwindTheme.transitionDuration,

      // Motion that CSS has to own — everything else lives in framer-motion.
      // Every keyframe below animates transform or opacity only.
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-out": {
          from: { opacity: "1", transform: "translateY(0)" },
          to: { opacity: "0", transform: "translateY(-4px)" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.97)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        /** Skeleton shimmer, composited: a translated gradient, not background-position. */
        shimmer: {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-in": `fade-in ${tokens.motion.duration.base}ms cubic-bezier(${tokens.motion.ease.emphasized.join(", ")})`,
        "fade-out": `fade-out ${tokens.motion.duration.fast}ms cubic-bezier(${tokens.motion.ease.exit.join(", ")})`,
        "slide-up": `slide-up ${tokens.motion.duration.base}ms cubic-bezier(${tokens.motion.ease.emphasized.join(", ")})`,
        "scale-in": `scale-in ${tokens.motion.duration.base}ms cubic-bezier(${tokens.motion.ease.emphasized.join(", ")})`,
        shimmer: `shimmer 1200ms linear infinite`,
      },

      // Control heights, so a button and a field can never disagree.
      height: {
        control: tokens.size.control.md,
        "control-sm": tokens.size.control.sm,
        "control-lg": tokens.size.control.lg,
        tab: tokens.size.tab,
      },
      width: {
        control: tokens.size.control.md,
        "control-sm": tokens.size.control.sm,
        "control-lg": tokens.size.control.lg,
      },
      minHeight: {
        control: tokens.size.control.md,
        touch: "44px",
      },
      minWidth: {
        touch: "44px",
      },

      outlineWidth: { DEFAULT: "2px" },
      outlineOffset: { DEFAULT: "2px" },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config

export default config
