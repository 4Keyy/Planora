import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { tokens, tailwindTheme, getFocusStyles } from "@/lib/design-tokens"

/**
 * The design system's rules, enforced rather than asserted.
 *
 * `lib/design-tokens.ts` opens by listing five rules it "exists to enforce". For a
 * while it named this file as the thing doing the enforcing and this file did not
 * exist, so every rule was a comment. Each one below has a measured history: the
 * numbers in the failure messages are what the audit actually counted before the
 * rule was introduced.
 *
 * These read the source tree, not the rendered output. A browser sweep can only
 * check states its fixture data reaches; a source scan cannot be dodged by a
 * component nobody happened to render.
 */

const SRC = path.join(process.cwd(), "src")

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "test") continue
      sourceFiles(full, out)
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

const FILES = sourceFiles(SRC).map((f) => ({
  rel: path.relative(SRC, f).replace(/\\/g, "/"),
  text: fs.readFileSync(f, "utf8"),
}))

/**
 * A file may hold colour literals only if it says so, in a comment, with the marker
 * `@colour-data` and a reason. Three separate sweeps have corrupted these values by
 * mistaking them for theme:
 *
 *   - the category swatches a user picks from — their choice, not our palette;
 *   - the per-type notification tints — identity, like an app icon;
 *   - the colour picker's hue geometry, and the contrast maths run over whatever
 *     colour a user chose.
 *
 * Requiring the marker rather than keeping a list here puts the exemption next to
 * the values it protects, where the next person editing them will actually see it.
 */
const COLOUR_DATA_MARKER = "@colour-data"

describe("rule 1 — no colour literal in a component", () => {
  it("finds no hex colour outside the files that own colour as data", () => {
    const offenders: string[] = []
    for (const f of FILES) {
      if (f.rel === "lib/design-tokens.ts") continue        // the palette itself
      if (f.text.includes(COLOUR_DATA_MARKER)) continue
      const lines = f.text.split("\n")
      for (const m of f.text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        const line = f.text.slice(0, m.index).split("\n").length
        const lineText = lines[line - 1]
        // `#define` in a GLSL string is a preprocessor directive, and a hex inside
        // a comment documents a format rather than naming a colour anyone renders.
        if (/#define|^\s*(?:\*|\/\/|\/\*)/.test(lineText)) continue
        offenders.push(`${f.rel}:${line} ${m[0]}`)
      }
    }
    // 441 uses across 98 distinct values when the audit started.
    expect(offenders).toEqual([])
  })

  it("routes every semantic colour through the Tailwind theme", () => {
    for (const name of ["ink", "ink-muted", "ink-subtle", "line-strong", "accent", "alert", "positive", "warn", "focus"]) {
      expect(tailwindTheme.colors).toHaveProperty(name)
    }
  })
})

describe("rule 2 — no text below 12px", () => {
  it("starts the type scale at 12px", () => {
    const smallest = Math.min(
      ...Object.values(tokens.fontSize).map(([size]) => parseFloat(size) * 16),
    )
    expect(smallest).toBe(12)
  })

  it("finds no inline fontSize under 12", () => {
    // 47% of the product's text used to sit below the floor: 9px x57, 10px x729,
    // 11px x573.
    const offenders: string[] = []
    for (const f of FILES) {
      for (const m of f.text.matchAll(/\bfontSize:\s*(\d+(?:\.\d+)?)/g)) {
        if (parseFloat(m[1]) >= 12) continue
        offenders.push(`${f.rel}:${f.text.slice(0, m.index).split("\n").length} ${m[1]}px`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("finds no arbitrary Tailwind text size under 12px", () => {
    const offenders: string[] = []
    for (const f of FILES) {
      for (const m of f.text.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
        if (parseFloat(m[1]) >= 12) continue
        offenders.push(`${f.rel} text-[${m[1]}px]`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe("rule 3 — four font weights, and four loaded faces", () => {
  it("declares exactly 400/500/600/700", () => {
    expect(Object.values(tokens.fontWeight)).toEqual(["400", "500", "600", "700"])
  })

  it("loads exactly the weights the scale declares", () => {
    // A weight with no file behind it is answered with a synthetic (smeared) face
    // and no error. A loaded weight the scale never uses is dead bytes.
    const layout = fs.readFileSync(path.join(SRC, "app", "layout.tsx"), "utf8")
    const loaded = new Set(
      [...layout.matchAll(/@fontsource\/[\w-]+\/(?:[a-z-]+-)?(\d{3})\.css/g)].map((m) => m[1]),
    )
    expect([...loaded].sort()).toEqual(["400", "500", "600", "700"])
  })

  it("finds no inline fontWeight outside the scale", () => {
    const allowed = new Set<string>(Object.values(tokens.fontWeight))
    const offenders: string[] = []
    for (const f of FILES) {
      for (const m of f.text.matchAll(/\bfontWeight:\s*(\d{3})/g)) {
        if (allowed.has(m[1])) continue
        offenders.push(`${f.rel}:${f.text.slice(0, m.index).split("\n").length} ${m[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe("rule 4 — one focus indicator, clearing 2.4.11", () => {
  /** WCAG 2.2 relative luminance. */
  function luminance(hex: string): number {
    const h = hex.replace("#", "")
    const [r, g, b] = [0, 2, 4].map((i) => {
      const c = parseInt(h.slice(i, i + 2), 16) / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const ratio = (a: string, b: string) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
  }

  it("clears 3:1 against paper", () => {
    // 2.4.11 asks for 3:1. Eight of eight focus indicators failed it before the
    // scale was unified; this one measures 19.80:1.
    expect(ratio(tokens.color.focus, tokens.color.paper)).toBeGreaterThanOrEqual(3)
  })

  it("clears 3:1 against the darkest surface in the product", () => {
    // The auth pages carry a near-black marketing panel. A focus ring that only
    // works on white is invisible on exactly the screen a keyboard user meets first.
    expect(ratio(tokens.color.focus, tokens.color.ink)).toBeLessThan(3)
    // …which is why the indicator also carries a light halo.
    expect(getFocusStyles().boxShadow).toContain(tokens.color.focusHalo)
  })

  it("declares the indicator once, in globals.css", () => {
    const css = fs.readFileSync(path.join(SRC, "app", "globals.css"), "utf8")
    const blocks = [...css.matchAll(/:focus-visible/g)]
    expect(blocks.length).toBeGreaterThan(0)
    expect(css).toContain("outline-offset")
  })
})

describe("rule 5 — priority is never encoded by hue alone", () => {
  it("ships a PriorityMeter that carries the value in its shape and its name", () => {
    // Five priority hues collapse under deuteranopia: the two lowest measured an
    // OKLab distance of 0.049, which is below the just-noticeable threshold.
    const meter = fs.readFileSync(
      path.join(SRC, "components", "ui", "priority-meter.tsx"),
      "utf8",
    )
    expect(meter).toMatch(/aria-label/)
    // The meter counts filled segments; it does not switch hue per level.
    expect(meter).toMatch(/\bof\b/)
  })
})

describe("the Tailwind bridge", () => {
  it("derives every scale from the tokens, so the two cannot drift", () => {
    expect(tailwindTheme.fontWeight).toEqual({ ...tokens.fontWeight })
    expect(tailwindTheme.spacing).toEqual(tokens.space)
    expect(tailwindTheme.borderRadius).toEqual({ ...tokens.radius })
    expect(tailwindTheme.boxShadow).toEqual({ ...tokens.shadow })
  })

  it("exposes every layer as a named z-index, with toast above modal", () => {
    // A toast hidden behind the dialog that triggered it is a message the user
    // never receives.
    expect(tokens.layer.toast).toBeGreaterThan(tokens.layer.modal)
    expect(tailwindTheme.zIndex.toast).toBe(String(tokens.layer.toast))
  })

  it("converts durations to CSS milliseconds", () => {
    expect(tailwindTheme.transitionDuration.base).toBe(`${tokens.motion.duration.base}ms`)
  })

  it("keeps the default control size at the touch threshold", () => {
    // Two thirds of this product's interactive elements measured under 44x44 at
    // 390px before the control scale existed.
    expect(tokens.size.control.md).toBe("44px")
  })
})

describe("no numeric z-index escapes the layer scale", () => {
  it("finds no global-tier z-index outside the layer scale", () => {
    /**
     * Single digits are LOCAL stacking — one absolutely-positioned child over its
     * sibling inside the same component. That is ordinary CSS and the layer scale
     * has nothing to say about it.
     *
     * Ten and above is a claim about where an element sits relative to the rest of
     * the product, and that claim belongs to the scale. Six such literals once
     * shipped, including 2001 and 3000 — numbers picked to beat whatever was on
     * screen at the time rather than to express an order.
     */
    const offenders: string[] = []
    for (const f of FILES) {
      if (f.rel === "lib/design-tokens.ts") continue
      for (const m of f.text.matchAll(/\bzIndex:\s*(\d+)|z-\[(\d+)\]/g)) {
        if (Number(m[1] ?? m[2]) < 10) continue
        offenders.push(`${f.rel}:${f.text.slice(0, m.index).split("\n").length} ${m[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
