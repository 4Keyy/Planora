#!/usr/bin/env node
/**
 * link-check.mjs — every relative markdown link in the repository, and whether it resolves.
 *
 *   node docs/ui-audit/tools/link-check.mjs .
 *
 * Exits non-zero when any link is broken, so it can gate a commit.
 *
 * A broken link in a document people navigate by is a dead end they hit before
 * they find out the page is otherwise correct — and nothing in the build catches
 * one. Anchors are checked too: a link to a heading that was renamed lands on the
 * right file and the wrong place, which is harder to notice than a 404.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.argv[2] || '.'

function collect(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === '.next') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collect(p, out)
    else if (e.name.endsWith('.md')) out.push(p)
  }
  return out
}

/** GitHub's anchor rule: lowercase, drop anything that is not a word char or a dash, spaces to dashes. */
const slug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')

const anchorsOf = (file) => {
  const set = new Set()
  const text = fs.readFileSync(file, 'utf8')
  for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) set.add(slug(m[1]))
  // Explicit <a name="..."> anchors, which the audit docs use.
  for (const m of text.matchAll(/<a\s+name=["']([^"']+)["']/g)) set.add(m[1].toLowerCase())
  for (const m of text.matchAll(/id=["']([^"']+)["']/g)) set.add(m[1].toLowerCase())
  return set
}

const files = collect(ROOT)
const anchorCache = new Map()
let checked = 0
const broken = []

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  const dir = path.dirname(file)
  for (const m of text.matchAll(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[2]
    if (/^(https?:|mailto:|#|tel:)/.test(target)) continue
    checked++
    const [rel, anchor] = target.split('#')
    const resolved = path.resolve(dir, decodeURIComponent(rel))
    if (!fs.existsSync(resolved)) {
      broken.push({ file, link: target, why: 'no such file' })
      continue
    }
    if (anchor && fs.statSync(resolved).isFile() && resolved.endsWith('.md')) {
      if (!anchorCache.has(resolved)) anchorCache.set(resolved, anchorsOf(resolved))
      if (!anchorCache.get(resolved).has(anchor.toLowerCase())) {
        broken.push({ file, link: target, why: 'no such heading' })
      }
    }
  }
}

console.log(`markdown files: ${files.length}`)
console.log(`relative links checked: ${checked}`)
console.log(`broken: ${broken.length}\n`)
for (const b of broken) {
  console.log(`  ${path.relative(ROOT, b.file).replace(/\\/g, '/')}`)
  console.log(`      -> ${b.link}   (${b.why})`)
}
process.exit(broken.length ? 1 : 0)
