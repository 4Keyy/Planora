#!/usr/bin/env node
/**
 * lcp-probe.mjs — explain an LCP number instead of just reporting it.
 *
 * live-scan.mjs records the final LCP entry and its element. When that number is bimodal
 * (the same code measuring 500 ms on one run and 3,500 ms on the next) the final entry alone
 * cannot say why. This probe loads one route and prints, on one timeline:
 *
 *   • every largest-contentful-paint entry, not just the last (a web font swapping in makes
 *     the same element report again, later);
 *   • when each font file finished arriving;
 *   • every long task over 50 ms on the main thread (a busy main thread delays paints);
 *   • the largest scripts and when they finished;
 *   • every layout shift with its sources — which element moved, from where to where.
 *
 *   node docs/ui-audit/tools/lcp-probe.mjs --base http://127.0.0.1:3200 --path / --width 1440 --runs 3
 *
 * It uses the same signed-out mock as live-scan (`--anon`), so the numbers are comparable.
 * Read-only; writes nothing.
 */
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const { chromium } = createRequire(path.resolve(HERE, '../../../frontend/package.json'))('playwright')
const { installMockApi } = await import(new URL('./mock-api.mjs', import.meta.url))

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1] }
const BASE = arg('base', 'http://127.0.0.1:3200')
const ROUTE = arg('path', '/')
const WIDTH = Number(arg('width', '1440'))
const HEIGHT = Number(arg('height', String(Math.round(WIDTH * 0.5625) || 900)))
const RUNS = Number(arg('runs', '3'))

const browser = await chromium.launch()
for (let run = 1; run <= RUNS; run++) {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } })
  await installMockApi(context, { dataset: 'rich', anon: true })
  await context.addInitScript(() => {
    window.__probe = { lcp: [], long: [], shifts: [] }
    const describe = (n) => {
      if (!n || !n.tagName) return String(n && n.nodeName)
      const cls = String(n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className || '')
      return n.tagName + (cls ? '.' + cls.split(' ').slice(0, 3).join('.') : '') + ' "' + (n.textContent || '').trim().slice(0, 24) + '"'
    }
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.hadRecentInput) continue
        window.__probe.shifts.push({
          t: Math.round(e.startTime),
          v: Number(e.value.toFixed(4)),
          src: (e.sources || []).map((s) => ({
            n: describe(s.node),
            from: [Math.round(s.previousRect.y), Math.round(s.previousRect.height)],
            to: [Math.round(s.currentRect.y), Math.round(s.currentRect.height)],
          })),
        })
      }
    }).observe({ type: 'layout-shift', buffered: true })
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        window.__probe.lcp.push({
          t: Math.round(e.startTime),
          el: e.element ? e.element.tagName + '.' + String(e.element.className).split(' ')[0] : e.url,
          size: Math.round(e.size),
        })
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true })
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__probe.long.push({ t: Math.round(e.startTime), d: Math.round(e.duration) })
    }).observe({ type: 'longtask', buffered: true })
  })
  const page = await context.newPage()
  await page.goto(BASE + ROUTE, { waitUntil: 'load' })
  await page.waitForTimeout(4000)
  const out = await page.evaluate(() => {
    const res = performance.getEntriesByType('resource')
    const fonts = res
      .filter((e) => /\.woff2?($|\?)/.test(e.name))
      .map((e) => ({ f: e.name.split('/').pop().replace(/\.[a-z0-9]+\.woff2?$/, ''), end: Math.round(e.responseEnd) }))
    const scripts = res
      .filter((e) => e.initiatorType === 'script' || /\.js($|\?)/.test(e.name))
      .sort((a, b) => b.encodedBodySize - a.encodedBodySize)
      .slice(0, 6)
      .map((e) => ({ s: e.name.split('/').pop().slice(0, 28), kb: Math.round(e.encodedBodySize / 1024), end: Math.round(e.responseEnd) }))
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]
    return {
      fcp: fcp ? Math.round(fcp.startTime) : null,
      load: Math.round(performance.getEntriesByType('navigation')[0].loadEventEnd),
      lcp: window.__probe.lcp,
      long: window.__probe.long,
      shifts: window.__probe.shifts,
      fonts,
      scripts,
      fontsReady: document.fonts.status,
    }
  })
  console.log(`\n── run ${run} @${WIDTH}x${HEIGHT}  fcp=${out.fcp}  load=${out.load}`)
  console.log('  lcp entries :', out.lcp.map((e) => `${e.t}ms ${e.el} (${e.size})`).join('  →  '))
  console.log('  fonts done  :', out.fonts.map((f) => `${f.f}@${f.end}`).join(', '))
  console.log('  long tasks  :', out.long.map((l) => `${l.t}+${l.d}`).join(', ') || 'none')
  console.log('  top scripts :', out.scripts.map((s) => `${s.s} ${s.kb}KB@${s.end}`).join(', '))
  for (const sh of out.shifts) {
    console.log(`  shift ${sh.v} @${sh.t}ms:`, sh.src.map((x) => `${x.n} y${x.from[0]}→${x.to[0]} h${x.from[1]}→${x.to[1]}`).join(' | '))
  }
  await context.close()
}
await browser.close()
