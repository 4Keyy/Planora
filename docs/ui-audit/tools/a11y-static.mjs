#!/usr/bin/env node
/**
 * a11y-static.mjs — the accessibility checks a browser sweep structurally cannot make.
 *
 * The live matrix (live-scan.mjs) measures what is on screen, which means it only ever
 * sees the states the fixture data produces. An icon button that appears only for the
 * owner of a comment, or a control inside a menu nobody opened, is invisible to it. This
 * reads the source instead, so coverage does not depend on reaching a state.
 *
 * Three checks, each of which has caught a real defect in this codebase:
 *
 *   1. icon-only controls with no accessible name — `title` does not count: it is
 *      unannounced by several screen readers and never appears on touch.
 *   2. `onClick` on a non-interactive element without the keyboard equivalent. A
 *      handler that only stops propagation is exempt: it is not an action.
 *   3. an interactive element pulled out of the tab order with `tabIndex={-1}`.
 *
 *   node docs/ui-audit/tools/a11y-static.mjs
 *
 * Exits non-zero when anything is flagged, so it can gate a build.
 */

import fs from 'node:fs'
import path from 'node:path'

const SRC = path.join(process.cwd(), 'frontend', 'src')

const files = []
;(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'test') continue
      walk(p)
    } else if (/\.tsx$/.test(e.name) && !/\.test\./.test(e.name)) {
      files.push(p)
    }
  }
})(SRC)

const rel = (f) => path.relative(process.cwd(), f).replace(/\\/g, '/')
const lineOf = (src, index) => src.slice(0, index).split('\n').length

/**
 * Return the attribute text of the tag whose attributes start at `start`.
 *
 * A regex cannot do this. `<div onClick={(e) => e.stopPropagation()}>` contains a `>`
 * inside an arrow function, so `[^>]*?` truncates the attributes at `onClick={(e) =` —
 * which made an earlier version of this tool report that a handler doing nothing but
 * stopping propagation was missing its keyboard equivalent. Brace and quote depth have
 * to be tracked properly.
 */
function readTagAttrs(src, start) {
  let depth = 0
  let quote = null
  for (let i = start; i < src.length; i++) {
    const ch = src[i]

    if (quote) {
      if (ch === '\\') { i++; continue }   // escaped char inside a string
      if (ch === quote) quote = null
      continue
    }

    // Comments must be skipped BEFORE quote handling. An attribute expression can
    // contain a JS comment, and a comment can contain an apostrophe:
    //   onDoubleClick={() => { /* matching the Edit button's gating */ ... }}
    // Treating that apostrophe as a string opener swallowed the tag's real `>` and
    // ran 10,891 characters into the rest of the file, which is how this tool came
    // to report an onClick handler on a paragraph that has none.
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      if (nl === -1) return null
      i = nl
      continue
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      if (end === -1) return null
      i = end + 1
      continue
    }

    if (ch === '"' || ch === "'" || ch === '`') quote = ch
    else if (ch === '{') depth++
    else if (ch === '}') depth--
    else if (ch === '>' && depth === 0) return src.slice(start, i)
  }
  return null
}

/**
 * True when the element's children can produce visible text. The children are JSX, so a
 * literal string, a `{variable}` or a conditional with a string branch all count — only
 * a body made purely of nested components is genuinely nameless.
 */
function hasTextualChildren(body) {
  const withoutTags = body.replace(/<[^>]*>/g, '')
  if (/["'`][^"'`]*[A-Za-z][^"'`]*["'`]/.test(withoutTags)) return true            // a string literal
  if (/\{[^{}]*\b[a-z][A-Za-z0-9_]*\b[^{}]*\}/.test(withoutTags)) return true      // {variable}
  return withoutTags.replace(/\s+/g, ' ').trim().length > 0
}

/** `onClick={(e) => e.stopPropagation()}` performs no action — nothing to activate. */
const ONLY_STOPS_PROPAGATION =
  /onClick=\{\s*\(?\s*(?:e|ev|event)\s*\)?\s*=>\s*(?:e|ev|event)\.stopPropagation\(\)\s*\}/

const unnamed = []
const clickable = []
const removedFromTabOrder = []

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')

  // ── 1. icon-only controls with no accessible name ────────────────────────
  for (const m of src.matchAll(/<button\b/g)) {
    const attrs = readTagAttrs(src, m.index + m[0].length)
    if (attrs === null) continue
    if (/aria-label|aria-labelledby/.test(attrs)) continue
    const bodyStart = m.index + m[0].length + attrs.length + 1
    const close = src.indexOf('</button>', bodyStart)
    if (close === -1) continue
    const body = src.slice(bodyStart, close)
    if (hasTextualChildren(body)) continue
    if (!/<[A-Z]/.test(body)) continue                 // a capitalised child is an icon
    unnamed.push({
      file: rel(file),
      line: lineOf(src, m.index),
      titleOnly: /\btitle=/.test(attrs),
      snippet: body.replace(/\s+/g, ' ').trim().slice(0, 70),
    })
  }

  // ── 2. onClick on a non-interactive element ──────────────────────────────
  for (const m of src.matchAll(/<(div|span|li|p|section|article|td|tr)\b/g)) {
    const tag = m[1]
    const attrs = readTagAttrs(src, m.index + m[0].length)
    if (attrs === null) continue
    if (!/\bonClick=/.test(attrs)) continue
    if (ONLY_STOPS_PROPAGATION.test(attrs)) continue
    const hasRole = /\brole=/.test(attrs)
    const hasTab = /\btabIndex=/.test(attrs)
    const hasKey = /\bonKeyDown=|\bonKeyUp=|\bonKeyPress=/.test(attrs)
    if (hasRole && hasTab && hasKey) continue
    clickable.push({
      file: rel(file),
      line: lineOf(src, m.index),
      tag,
      missing: [!hasRole && 'role', !hasTab && 'tabIndex', !hasKey && 'key handler'].filter(Boolean),
      // A full-screen overlay that closes on click is the one legitimate shape here:
      // Escape is the keyboard equivalent, and a focusable backdrop would be worse —
      // a screen reader would announce a viewport-sized button.
      looksLikeBackdrop: /fixed inset-0/.test(attrs),
    })
  }

  // ── 3. interactive elements pulled out of the tab order ──────────────────
  for (const m of src.matchAll(/<(button|a)\b/g)) {
    const attrs = readTagAttrs(src, m.index + m[0].length)
    if (attrs === null) continue
    if (!/tabIndex=\{-1\}/.test(attrs)) continue
    removedFromTabOrder.push({ file: rel(file), line: lineOf(src, m.index), tag: m[1] })
  }
}

const realClickable = clickable.filter((c) => !c.looksLikeBackdrop)
const backdrops = clickable.filter((c) => c.looksLikeBackdrop)

console.log(`\nfiles scanned: ${files.length}\n`)

console.log(`icon-only controls with no accessible name: ${unnamed.length}`)
for (const u of unnamed) {
  console.log(`  ${u.file}:${u.line}${u.titleOnly ? '  (title= only — not an accessible name)' : ''}`)
  console.log(`    ${u.snippet}`)
}

console.log(`\nonClick on a non-interactive element: ${realClickable.length}`)
for (const c of realClickable) console.log(`  ${c.file}:${c.line}  <${c.tag}> missing ${c.missing.join(', ')}`)

console.log(`\nclick-to-dismiss backdrops (need Escape, not a role): ${backdrops.length}`)
for (const c of backdrops) console.log(`  ${c.file}:${c.line}`)

console.log(`\ninteractive elements removed from the tab order: ${removedFromTabOrder.length}`)
for (const t of removedFromTabOrder) console.log(`  ${t.file}:${t.line}  <${t.tag}>`)

const failures = unnamed.length + realClickable.length
console.log(failures ? `\n${failures} issue(s).\n` : '\nNo issues.\n')
process.exit(failures ? 1 : 0)
