#!/usr/bin/env node
/**
 * static-scan.mjs — reproducible measurement of Planora's frontend visual system.
 *
 * Produces the numeric baseline for the UI audit (docs/ui-audit/RESEARCH.md).
 * Read-only: never modifies a single file of the application.
 *
 *   node docs/ui-audit/tools/static-scan.mjs            # human summary
 *   node docs/ui-audit/tools/static-scan.mjs --json out.json
 *
 * Re-run after fixes to compare against the recorded baseline (BLOCK 18.1).
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'frontend')
const SRC = path.join(ROOT, 'src')

// ─── file walking ───────────────────────────────────────────────────────────

/** @returns {{path:string, rel:string, text:string, lines:string[]}[]} */
function collect(dir, filter, skipTests = true) {
  const out = []
  ;(function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (skipTests && e.name === 'test') continue
        walk(p)
      } else if (filter(e.name)) {
        if (skipTests && /\.(test|spec)\./.test(e.name)) continue
        const text = fs.readFileSync(p, 'utf8')
        out.push({ path: p, rel: path.relative(ROOT, p).replace(/\\/g, '/'), text, lines: text.split('\n') })
      }
    }
  })(dir)
  return out
}

const TSX = collect(SRC, (n) => /\.tsx$/.test(n))
const TS_ALL = collect(SRC, (n) => /\.(ts|tsx)$/.test(n))
const CSS = collect(SRC, (n) => /\.css$/.test(n))
const CODE = [...TS_ALL, ...CSS]

// ─── helpers ────────────────────────────────────────────────────────────────

/** Every regex match across a file set, as {value, rel, line} hits. */
function hits(files, re) {
  const out = []
  for (const f of files) {
    f.lines.forEach((text, i) => {
      for (const m of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) {
        out.push({ value: m[1] ?? m[0], rel: f.rel, line: i + 1, raw: m[0] })
      }
    })
  }
  return out
}

/** Frequency table of hit values, most frequent first. */
function freq(list) {
  const map = new Map()
  for (const h of list) {
    const k = h.value
    if (!map.has(k)) map.set(k, { value: k, count: 0, where: [] })
    const e = map.get(k)
    e.count++
    if (e.where.length < 6) e.where.push(`${h.rel}:${h.line}`)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

/** Distinct values only — the "how systematic is this scale" number. */
const distinct = (list) => [...new Set(list.map((h) => h.value))].sort()

// ─── 1. colour literals ─────────────────────────────────────────────────────

// A hex colour must be exactly 3/4/6/8 hex digits, not a longer token.
const HEX = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g
const hexTsx = hits(TSX, HEX).map((h) => ({ ...h, value: '#' + h.value.toLowerCase() }))
const hexTs = hits(TS_ALL, HEX).map((h) => ({ ...h, value: '#' + h.value.toLowerCase() }))
const hexCss = hits(CSS, HEX).map((h) => ({ ...h, value: '#' + h.value.toLowerCase() }))
const rgbLit = hits(CODE, /rgba?\([^)]*\)/)
const oklchLit = hits(CODE, /oklch\([^)]*\)/)

// ─── 2. token palettes, for the "does a token exist for this literal" check ──

function tokenHexSet() {
  const set = new Set()
  for (const file of ['src/lib/design-tokens.ts', 'tailwind.config.ts']) {
    const p = path.join(ROOT, file)
    if (!fs.existsSync(p)) continue
    const txt = fs.readFileSync(p, 'utf8')
    for (const m of txt.matchAll(HEX)) set.add('#' + m[1].toLowerCase())
  }
  return set
}
const TOKEN_HEX = tokenHexSet()

// ─── 3. the scales — how many DISTINCT values actually ship ─────────────────

const scale = {
  // Tailwind utility + arbitrary value, plus raw CSS
  radius: [
    ...hits(TSX, /\brounded(?:-(?:t|b|l|r|tl|tr|bl|br|s|e|ss|se|es|ee))?-(\[[^\]]+\]|none|sm|md|lg|xl|full)\b/),
    ...hits(CSS, /border-radius:\s*([^;]+);/),
  ],
  shadow: [
    ...hits(TSX, /\bshadow-(\[[^\]]+\]|none|sm|md|lg|xl)\b/),
    ...hits(CSS, /box-shadow:\s*([^;]+);/),
  ],
  duration: [
    ...hits(TSX, /\bduration-(\[[^\]]+\]|instant|fast|base|slow|deliberate|\d+)\b/),
    ...hits(CSS, /(?:transition-duration|animation-duration):\s*([^;]+);/),
    ...hits(CSS, /animation:\s*[\w-]+\s+([\d.]+m?s)/),
    ...hits(TS_ALL, /duration:\s*([\d.]+)/),
  ],
  fontSize: [
    ...hits(TSX, /\btext-(\[[^\]]+\]|caption|body-sm|body|title-sm|title|display-sm|display|hero|xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)(?![\w-])/),
    ...hits(CSS, /font-size:\s*([^;]+);/),
  ],
  fontWeight: [
    ...hits(TSX, /\bfont-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b/),
    ...hits(CSS, /font-weight:\s*([^;]+);/),
  ],
  spacing: [
    ...hits(TSX, /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-(\[[^\]]+\]|\d+(?:\.\d+)?|px|auto)\b/),
  ],
  zIndex: [
    ...hits(TSX, /\bz-(\[[^\]]+\]|base|dropdown|sticky|overlay|modal|popover|toast|tooltip|auto|\d+)\b/),
    ...hits(CODE, /zIndex:\s*['"]?([\w\d]+)['"]?/),
    ...hits(CSS, /z-index:\s*([^;]+);/),
  ],
  easing: [
    ...hits(TSX, /\bease-(\[[^\]]+\]|emphasized|standard|exit|linear|in|out|in-out)\b/),
    ...hits(CODE, /cubic-bezier\([^)]+\)/),
  ],
}

// ─── 4. declared token scales, to compare against ───────────────────────────

const DECLARED = {
  // design-tokens.ts spacing is a 4px scale; tailwind.config.ts adds 18/88/128.
  spacing: ['0', '1', '2', '3', '4', '5', '6', '8', '10', '12', '16', '20', '24', '18', '88', '128', 'auto', 'px'],
  radius: ['none', 'sm', 'md', 'lg', 'xl', 'full'],
  shadow: ['none', 'sm', 'md', 'lg', 'xl'],
  duration: ['instant', 'fast', 'base', 'slow', 'deliberate'],
  fontSize: ['caption', 'body-sm', 'body', 'title-sm', 'title', 'display-sm', 'display', 'hero'],
  fontWeight: ['normal', 'medium', 'semibold', 'bold'],
  zIndex: ['base', 'dropdown', 'sticky', 'overlay', 'modal', 'popover', 'toast', 'tooltip'],
  easing: ['emphasized', 'standard', 'exit'],
}

// ─── 5. rule violations ─────────────────────────────────────────────────────

const inlineStyle = hits(TSX, /style=\{\{/)
const important = hits(CODE, /!important/)
const darkUtil = hits(TSX, /\bdark:[\w[\]/.-]+/)
const tabularNums = hits(TSX, /tabular-nums/)
const roleAttr = hits(TSX, /role="([a-z]+)"/)
const ariaAttr = hits(TSX, /\b(aria-[a-zA-Z]+)=/)

// Interactive handlers on non-interactive elements (WCAG 4.1.2 / 2.1.1 risk).
const clickableDiv = []
for (const f of TSX) {
  // Match an opening tag and check whether it is a div/span/li carrying onClick.
  for (const m of f.text.matchAll(/<(div|span|li|p|section|article|td|tr)\b([^>]*?)>/gs)) {
    if (!/\bonClick=/.test(m[2])) continue
    const line = f.text.slice(0, m.index).split('\n').length
    const hasRole = /\brole=/.test(m[2])
    const hasTab = /\btabIndex=/.test(m[2])
    const hasKey = /\bonKeyDown=|\bonKeyUp=|\bonKeyPress=/.test(m[2])
    clickableDiv.push({ rel: f.rel, line, tag: m[1], hasRole, hasTab, hasKey, value: m[1] })
  }
}

// animations.ts self-declared rules (animations.ts:5-9).
const motionViolations = {
  filterOrBlur: hits(TS_ALL, /(?:whileHover|whileTap|animate|initial|exit|hidden|visible)[\s\S]{0,120}?\bfilter:\s*["'`][^"'`]*blur/),
  boxShadowInMotion: hits(TS_ALL, /(?:whileHover|whileTap|rest|focus|hover)\s*:\s*\{[^}]*boxShadow/),
  colorInMotion: hits(TS_ALL, /(?:whileHover|whileTap|rest|hover)\s*:\s*\{[^}]*\b(?:backgroundColor|color)\s*:/),
  transitionAll: [...hits(TSX, /\btransition-all\b/), ...hits(CSS, /transition:\s*all\b/)],
}

// CSS keyframes that animate non-composited properties.
// Brace-matched, not regex-terminated: a keyframes block contains nested { } stops.
const keyframes = []
for (const f of CSS) {
  for (const m of f.text.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    let depth = 1
    let i = m.index + m[0].length
    while (i < f.text.length && depth > 0) {
      if (f.text[i] === '{') depth++
      else if (f.text[i] === '}') depth--
      i++
    }
    const body = f.text.slice(m.index + m[0].length, i - 1)
    const line = f.text.slice(0, m.index).split('\n').length
    const props = [...new Set([...body.matchAll(/([a-z-]+)\s*:/g)].map((x) => x[1]))]
    const nonComposited = props.filter((p) => !/^(transform|opacity)$/.test(p))
    keyframes.push({ name: m[1], rel: f.rel, line, props, nonComposited })
  }
}

// Reduced motion awareness.
const reducedMotionFiles = TS_ALL.filter((f) => /useReducedMotion|prefers-reduced-motion|reducedMotion/.test(f.text)).map((f) => f.rel)
const animatingFiles = TS_ALL.filter((f) => /framer-motion|motion\.|animate=|requestAnimationFrame/.test(f.text)).map((f) => f.rel)

// Text truncation — candidates for overflow defects on 360px.
const truncation = hits(TSX, /\b(truncate|line-clamp-\d+|text-ellipsis|overflow-hidden)\b/)

// Localisation: Cyrillic in an English product.
const cyrillic = []
for (const f of TS_ALL) {
  f.lines.forEach((text, i) => {
    const m = text.match(/[Ѐ-ӿ]+/g)
    if (m) cyrillic.push({ rel: f.rel, line: i + 1, chars: m.join('').length, sample: text.trim().slice(0, 100) })
  })
}

// "use client" share — a direct multiplier on bundle under force-dynamic.
const clientComponents = TSX.filter((f) => /^\s*["']use client["']/m.test(f.text)).map((f) => f.rel)

// ─── report ─────────────────────────────────────────────────────────────────

const scaleReport = {}
for (const [name, list] of Object.entries(scale)) {
  const d = distinct(list)
  const arbitrary = d.filter((v) => v.startsWith('['))
  const declared = DECLARED[name] ?? []
  const offToken = d.filter((v) => !declared.includes(v) && !/^\d+$/.test(v) === false ? false : !declared.includes(v))
  scaleReport[name] = {
    totalUses: list.length,
    distinctValues: d.length,
    declaredInTokens: declared.length || null,
    arbitraryValues: arbitrary.length,
    values: freq(list).map((e) => ({ value: e.value, count: e.count, inTokens: declared.includes(e.value), where: e.where })),
  }
}

const hexFreq = freq(hexTsx).map((e) => ({ ...e, hasToken: TOKEN_HEX.has(e.value) }))

const report = {
  generatedAt: new Date().toISOString(),
  root: path.relative(process.cwd(), ROOT).replace(/\\/g, '/') || '.',
  inventory: {
    tsxFiles: TSX.length,
    tsAndTsxFiles: TS_ALL.length,
    cssFiles: CSS.length,
    totalLinesNonTest: TS_ALL.reduce((n, f) => n + f.lines.length, 0),
    clientComponents: clientComponents.length,
    clientComponentShare: +(clientComponents.length / TSX.length).toFixed(3),
  },
  colour: {
    hexLiteralsInTsx: hexTsx.length,
    hexLiteralsInAllTs: hexTs.length,
    hexLiteralsInCss: hexCss.length,
    distinctHexInTsx: distinct(hexTsx).length,
    hexWithoutToken: hexFreq.filter((e) => !e.hasToken).length,
    hexWithoutTokenUses: hexFreq.filter((e) => !e.hasToken).reduce((n, e) => n + e.count, 0),
    tokenPaletteSize: TOKEN_HEX.size,
    top20: hexFreq.slice(0, 20),
    inventedColours: hexFreq.filter((e) => !e.hasToken).slice(0, 40),
    rgbLiterals: rgbLit.length,
    distinctRgb: distinct(rgbLit).length,
    oklchLiterals: oklchLit.length,
  },
  scales: scaleReport,
  ruleViolations: {
    inlineStyleOccurrences: inlineStyle.length,
    inlineStyleFiles: [...new Set(inlineStyle.map((h) => h.rel))].length,
    inlineStyleTopFiles: freq(inlineStyle.map((h) => ({ value: h.rel }))).slice(0, 12),
    important: important.length,
    importantWhere: important.map((h) => `${h.rel}:${h.line}`),
    darkUtilities: darkUtil.length,
    darkUtilityFiles: [...new Set(darkUtil.map((h) => h.rel))],
    transitionAll: motionViolations.transitionAll.length,
    transitionAllWhere: motionViolations.transitionAll.map((h) => `${h.rel}:${h.line}`).slice(0, 30),
    boxShadowInMotionVariants: motionViolations.boxShadowInMotion.map((h) => `${h.rel}:${h.line}`),
    colourInMotionVariants: motionViolations.colorInMotion.map((h) => `${h.rel}:${h.line}`),
    filterBlurInMotion: motionViolations.filterOrBlur.map((h) => `${h.rel}:${h.line}`),
  },
  motion: {
    cssKeyframes: keyframes.length,
    keyframesAnimatingNonComposited: keyframes.filter((k) => k.nonComposited.length).map((k) => ({ name: k.name, at: `${k.rel}:${k.line}`, props: k.nonComposited })),
    filesThatAnimate: animatingFiles.length,
    filesRespectingReducedMotion: reducedMotionFiles.length,
    animatingWithoutReducedMotion: animatingFiles.filter((f) => !reducedMotionFiles.includes(f)),
  },
  accessibility: {
    roleAttributes: roleAttr.length,
    roleBreakdown: freq(roleAttr).map((e) => ({ role: e.value, count: e.count })),
    ariaAttributes: ariaAttr.length,
    ariaBreakdown: freq(ariaAttr).map((e) => ({ attr: e.value, count: e.count })),
    clickableNonButtons: clickableDiv.length,
    clickableNonButtonsUnsafe: clickableDiv.filter((d) => !d.hasRole || !d.hasTab || !d.hasKey),
    tabularNums: tabularNums.length,
    tabularNumsWhere: tabularNums.map((h) => `${h.rel}:${h.line}`),
  },
  text: {
    truncationUses: truncation.length,
    truncationBreakdown: freq(truncation).map((e) => ({ value: e.value, count: e.count })),
    cyrillicLines: cyrillic.length,
    cyrillicFiles: [...new Set(cyrillic.map((c) => c.rel))],
    cyrillicChars: cyrillic.reduce((n, c) => n + c.chars, 0),
    cyrillicSamples: cyrillic.slice(0, 25),
  },
}

// ─── output ─────────────────────────────────────────────────────────────────

const jsonFlag = process.argv.indexOf('--json')
if (jsonFlag !== -1) {
  const out = process.argv[jsonFlag + 1] ?? 'scan-static.json'
  fs.writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(`written: ${out}`)
}

const r = report
console.log(`\n═══ Planora static scan — ${r.root} ═══\n`)
console.log(`files            ${r.inventory.tsxFiles} tsx / ${r.inventory.tsAndTsxFiles} ts+tsx / ${r.inventory.cssFiles} css, ${r.inventory.totalLinesNonTest} lines (no tests)`)
console.log(`"use client"     ${r.inventory.clientComponents} of ${r.inventory.tsxFiles} tsx (${(r.inventory.clientComponentShare * 100).toFixed(0)}%)\n`)

console.log(`── colour ──`)
console.log(`hex in .tsx      ${r.colour.hexLiteralsInTsx} uses / ${r.colour.distinctHexInTsx} distinct`)
console.log(`without a token  ${r.colour.hexWithoutToken} distinct colours, ${r.colour.hexWithoutTokenUses} uses  ← invented on the spot`)
console.log(`token palette    ${r.colour.tokenPaletteSize} hex values`)
console.log(`rgb()/rgba()     ${r.colour.rgbLiterals} uses / ${r.colour.distinctRgb} distinct`)
console.log(`oklch()          ${r.colour.oklchLiterals} uses\n`)

console.log(`── scales (distinct values actually shipped vs declared in tokens) ──`)
for (const [name, s] of Object.entries(r.scales)) {
  const dec = s.declaredInTokens ? String(s.declaredInTokens) : '—'
  console.log(`${name.padEnd(12)} ${String(s.distinctValues).padStart(4)} distinct  (tokens: ${dec.padStart(3)}, arbitrary [..]: ${s.arbitraryValues}, uses: ${s.totalUses})`)
}

console.log(`\n── rule violations ──`)
console.log(`style={{ }}      ${r.ruleViolations.inlineStyleOccurrences} in ${r.ruleViolations.inlineStyleFiles} files`)
console.log(`!important       ${r.ruleViolations.important}`)
console.log(`dark:            ${r.ruleViolations.darkUtilities} in ${r.ruleViolations.darkUtilityFiles.length} files`)
console.log(`transition-all   ${r.ruleViolations.transitionAll}`)
console.log(`boxShadow in variants  ${r.ruleViolations.boxShadowInMotionVariants.length}`)
console.log(`colour in variants     ${r.ruleViolations.colourInMotionVariants.length}`)

console.log(`\n── motion ──`)
console.log(`css @keyframes   ${r.motion.cssKeyframes} (${r.motion.keyframesAnimatingNonComposited.length} animate non-composited properties)`)
console.log(`files animating  ${r.motion.filesThatAnimate}, respecting reduced-motion ${r.motion.filesRespectingReducedMotion}`)

console.log(`\n── accessibility ──`)
console.log(`role=            ${r.accessibility.roleAttributes}`)
console.log(`aria-*           ${r.accessibility.ariaAttributes}`)
console.log(`clickable non-buttons  ${r.accessibility.clickableNonButtons} (${r.accessibility.clickableNonButtonsUnsafe.length} without full role+tabIndex+key handling)`)
console.log(`tabular-nums     ${r.accessibility.tabularNums}`)

console.log(`\n── text ──`)
console.log(`truncation       ${r.text.truncationUses} uses`)
console.log(`cyrillic         ${r.text.cyrillicChars} chars on ${r.text.cyrillicLines} lines in ${r.text.cyrillicFiles.length} files\n`)
