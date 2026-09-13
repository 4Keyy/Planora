import { describe, expect, it } from "vitest"
import * as animations from "@/lib/animations"
import { getFocusStyles, getLayerStyles, getTransition, tailwindTheme, tokens } from "@/lib/design-tokens"
import { ICON_MAP } from "@/lib/icon-map"

// ─── contrast maths (WCAG 2.2) ──────────────────────────────────────────────

function toRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "")
  if (h.length === 3) h = h.split("").map((c) => c + c).join("")
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]
}

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))

function luminance(hex: string) {
  const [r, g, b] = toRgb(hex).map(linear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Contrast ratio between two hex colours, rounded to two decimals. */
function contrast(a: string, b: string) {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
}

// ─── the contract ───────────────────────────────────────────────────────────

describe("design token contract", () => {
  const { color } = tokens

  describe("scales stay small enough to be a system", () => {
    it.each([
      ["radius", Object.keys(tokens.radius).length, 6],
      ["shadow", Object.keys(tokens.shadow).length, 5],
      ["duration", Object.keys(tokens.motion.duration).length, 5],
      ["easing", Object.keys(tokens.motion.ease).length, 3],
      ["spring", Object.keys(tokens.motion.spring).length, 3],
      ["font size", Object.keys(tokens.fontSize).length, 8],
      ["font weight", Object.keys(tokens.fontWeight).length, 4],
      ["layer", Object.keys(tokens.layer).length, 8],
      ["spacing", Object.keys(tokens.space).length, 10],
    ])("%s scale has at most %i values", (_name, actual, max) => {
      expect(actual).toBeLessThanOrEqual(max)
    })
  })

  describe("text colours clear WCAG 1.4.3 on every surface", () => {
    const surfaces = [
      ["paper", color.paper],
      ["paper-sunken", color.paperSunken],
    ] as const
    const textColors = [
      ["ink", color.ink],
      ["ink-muted", color.inkMuted],
      ["ink-subtle", color.inkSubtle],
      ["accent", color.accent],
      ["alert", color.alert],
      ["positive", color.positive],
      ["warn", color.warn],
    ] as const

    for (const [surfaceName, surface] of surfaces) {
      for (const [inkName, ink] of textColors) {
        it(`${inkName} on ${surfaceName} is at least 4.5:1`, () => {
          expect(contrast(ink, surface)).toBeGreaterThanOrEqual(4.5)
        })
      }
    }

    it("ink-faint is documented as non-text — it would fail at any size", () => {
      // Kept in the palette for dividers and inactive icons only. This assertion
      // exists so that anyone tempted to use it for text sees why they must not.
      expect(contrast(color.inkFaint, color.paper)).toBeLessThan(3)
    })
  })

  describe("non-text contrast clears WCAG 1.4.11", () => {
    it("form-control borders reach 3:1", () => {
      expect(contrast(color.lineStrong, color.paper)).toBeGreaterThanOrEqual(3)
    })

    it("the focus indicator reaches 3:1", () => {
      expect(contrast(color.focus, color.paper)).toBeGreaterThanOrEqual(3)
      expect(contrast(color.focus, color.paperSunken)).toBeGreaterThanOrEqual(3)
    })

    it("accent text on its own surface stays readable", () => {
      expect(contrast(color.accent, color.accentSurface)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(color.alert, color.alertSurface)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(color.positive, color.positiveSurface)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(color.warn, color.warnSurface)).toBeGreaterThanOrEqual(4.5)
    })
  })

  describe("typography", () => {
    it("starts at 12px — nothing smaller ships", () => {
      const rems = Object.values(tokens.fontSize).map(([size]) => parseFloat(size))
      expect(Math.min(...rems)).toBeGreaterThanOrEqual(0.75)
    })

    it("declares no weight heavier than 700, because no 900 face is loaded", () => {
      const weights = Object.values(tokens.fontWeight).map(Number)
      expect(Math.max(...weights)).toBeLessThanOrEqual(700)
    })
  })

  describe("layering", () => {
    it("puts a toast above a modal so a message is never hidden behind it", () => {
      expect(tokens.layer.toast).toBeGreaterThan(tokens.layer.modal)
      expect(tokens.layer.tooltip).toBeGreaterThan(tokens.layer.toast)
      expect(tokens.layer.modal).toBeGreaterThan(tokens.layer.overlay)
    })

    it("derives stacking styles from the tier names", () => {
      expect(getLayerStyles("modal")).toEqual({ zIndex: 1300 })
      expect(getLayerStyles("toast")).toEqual({ zIndex: 1500 })
    })
  })

  describe("touch targets", () => {
    it("makes the default control 44px so it clears the touch threshold", () => {
      expect(parseInt(tokens.size.control.md, 10)).toBeGreaterThanOrEqual(44)
      expect(parseInt(tokens.size.tab, 10)).toBeGreaterThanOrEqual(44)
    })
  })

  describe("motion", () => {
    it("keeps every UI duration at or under 320ms", () => {
      const { deliberate, ...ui } = tokens.motion.duration
      expect(Math.max(...Object.values(ui))).toBeLessThanOrEqual(320)
      // `deliberate` is explicitly non-UI: number rollers and progress rings.
      expect(deliberate).toBeGreaterThan(320)
    })

    it("builds a framer transition from named tokens", () => {
      expect(getTransition("base", "emphasized")).toEqual({
        duration: 0.22,
        ease: tokens.motion.ease.emphasized,
      })
    })
  })

  describe("the focus indicator", () => {
    it("is a single outline plus a halo, so it survives dark surfaces too", () => {
      const styles = getFocusStyles()
      expect(styles.outline).toContain(tokens.color.focus)
      expect(styles.outlineOffset).toBe("2px")
      expect(styles.boxShadow).toContain(tokens.color.focusHalo)
    })
  })

  describe("the Tailwind bridge", () => {
    it("derives every colour from the token source rather than restating it", () => {
      expect(tailwindTheme.colors.ink).toBe(tokens.color.ink)
      expect(tailwindTheme.colors["ink-subtle"]).toBe(tokens.color.inkSubtle)
      expect(tailwindTheme.colors.accent).toBe(tokens.color.accent)
      expect(tailwindTheme.colors.alert).toBe(tokens.color.alert)
    })

    it("exposes the layers as strings for the zIndex scale", () => {
      expect(tailwindTheme.zIndex.toast).toBe("1500")
    })

    it("exposes durations in milliseconds", () => {
      expect(tailwindTheme.transitionDuration.base).toBe("220ms")
    })
  })
})

describe("animation tokens", () => {
  it("keeps motion under named reusable constants", () => {
    expect(animations.EASE_OUT_EXPO).toEqual([0.16, 1, 0.3, 1])
    expect(animations.TWEEN_UI.duration).toBe(animations.DURATION_UI)
    expect(animations.SPRING_STANDARD.type).toBe("spring")
    expect(animations.VARIANTS_MODAL.visible).toEqual({ opacity: 1, scale: 1, y: 0 })
    expect(animations.SCROLL_BEHAVIOR).toEqual({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    })
  })

  it("builds stagger container transitions with defaults and overrides", () => {
    expect(animations.staggerContainer().visible.transition).toEqual({
      staggerChildren: 0.08,
      delayChildren: 0.05,
    })
    expect(animations.staggerContainer(0.2, 0.1).visible.transition).toEqual({
      staggerChildren: 0.2,
      delayChildren: 0.1,
    })
  })
})

describe("icon map", () => {
  it("contains stable category icons used by persisted category records", () => {
    expect((ICON_MAP.Folder as any).render).toEqual(expect.any(Function))
    expect((ICON_MAP.CheckCircle2 as any).render).toEqual(expect.any(Function))
    expect((ICON_MAP.Briefcase as any).render).toEqual(expect.any(Function))
    expect((ICON_MAP.Home as any).render).toEqual(expect.any(Function))
  })
})
