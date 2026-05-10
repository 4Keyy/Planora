import { describe, expect, it } from "vitest"
import * as animations from "@/lib/animations"
import { designTokens, getFocusStyles, getLayerStyles } from "@/lib/design-tokens"
import { ICON_MAP } from "@/lib/icon-map"

describe("design tokens", () => {
  it("exposes core visual tokens used by components", () => {
    expect(designTokens.colors.primary.DEFAULT).toBe("#000000")
    expect(designTokens.colors.accent.foreground).toBe("#ffffff")
    expect(designTokens.spacing[4]).toBe("1rem")
    expect(designTokens.radius.lg).toBe("14px")
    expect(designTokens.components.button.md).toBe("40px")
  })

  it("derives layer and focus helper styles from the token source of truth", () => {
    expect(getLayerStyles("modal")).toEqual({ zIndex: 1300 })
    expect(getFocusStyles()).toEqual({
      outline: "none",
      boxShadow: designTokens.shadows.focus,
    })
    expect(getFocusStyles("accent").boxShadow).toBe(designTokens.shadows["focus-accent"])
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
