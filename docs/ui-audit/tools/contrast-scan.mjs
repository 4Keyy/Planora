#!/usr/bin/env node
/**
 * contrast-scan.mjs — numeric colour analysis for the Planora UI audit.
 *
 * Computes, never estimates:
 *   1. WCAG 2.2 contrast ratios for every declared text × background pair
 *      (1.4.3 text, 1.4.11 non-text) — sRGB relative luminance, not eyeballing.
 *   2. oklch (globals.css CSS variables) → sRGB, so the three palettes can be
 *      compared numerically instead of "they look the same".
 *   3. Colour-vision-deficiency simulation (protanopia / deuteranopia,
 *      Viénot–Brettel–Mollon 1999 linear-RGB matrices) for the five task
 *      priority colours, with pairwise OKLab distance before and after.
 *
 *   node docs/ui-audit/tools/contrast-scan.mjs [--json out.json]
 *
 * Read-only. Never touches application code.
 */

import fs from 'node:fs'

// ─── colour maths ───────────────────────────────────────────────────────────

const clamp01 = (x) => Math.min(1, Math.max(0, x))

function hexToRgb(hex) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length === 8) h = h.slice(0, 6)
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]
}

const rgbToHex = (rgb) =>
  '#' + rgb.map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, '0')).join('')

/** sRGB → linear-light (same transfer function WCAG 2.x specifies). */
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const toGamma = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)

/** WCAG 2.2 relative luminance. */
function luminance(rgb) {
  const [r, g, b] = rgb.map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio, rounded to 2 decimals. */
function contrast(fg, bg) {
  const l1 = luminance(fg)
  const l2 = luminance(bg)
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return +((hi + 0.05) / (lo + 0.05)).toFixed(2)
}

/** oklch(L C H [/ A]) → sRGB. L is 0..1, C absolute, H degrees. */
function oklchToRgb(L, C, H) {
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h)
  const bb = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bb
  const s_ = L - 0.0894841775 * a - 1.291485548 * bb
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return lin.map((c) => clamp01(toGamma(clamp01(c))))
}

/** sRGB → OKLab, for perceptual distance. */
function rgbToOklab(rgb) {
  const [r, g, b] = rgb.map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** Perceptual distance in OKLab. ~0.02 is a just-noticeable step for large areas. */
function deltaOk(a, b) {
  const A = rgbToOklab(a)
  const B = rgbToOklab(b)
  return +Math.sqrt(A.reduce((n, v, i) => n + (v - B[i]) ** 2, 0)).toFixed(4)
}

/** Viénot–Brettel–Mollon (1999) dichromat simulation, applied in linear RGB. */
const CVD = {
  protanopia: [
    [0.11238, 0.88762, 0.0],
    [0.11238, 0.88762, 0.0],
    [0.00401, -0.00401, 1.0],
  ],
  deuteranopia: [
    [0.29275, 0.70725, 0.0],
    [0.29275, 0.70725, 0.0],
    [-0.02234, 0.02234, 1.0],
  ],
}

function simulateCvd(rgb, type) {
  const M = CVD[type]
  const lin = rgb.map(toLinear)
  const out = M.map((row) => row.reduce((n, k, i) => n + k * lin[i], 0))
  return out.map((c) => clamp01(toGamma(clamp01(c))))
}

// ─── the declared palette, read from the tokens ─────────────────────────────

/**
 * Read out of design-tokens.ts rather than transcribed here.
 *
 * This file used to carry its own copy — `accent.DEFAULT #0ea5e9`,
 * `success.DEFAULT #10b981`, `warning.DEFAULT #f59e0b` and the rest — written before
 * the token file existed. None of those colours has shipped for some time, so the
 * scan opened every run by reporting a dozen contrast failures against a palette
 * the product does not use. A tool that cries wolf is worse than no tool.
 *
 * A regex, because this is plain .mjs and the tokens are TypeScript. It is enough:
 * the token file is a flat object of string literals by construction.
 */
const TOKENS_SRC = fs.readFileSync(
  new URL('../../../frontend/src/lib/design-tokens.ts', import.meta.url),
  'utf8',
)

function readTokenColours(src) {
  const body = src.slice(src.indexOf('const color = {'), src.indexOf('// ─── Type'))
  const flat = {}
  const gray = {}
  // `gray: { 50: "#fafafa", … }` is the only nested member.
  const grayBlock = /gray:\s*\{([^}]*)\}/.exec(body)
  if (grayBlock) {
    for (const m of grayBlock[1].matchAll(/(\d+):\s*"(#[0-9a-fA-F]{3,8})"/g)) gray[m[1]] = m[2]
  }
  const withoutGray = grayBlock ? body.replace(grayBlock[0], '') : body
  for (const m of withoutGray.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*):\s*"(#[0-9a-fA-F]{3,8})"/gm)) {
    flat[m[1]] = m[2]
  }
  return { flat, gray }
}

const TOKEN_COLOURS = readTokenColours(TOKENS_SRC)
const GRAY = TOKEN_COLOURS.gray
/** Every named colour the product ships, whatever its job. */
const SEMANTIC = TOKEN_COLOURS.flat

/**
 * Which tokens are asked to carry TEXT on a light surface.
 *
 * Without this the scan measured `paper` against `paper` and reported 1:1 FAIL --
 * true, meaningless, and indistinguishable in the output from a real defect. A
 * surface is not failing 1.4.3 by being a surface.
 *
 * `inkFaint` is in the list deliberately: it is the one token declared NON-TEXT,
 * and seeing it fail here on every run is the point.
 */
const TEXT_ON_LIGHT = new Set([
  'ink', 'inkMuted', 'inkSubtle', 'inkFaint', 'accent', 'alert', 'positive', 'warn', 'focus',
])

/** Tokens whose job is a border or another non-text mark: 1.4.11 wants 3:1. */
const NON_TEXT_MARKS = new Set(['line', 'lineStrong', 'inkFaint', 'focus'])

/** Text that belongs on the dark auth panel, where white is the wrong background. */
const TEXT_ON_INK = new Set(['paperMuted', 'paperSubtle', 'accentInk', 'alertInk', 'paper'])

/**
 * The RETIRED priority palette. Nothing below ships — priority is a five-segment
 * meter in one ink now (see `PriorityMeter`). It is kept because the CVD figures it
 * produces are the evidence for that decision: under deuteranopia the two lowest
 * separate by an OKLab distance of 0.049, beneath the just-noticeable threshold.
 */
const PRIORITY = {
  veryLow: { bg: '#fafafa', text: '#737373', border: '#e5e5e5' },
  low: { bg: '#f0fdf4', text: '#059669', border: '#bbf7d0' },
  medium: { bg: '#eff6ff', text: '#2563eb', border: '#bfdbfe' },
  high: { bg: '#fff7ed', text: '#ea580c', border: '#fed7aa' },
  urgent: { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
}

/** Surfaces text actually sits on in this product. */
const SURFACES = {
  white: '#ffffff',
  'gray-50 (page bg)': '#fafafa',
  'gray-100': '#f5f5f5',
  'glass 75% over white': '#ffffff', // rgba(255,255,255,.75) over white composites to white
}

// ─── 1. text contrast ───────────────────────────────────────────────────────

const textPairs = []
for (const [surfName, surfHex] of Object.entries(SURFACES)) {
  const bg = hexToRgb(surfHex)
  for (const [k, hex] of Object.entries(GRAY)) {
    const ratio = contrast(hexToRgb(hex), bg)
    textPairs.push({
      fg: `gray-${k}`, fgHex: hex, bg: surfName, bgHex: surfHex, ratio,
      aaNormal: ratio >= 4.5, aaLarge: ratio >= 3, aaaNormal: ratio >= 7, nonText: ratio >= 3,
    })
  }
  for (const [k, hex] of Object.entries(SEMANTIC)) {
    if (!TEXT_ON_LIGHT.has(k) && !NON_TEXT_MARKS.has(k)) continue   // a surface is not failing by being one
    const ratio = contrast(hexToRgb(hex), bg)
    textPairs.push({
      fg: k, fgHex: hex, bg: surfName, bgHex: surfHex, ratio,
      aaNormal: ratio >= 4.5, aaLarge: ratio >= 3, aaaNormal: ratio >= 7, nonText: ratio >= 3,
    })
  }
}

/** The reverse ramp, measured where it is used: on the dark auth panel. */
const inkSurface = hexToRgb(SEMANTIC.ink || '#171717')
const onInkPairs = [...TEXT_ON_INK].filter((k) => SEMANTIC[k]).map((k) => {
  const ratio = contrast(hexToRgb(SEMANTIC[k]), inkSurface)
  return { fg: k, fgHex: SEMANTIC[k], ratio, aaNormal: ratio >= 4.5, aaLarge: ratio >= 3 }
})

// priority chips: their own text on their own bg
const priorityPairs = Object.entries(PRIORITY).map(([name, c]) => {
  const ratio = contrast(hexToRgb(c.text), hexToRgb(c.bg))
  const borderRatio = contrast(hexToRgb(c.border), hexToRgb('#ffffff'))
  return {
    priority: name, text: c.text, bg: c.bg, border: c.border,
    textOnBg: ratio, aaNormal: ratio >= 4.5, aaLarge: ratio >= 3,
    borderOnWhite: borderRatio, borderPasses1411: borderRatio >= 3,
  }
})

// ─── 2. oklch CSS variables → sRGB, compared to the hex palette ─────────────

const cssText = fs.readFileSync('frontend/src/app/globals.css', 'utf8')
const oklchVars = []
for (const m of cssText.matchAll(/(--[\w-]+):\s*oklch\(([^)]+)\)/g)) {
  const parts = m[2].trim().split(/[\s/]+/).filter(Boolean)
  const L = parseFloat(parts[0])
  const C = parseFloat(parts[1] ?? '0')
  const H = parseFloat(parts[2] ?? '0')
  const alpha = m[2].includes('/') ? parts[parts.length - 1] : null
  const rgb = oklchToRgb(L, C, H)
  const line = cssText.slice(0, m.index).split('\n').length
  const scope = cssText.slice(0, m.index).lastIndexOf('.dark') > cssText.slice(0, m.index).lastIndexOf(':root') ? 'dark' : 'root'
  oklchVars.push({ name: m[1], scope, line, oklch: m[2].trim(), hex: rgbToHex(rgb), alpha })
}

/** Where a CSS variable and the Tailwind hex token claim to be the same thing. */
const VAR_VS_TOKEN = [
  ['--background', '#fafafa', 'tailwind colors.background'],
  ['--foreground', '#171717', 'tailwind colors.foreground'],
  ['--border', '#e5e5e5', 'tailwind colors.border'],
  ['--input', '#e5e5e5', 'tailwind colors.input'],
  ['--ring', '#000000', 'tailwind colors.ring'],
  ['--card', '#ffffff', 'tailwind colors.card.DEFAULT'],
  ['--popover', '#ffffff', 'tailwind colors.popover.DEFAULT'],
  ['--primary', '#000000', 'tailwind colors.primary.DEFAULT'],
  ['--secondary', '#f5f5f5', 'tailwind colors.secondary.DEFAULT'],
  ['--accent', '#0ea5e9', 'tailwind colors.accent.DEFAULT'],
]

const paletteDrift = VAR_VS_TOKEN.map(([varName, tokenHex, source]) => {
  const v = oklchVars.find((o) => o.name === varName && o.scope === 'root')
  if (!v) return { varName, tokenHex, source, status: 'variable not found' }
  const d = deltaOk(hexToRgb(v.hex), hexToRgb(tokenHex))
  return {
    varName, cssValue: `oklch(${v.oklch})`, cssAsHex: v.hex, tokenHex, source,
    deltaOkLab: d,
    verdict: d === 0 ? 'identical' : d < 0.01 ? 'imperceptible drift' : d < 0.03 ? 'visible drift' : 'DIFFERENT COLOUR',
  }
})

// ─── 3. colour-vision deficiency on the priority scale ──────────────────────

const priorityCvd = {}
for (const vision of ['normal', 'protanopia', 'deuteranopia']) {
  const seen = Object.entries(PRIORITY).map(([name, c]) => {
    const rgb = hexToRgb(c.text)
    const out = vision === 'normal' ? rgb : simulateCvd(rgb, vision)
    return { name, hex: rgbToHex(out), rgb: out }
  })
  const pairs = []
  for (let i = 0; i < seen.length; i++) {
    for (let j = i + 1; j < seen.length; j++) {
      pairs.push({
        pair: `${seen[i].name} ↔ ${seen[j].name}`,
        distance: deltaOk(seen[i].rgb, seen[j].rgb),
      })
    }
  }
  pairs.sort((a, b) => a.distance - b.distance)
  priorityCvd[vision] = { swatches: seen.map((s) => ({ name: s.name, hex: s.hex })), closestPairs: pairs.slice(0, 5), allPairs: pairs }
}

// ─── 4. what the focus ring is worth ────────────────────────────────────────
/**
 * The indicator is `outline: 2px solid theme("colors.focus")` in globals.css, read
 * from the token rather than transcribed — this block used to hardcode an
 * `rgba(0,0,0,0.35)` that the stylesheet had long since stopped using, and went on
 * reporting 2.44:1 FAIL for an indicator measuring 19.80:1.
 *
 * The token is opaque, so there is nothing to composite; the ratio is the plain
 * contrast against each surface.
 */
// Straight from the token table read above, for the same reason everything else
// is: the hardcoded rgba(0,0,0,0.35) this replaced had been wrong long enough to
// report 2.44:1 FAIL for an indicator measuring 19.80:1 PASS.
const FOCUS_HEX = SEMANTIC.focus || '#0a0a0a'
const focusRing = Object.entries(SURFACES).map(([name, hex]) => {
  const bg = hexToRgb(hex)
  const ratio = contrast(hexToRgb(FOCUS_HEX), bg)
  return { surface: name, effectiveHex: FOCUS_HEX, ratio, passes1411: ratio >= 3 }
})

// ─── report ─────────────────────────────────────────────────────────────────

const report = {
  generatedAt: new Date().toISOString(),
  method: {
    contrast: 'WCAG 2.2 relative luminance, sRGB transfer function',
    oklch: 'OKLab → linear sRGB → gamma encode',
    cvd: 'Viénot, Brettel & Mollon (1999) dichromat matrices applied in linear RGB',
    distance: 'Euclidean distance in OKLab',
  },
  textContrast: textPairs.sort((a, b) => a.ratio - b.ratio),
  failingNormalText: textPairs.filter((p) => !p.aaNormal).sort((a, b) => a.ratio - b.ratio),
  failingLargeText: textPairs.filter((p) => !p.aaLarge).sort((a, b) => a.ratio - b.ratio),
  priorityChips: priorityPairs,
  focusRing,
  paletteDrift,
  oklchVariables: oklchVars,
  priorityCvd,
}

const jsonFlag = process.argv.indexOf('--json')
if (jsonFlag !== -1) {
  fs.writeFileSync(process.argv[jsonFlag + 1] ?? 'scan-contrast.json', JSON.stringify(report, null, 2))
  console.log(`written: ${process.argv[jsonFlag + 1] ?? 'scan-contrast.json'}`)
}

console.log('\n═══ Planora contrast scan ═══\n')

console.log('── text on white: every neutral and semantic colour ──')
console.log('ratio  AA-norm AA-large  colour              hex')
for (const p of report.textContrast.filter((x) => x.bg === 'white')) {
  console.log(
    `${String(p.ratio).padStart(5)}  ${p.aaNormal ? '  ok  ' : ' FAIL '}  ${p.aaLarge ? '  ok  ' : ' FAIL '}  ${p.fg.padEnd(18)} ${p.fgHex}`,
  )
}

console.log('\n── RETIRED priority chips (kept as the evidence for PriorityMeter) ──')
console.log('priority   text     bg       ratio  AA-norm  border vs white (1.4.11)')
for (const p of report.priorityChips) {
  console.log(
    `${p.priority.padEnd(10)} ${p.text}  ${p.bg}  ${String(p.textOnBg).padStart(5)}  ${p.aaNormal ? ' ok ' : 'FAIL'}     ${String(p.borderOnWhite).padStart(5)} ${p.borderPasses1411 ? 'ok' : 'FAIL'}`,
  )
}

console.log('\n── the reverse ramp: text on the dark auth panel ──')
for (const p of onInkPairs.sort((a, b) => a.ratio - b.ratio)) {
  console.log(`${String(p.ratio).padStart(5)}  ${p.aaNormal ? ' ok ' : 'FAIL'}   ${p.fg.padEnd(18)} ${p.fgHex}`)
}

console.log(`\n── focus indicator (design-tokens colors.focus = ${FOCUS_HEX}) vs 1.4.11 ──`)
for (const f of report.focusRing) console.log(`${f.surface.padEnd(22)} ${f.effectiveHex}  ${String(f.ratio).padStart(5)}  ${f.passes1411 ? 'ok' : 'FAIL'}`)

/**
 * Palette drift: the same colour declared in two places, disagreeing.
 *
 * This compared `oklch()` variables in globals.css against hexes in the Tailwind
 * config, back when the product declared its palette twice. It does not any more —
 * tailwind.config.ts derives its theme from design-tokens.ts, so there is no second
 * declaration left to drift. Every row printed "undefined vs token", which is the
 * correct answer and a useless thing to emit on every run.
 *
 * Kept, silent, so the check speaks up the moment anyone reintroduces a parallel
 * palette.
 */
const drifted = report.paletteDrift.filter((d) => d.status !== 'variable not found')
if (drifted.length) {
  console.log('\n── palette drift: a colour is declared in two places ──')
  for (const d of drifted) {
    console.log(`${d.varName.padEnd(14)} css ${String(d.cssAsHex).padEnd(8)} vs token ${String(d.tokenHex).padEnd(8)} ΔOKLab ${String(d.deltaOkLab).padStart(7)}  ${d.verdict}`)
  }
}

/**
 * The evidence behind rule 5, not a live palette.
 *
 * These five hues are what priority used to be encoded in, and the numbers below
 * are the reason `PriorityMeter` exists: under deuteranopia the two lowest
 * priorities separate by an OKLab distance of 0.049, under the just-noticeable
 * threshold — two different priorities that look like one colour. The product now
 * carries priority as filled segments in a single ink plus a spoken name, so
 * nothing printed here ships.
 */
console.log('\n── why priority is not a hue: the retired palette under CVD ──')
for (const [vision, data] of Object.entries(report.priorityCvd)) {
  console.log(`\n${vision}: ${data.swatches.map((s) => `${s.name}=${s.hex}`).join('  ')}`)
  console.log(`  closest pairs: ${data.closestPairs.map((p) => `${p.pair} ${p.distance}`).join(' | ')}`)
}
console.log()
