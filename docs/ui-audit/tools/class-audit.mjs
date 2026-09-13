#!/usr/bin/env node
/**
 * class-audit.mjs — catches the failure mode a Tailwind codemod has and a compiler
 * does not: a class that no longer exists in the config produces no CSS and no
 * error. The page just quietly loses a style.
 *
 * Extracts every utility-looking token from `className` strings in src, then
 * checks each one actually emitted a rule into the built stylesheet.
 *
 *   npm run build && node docs/ui-audit/tools/class-audit.mjs
 */

import fs from 'node:fs'
import path from 'node:path'

const FRONTEND = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '../../../frontend')
const SRC = path.join(FRONTEND, 'src')

// ─── collect the built CSS ──────────────────────────────────────────────────

function findCss(dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...findCss(p))
    else if (e.name.endsWith('.css')) out.push(p)
  }
  return out
}

const cssFiles = findCss(path.join(FRONTEND, '.next/static'))
if (!cssFiles.length) {
  console.error('No built CSS found under .next/static — run `npm run build` first.')
  process.exit(2)
}
const css = cssFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n')

// ─── collect candidate classes from source ──────────────────────────────────

const files = []
;(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) {
      if (e.name === 'test') continue
      walk(p)
    } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) files.push(p)
  }
})(SRC)

/** Utility prefixes worth checking. Anything else is app CSS or a stray word. */
const TRACKED = /^(?:(?:[a-z-]+:)*)(?:-?(?:text|bg|border|ring|shadow|rounded|font|duration|ease|z|from|to|via|fill|stroke|decoration|outline|divide|placeholder|accent|caret|animate)-)/

const candidates = new Map() // class -> Set(file)

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  // className="..." | className={`...`} | cn("...", "...")
  for (const m of src.matchAll(/(?:className\s*=\s*["'`{]|cn\(|clsx\()([\s\S]{0,2000}?)(?:["'`}]\s*[/>]|\)\s*[,)\]}])/g)) {
    for (const sm of m[1].matchAll(/["'`]([^"'`]{1,400})["'`]/g)) {
      for (const tok of sm[1].split(/\s+/)) {
        const c = tok.trim()
        if (!c || !TRACKED.test(c)) continue
        if (c.includes('${') || c.includes('(')) continue
        if (!candidates.has(c)) candidates.set(c, new Set())
        candidates.get(c).add(path.relative(SRC, file).replace(/\\/g, '/'))
      }
    }
  }
}

// ─── check each candidate emitted a rule ────────────────────────────────────

/** Tailwind escapes these when it writes the selector. */
const escapeClass = (c) => c.replace(/[.:/[\]%!#(),+*~^$@&?<>=|'"]/g, (ch) => '\\' + ch)

const missing = []
for (const [cls, where] of candidates) {
  const selector = '.' + escapeClass(cls)
  // A utility can appear as `.cls{`, `.cls:hover`, `.cls>`, `.cls .x`, `.cls,`
  if (!css.includes(selector)) missing.push({ cls, where: [...where] })
}

missing.sort((a, b) => b.where.length - a.where.length)

console.log(`\nstylesheet:  ${cssFiles.map((f) => path.basename(f)).join(', ')}`)
console.log(`candidates:  ${candidates.size} distinct utility classes in ${files.length} files`)
console.log(`missing:     ${missing.length}\n`)

if (missing.length) {
  for (const m of missing.slice(0, 60)) {
    console.log(`  ${m.cls.padEnd(38)} ${m.where.slice(0, 3).join(', ')}${m.where.length > 3 ? ` +${m.where.length - 3}` : ''}`)
  }
  if (missing.length > 60) console.log(`  … and ${missing.length - 60} more`)
  process.exit(1)
}

console.log('  Every tracked utility class emitted a rule.\n')
