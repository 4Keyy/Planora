#!/usr/bin/env node
/**
 * live-scan.mjs — browser-side measurement harness for the Planora UI audit.
 *
 * Screenshots the full route × viewport matrix to docs/ui-audit/shots/ AND, on the
 * same visit, measures what a screenshot cannot show:
 *   • every interactive element's rendered box (WCAG 2.5.8 target size, 44×44 guidance)
 *   • the real source of horizontal overflow (element-level scrollWidth analysis)
 *   • tab order and focus visibility
 *   • heading hierarchy and landmark structure
 *   • accessible names — the list of controls that have none
 *   • contrast of the pairs ACTUALLY rendered, not just the declared tokens
 *   • LCP / CLS and the identity of the LCP element
 *
 * Screenshots go to disk, never into an agent's context window.
 *
 *   node docs/ui-audit/tools/live-scan.mjs --base http://127.0.0.1:3000 --set public
 *   node docs/ui-audit/tools/live-scan.mjs --set all --email x@y.z --password ...
 *
 * Read-only against the application: it clicks nothing destructive and edits no file
 * outside docs/ui-audit/.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// Playwright lives in frontend/node_modules; ESM resolves from THIS file's
// directory, which never reaches it. Resolve against the frontend package.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_PKG = path.resolve(HERE, '../../../frontend/package.json')
const { chromium } = createRequire(FRONTEND_PKG)('playwright')
const { installMockApi } = await import(new URL('./mock-api.mjs', import.meta.url))

// ─── configuration ──────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? dflt : argv[i + 1]
}
const has = (name) => argv.includes(`--${name}`)

const BASE = arg('base', 'http://127.0.0.1:3000')
const SET = arg('set', 'public')
const OUT_SHOTS = arg('shots', 'docs/ui-audit/shots')
const OUT_JSON = arg('json', 'docs/ui-audit/tools/scan-live.json')
const EMAIL = arg('email', null)
const PASSWORD = arg('password', null)
const ONLY = arg('only', null) // comma-separated route filter
const MOCK = has('mock')
const DATASET = arg('dataset', 'rich')   // rich | empty | extreme
const LATENCY = Number(arg('latency', '0'))
const FAIL_WITH = arg('fail', null) ? Number(arg('fail', null)) : null

const VIEWPORTS = [
  { w: 360, h: 640, label: 'narrowest real phone' },
  { w: 390, h: 844, label: 'baseline phone' },
  { w: 430, h: 932, label: 'large phone' },
  { w: 768, h: 1024, label: 'tablet portrait' },
  { w: 1024, h: 768, label: 'tablet landscape / small laptop' },
  { w: 1280, h: 800, label: 'typical laptop' },
  { w: 1440, h: 900, label: 'baseline desktop' },
  { w: 1920, h: 1080, label: 'large monitor' },
  { w: 2560, h: 1440, label: 'very wide' },
]

const PUBLIC_ROUTES = [
  { path: '/', name: 'landing', full: true },
  { path: '/auth/login', name: 'auth-login', full: true },
  { path: '/auth/register', name: 'auth-register', full: true },
  { path: '/auth/forgot-password', name: 'auth-forgot-password', full: false },
  { path: '/auth/reset-password?token=demo', name: 'auth-reset-password', full: false },
  { path: '/auth/verify-email?token=demo', name: 'auth-verify-email', full: false },
]

const PRIVATE_ROUTES = [
  { path: '/dashboard', name: 'dashboard', full: true },
  { path: '/tasks', name: 'tasks', full: true },
  { path: '/tasks/completed', name: 'tasks-completed', full: false },
  { path: '/categories', name: 'categories', full: false },
  { path: '/profile', name: 'profile', full: true },
  { path: '/branch/todo-0', name: 'branch', full: true },
]

let ROUTES = SET === 'public' ? PUBLIC_ROUTES : SET === 'private' ? PRIVATE_ROUTES : [...PUBLIC_ROUTES, ...PRIVATE_ROUTES]
if (ONLY) ROUTES = ROUTES.filter((r) => ONLY.split(',').includes(r.name))

// Full nine viewports for the routes that carry the product; five for the rest.
const CORE_FIVE = [0, 1, 4, 6, 7]

fs.mkdirSync(OUT_SHOTS, { recursive: true })

// ─── the in-page probe ──────────────────────────────────────────────────────
// Runs inside the page. Everything it returns is measured, never inferred.

const PROBE = () => {
  const R = {}
  const vis = (el) => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'
  }
  const sel = (el) => {
    const parts = []
    let n = el
    for (let i = 0; n && i < 4; i++) {
      let p = n.tagName.toLowerCase()
      if (n.id) { parts.unshift(p + '#' + n.id); break }
      const cls = (n.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.')
      if (cls) p += '.' + cls
      parts.unshift(p)
      n = n.parentElement
    }
    return parts.join(' > ').slice(0, 180)
  }

  // ── accessible name, approximated the way a screen reader resolves it ──
  const accName = (el) => {
    const aria = el.getAttribute('aria-label')
    if (aria && aria.trim()) return aria.trim()
    const lb = el.getAttribute('aria-labelledby')
    if (lb) {
      const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() || '').join(' ').trim()
      if (t) return t
    }
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
      if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
        if (l?.textContent?.trim()) return l.textContent.trim()
      }
      const wrap = el.closest('label')
      if (wrap?.textContent?.trim()) return wrap.textContent.trim()
      const ph = el.getAttribute('placeholder')
      if (ph && ph.trim()) return `(placeholder only) ${ph.trim()}`
    }
    if (el.tagName === 'IMG') return (el.getAttribute('alt') || '').trim()
    const txt = (el.innerText || el.textContent || '').trim()
    if (txt) return txt.slice(0, 80)
    const t = el.getAttribute('title')
    return t?.trim() || ''
  }

  const INTERACTIVE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="tab"], [role="menuitem"], [tabindex]:not([tabindex="-1"])'

  // ── 1. target sizes ──
  const targets = []
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (!vis(el)) continue
    const r = el.getBoundingClientRect()
    targets.push({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || null,
      name: accName(el),
      w: +r.width.toFixed(1),
      h: +r.height.toFixed(1),
      x: +r.x.toFixed(1),
      y: +r.y.toFixed(1),
      sel: sel(el),
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
    })
  }
  R.targets = {
    total: targets.length,
    under44: targets.filter((t) => (t.w < 44 || t.h < 44) && !t.disabled),
    under24: targets.filter((t) => (t.w < 24 || t.h < 24) && !t.disabled),
    unnamed: targets.filter((t) => !t.name),
  }
  // Crowding: any two enabled targets whose boxes are closer than 8px.
  const crowded = []
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i], b = targets[j]
      const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)))
      const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)))
      if (dx === 0 && dy === 0) continue // overlapping/nested — not a spacing issue
      const gap = Math.max(dx, dy)
      if (gap > 0 && gap < 8) crowded.push({ a: a.name || a.sel, b: b.name || b.sel, gap: +gap.toFixed(1) })
    }
  }
  R.targets.crowdedPairs = crowded.slice(0, 25)
  R.targets.crowdedCount = crowded.length

  // ── 2. horizontal overflow: find the SOURCE, not the symptom ──
  const docW = document.documentElement.clientWidth
  const offenders = []
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    if (s.position === 'fixed') continue
    const overhang = +(r.right - docW).toFixed(1)
    if (overhang > 1 || r.left < -1) {
      offenders.push({
        sel: sel(el), right: +r.right.toFixed(1), left: +r.left.toFixed(1), width: +r.width.toFixed(1),
        overhang, docW,
        clippedByAncestor: (() => {
          let p = el.parentElement
          while (p && p !== document.body) {
            const ps = getComputedStyle(p)
            if (/hidden|clip|auto|scroll/.test(ps.overflowX)) return ps.overflowX
            p = p.parentElement
          }
          return null
        })(),
      })
    }
  }
  // Only the outermost offenders matter — a child inherits its parent's overflow.
  R.overflow = {
    documentScrollWidth: document.documentElement.scrollWidth,
    documentClientWidth: docW,
    pageScrollsHorizontally: document.documentElement.scrollWidth > docW + 1,
    offenderCount: offenders.length,
    unclippedOffenders: offenders.filter((o) => !o.clippedByAncestor).slice(0, 20),
    topOffenders: offenders.sort((a, b) => b.overhang - a.overhang).slice(0, 15),
  }

  // ── 3. heading hierarchy and landmarks ──
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(vis).map((h) => ({
    level: +h.tagName[1], text: (h.innerText || '').trim().slice(0, 70),
    size: getComputedStyle(h).fontSize, weight: getComputedStyle(h).fontWeight,
  }))
  const skips = []
  for (let i = 1; i < headings.length; i++) {
    if (headings[i].level - headings[i - 1].level > 1) skips.push(`h${headings[i - 1].level} → h${headings[i].level} at "${headings[i].text}"`)
  }
  R.structure = {
    headings,
    h1Count: headings.filter((h) => h.level === 1).length,
    levelSkips: skips,
    landmarks: {
      main: document.querySelectorAll('main, [role="main"]').length,
      nav: document.querySelectorAll('nav, [role="navigation"]').length,
      header: document.querySelectorAll('header, [role="banner"]').length,
      footer: document.querySelectorAll('footer, [role="contentinfo"]').length,
    },
    lang: document.documentElement.lang,
    title: document.title,
  }

  // ── 4. contrast of the pairs actually rendered ──
  const srgb = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const lum = ([r, g, b]) => 0.2126 * srgb(r / 255) + 0.7152 * srgb(g / 255) + 0.0722 * srgb(b / 255)
  const parse = (s) => {
    const m = s.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
    return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 }
  }
  const effectiveBg = (el) => {
    let n = el
    let acc = null
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor)
      if (c && c.a > 0) {
        if (c.a >= 1) return acc ? blend(acc, c.rgb) : c.rgb
        acc = acc ? acc : null
        // approximate: composite this translucent layer over what is behind it
        const behind = effectiveBgFrom(n.parentElement)
        return c.rgb.map((v, i) => v * c.a + behind[i] * (1 - c.a))
      }
      n = n.parentElement
    }
    return [255, 255, 255]
  }
  const effectiveBgFrom = (el) => {
    let n = el
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor)
      if (c && c.a >= 1) return c.rgb
      n = n.parentElement
    }
    return [255, 255, 255]
  }
  const blend = (a, b) => b
  const ratio = (fg, bg) => {
    const l1 = lum(fg), l2 = lum(bg)
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
    return +((hi + 0.05) / (lo + 0.05)).toFixed(2)
  }

  const seen = new Map()
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)
    if (!own) continue
    const s = getComputedStyle(el)
    const fg = parse(s.color)
    if (!fg) continue
    const bg = effectiveBg(el)
    const px = parseFloat(s.fontSize)
    const bold = parseInt(s.fontWeight, 10) >= 700
    const isLarge = px >= 24 || (px >= 18.66 && bold)
    const rr = ratio(fg.rgb, bg)
    const key = `${s.color}|${bg.join(',')}|${Math.round(px)}|${isLarge}`
    if (!seen.has(key)) {
      seen.set(key, {
        color: s.color, bgRgb: `rgb(${bg.map(Math.round).join(', ')})`, fontSizePx: px,
        fontWeight: s.fontWeight, isLargeText: isLarge, ratio: rr,
        required: isLarge ? 3 : 4.5, passes: rr >= (isLarge ? 3 : 4.5),
        count: 0, sample: '', sel: sel(el),
      })
    }
    const e = seen.get(key)
    e.count++
    if (!e.sample) e.sample = (el.innerText || '').trim().slice(0, 60)
  }
  const pairs = [...seen.values()].sort((a, b) => a.ratio - b.ratio)
  R.contrast = { distinctPairs: pairs.length, failing: pairs.filter((p) => !p.passes), all: pairs }

  // ── 5. images without intrinsic sizing (CLS risk) ──
  R.images = [...document.querySelectorAll('img')].filter(vis).map((img) => ({
    src: (img.currentSrc || img.src || '').split('/').pop()?.slice(0, 60),
    hasWidthAttr: img.hasAttribute('width'), hasHeightAttr: img.hasAttribute('height'),
    loading: img.getAttribute('loading'), decoding: img.getAttribute('decoding'),
    alt: img.getAttribute('alt'), hasAlt: img.hasAttribute('alt'),
  }))

  // ── 6. form controls: type / inputmode / autocomplete ──
  R.formControls = [...document.querySelectorAll('input, textarea, select')].filter(vis).map((el) => ({
    tag: el.tagName.toLowerCase(), type: el.getAttribute('type'),
    inputmode: el.getAttribute('inputmode'), autocomplete: el.getAttribute('autocomplete'),
    name: accName(el), hasLabel: !accName(el).startsWith('(placeholder only)') && !!accName(el),
    describedBy: el.getAttribute('aria-describedby'), required: el.hasAttribute('required'),
    fontSizePx: parseFloat(getComputedStyle(el).fontSize),
  }))

  // ── 7. live regions ──
  R.liveRegions = [...document.querySelectorAll('[aria-live], [role="status"], [role="alert"], [role="log"]')].map((el) => ({
    sel: sel(el), live: el.getAttribute('aria-live'), role: el.getAttribute('role'), atomic: el.getAttribute('aria-atomic'),
  }))

  // ── 8. line length of running text ──
  R.lineLength = [...document.querySelectorAll('p, li')].filter(vis).map((el) => {
    const txt = (el.innerText || '').trim()
    if (txt.length < 40) return null
    const s = getComputedStyle(el)
    const px = parseFloat(s.fontSize)
    const width = el.getBoundingClientRect().width
    // ~0.5em average advance for a humanist sans at these sizes.
    const chars = Math.round(width / (px * 0.5))
    return { chars, widthPx: +width.toFixed(0), fontSizePx: px, sample: txt.slice(0, 50) }
  }).filter(Boolean).sort((a, b) => b.chars - a.chars).slice(0, 12)

  return R
}

// ─── runner ─────────────────────────────────────────────────────────────────

const results = { generatedAt: new Date().toISOString(), base: BASE, set: SET, routes: {} }

const browser = await chromium.launch()

async function login(context) {
  if (!EMAIL || !PASSWORD) return false
  const page = await context.newPage()
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[type="email"], input[name="email"]', EMAIL)
  await page.fill('input[type="password"], input[name="password"]', PASSWORD)
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/auth/login'), { timeout: 20000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ])
  const ok = !page.url().includes('/auth/login')
  await page.close()
  return ok
}

for (const mode of ['data', 'reduced-motion', 'dark-os']) {
  if (mode !== 'data' && !has('modes')) continue
  for (const route of ROUTES) {
    const viewports = route.full ? VIEWPORTS : CORE_FIVE.map((i) => VIEWPORTS[i])
    for (const vp of viewports) {
      const context = await browser.newContext({
        viewport: { width: vp.w, height: vp.h },
        deviceScaleFactor: 1,
        reducedMotion: mode === 'reduced-motion' ? 'reduce' : 'no-preference',
        colorScheme: mode === 'dark-os' ? 'dark' : 'light',
      })
      if (MOCK) await installMockApi(context, { dataset: DATASET, latencyMs: LATENCY, failWith: FAIL_WITH })
      else if (SET !== 'public') await login(context)
      const page = await context.newPage()

      // Core Web Vitals collectors must be installed before navigation.
      await page.addInitScript(() => {
        window.__vitals = { lcp: null, lcpElement: null, cls: 0, shifts: [] }
        try {
          new PerformanceObserver((l) => {
            const e = l.getEntries().at(-1)
            if (e) { window.__vitals.lcp = e.startTime; window.__vitals.lcpElement = e.element ? (e.element.tagName + (e.element.className ? '.' + String(e.element.className).split(' ')[0] : '')) : e.url || 'unknown' }
          }).observe({ type: 'largest-contentful-paint', buffered: true })
          new PerformanceObserver((l) => {
            for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__vitals.cls += e.value; window.__vitals.shifts.push(+e.value.toFixed(4)) }
          }).observe({ type: 'layout-shift', buffered: true })
        } catch {}
      })

      const consoleErrors = []
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)) })

      const t0 = Date.now()
      let status = null
      try {
        const resp = await page.goto(BASE + route.path, { waitUntil: 'domcontentloaded', timeout: 30000 })
        status = resp?.status() ?? null
        // The dev server's HMR socket never lets the page reach networkidle.
        await page.waitForTimeout(1800)
      } catch (e) {
        results.routes[`${route.name}@${vp.w}`] = { error: String(e).slice(0, 200) }
        await context.close()
        continue
      }
      const loadMs = Date.now() - t0
      const finalUrl = page.url()

      const dsTag = MOCK && DATASET !== 'rich' ? `-${DATASET}` : ''
      const suffix = (mode === 'data' ? '' : `-${mode}`) + dsTag
      const file = path.join(OUT_SHOTS, `${route.name}-${vp.w}${suffix}.png`)
      await page.screenshot({ path: file, fullPage: true }).catch(() => null)

      let probe = null
      try { probe = await page.evaluate(PROBE) } catch (e) { probe = { probeError: String(e).slice(0, 300) } }
      const vitals = await page.evaluate(() => window.__vitals).catch(() => null)

      // tab order — only worth measuring once per route, at the desktop width
      let tabOrder = null
      if (vp.w === 1440 && mode === 'data') {
        tabOrder = []
        for (let i = 0; i < 40; i++) {
          await page.keyboard.press('Tab')
          const info = await page.evaluate(() => {
            const el = document.activeElement
            if (!el || el === document.body) return null
            const r = el.getBoundingClientRect()
            const s = getComputedStyle(el)
            return {
              tag: el.tagName.toLowerCase(),
              name: (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || '').trim().slice(0, 40),
              y: Math.round(r.y), x: Math.round(r.x),
              outline: s.outlineStyle === 'none' ? 'none' : `${s.outlineWidth} ${s.outlineColor}`,
              visible: r.width > 0 && r.height > 0,
            }
          })
          if (!info) break
          tabOrder.push(info)
        }
      }

      results.routes[`${route.name}@${vp.w}${suffix}`] = {
        route: route.path, viewport: `${vp.w}x${vp.h}`, viewportLabel: vp.label, mode,
        httpStatus: status, finalUrl, redirected: !finalUrl.endsWith(route.path), loadMs,
        screenshot: path.relative('docs/ui-audit', file).replace(/\\/g, '/'),
        vitals, consoleErrors: consoleErrors.slice(0, 8), tabOrder, ...probe,
      }

      console.log(`${route.name.padEnd(22)} ${String(vp.w).padStart(4)}  ${mode.padEnd(14)} ${status}  ${loadMs}ms  targets<44:${probe?.targets?.under44?.length ?? '?'}  overflow:${probe?.overflow?.pageScrollsHorizontally ? 'YES' : 'no'}  contrastFail:${probe?.contrast?.failing?.length ?? '?'}`)

      await context.close()
    }
  }
}

await browser.close()
fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true })
fs.writeFileSync(OUT_JSON, JSON.stringify(results, null, 2))
console.log(`\nwritten: ${OUT_JSON}`)
console.log(`shots:   ${OUT_SHOTS}`)
