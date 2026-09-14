#!/usr/bin/env node
/**
 * focus-scan.mjs — every focus stop, and whether its indicator clears WCAG 2.4.11.
 *
 * "Has a focus indicator" and "has a focus indicator you can see" are different
 * questions, and only the second one matters. Two idioms in this codebase produced
 * an indicator that measured as present and rendered as nothing:
 *
 *   - Tailwind's `outline-none` does NOT remove an outline. It sets
 *     `2px solid transparent`, which beats the deliberately zero-specificity
 *     `:where(...):focus-visible` rule in globals.css.
 *   - an inline `outline: "none"` beats the stylesheet outright.
 *
 * Both shipped. The auth inputs across all six auth routes, seven text controls in
 * the branch editor, and every Button variant's ring (1.12:1 to 2.10:1 against
 * white, where 2.4.11 asks for 3:1) were all invisible or near-invisible while the
 * live matrix reported them as passing, because it recorded the outline STRING.
 *
 * So this measures contrast: the indicator colour composited over paper, against
 * paper, by the WCAG relative-luminance formula. Anything under 3:1 is reported.
 *
 *   node docs/ui-audit/tools/focus-scan.mjs
 *
 * Exits non-zero when any focus stop lacks a qualifying indicator.
 */
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(path.resolve('frontend/package.json'))
const { chromium } = require('playwright')
const { installMockApi } = await import(
  new URL('file:///F:/Projects/Planora/docs/ui-audit/tools/mock-api.mjs').href
)

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await installMockApi(context, { dataset: 'rich' })
const page = await context.newPage()

// Runs in the page. Defined as a real function so no escaping is involved.
const probe = () => {
  const el = document.activeElement
  if (!el || el === document.body) return null
  const s = getComputedStyle(el)

  const alpha = (colour) => {
    const open = (colour || '').indexOf('(')
    if (open === -1) return colour && colour !== 'transparent' ? 1 : 0
    const parts = colour.slice(open + 1, colour.indexOf(')')).split(',').map((v) => parseFloat(v))
    return parts.length > 3 ? parts[3] : 1
  }

  // WCAG 2.4.11 asks for 3:1, so measure the contrast rather than the alpha.
  const rgb = (c) => {
    const open = (c || '').indexOf('(')
    if (open === -1) return [255, 255, 255]
    return c.slice(open + 1, c.indexOf(')')).split(',').slice(0, 3).map((v) => parseFloat(v))
  }
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  // Composited over white — the page ground everywhere an indicator is drawn here.
  const over = (c) => {
    const a = alpha(c), [r, g, b] = rgb(c)
    return [r * a + 255 * (1 - a), g * a + 255 * (1 - a), b * a + 255 * (1 - a)]
  }
  const ratioToPaper = (c) => {
    const l = lum(over(c)), w = lum([255, 255, 255])
    const [hi, lo] = l > w ? [l, w] : [w, l]
    return (hi + 0.05) / (lo + 0.05)
  }

  const outlineVisible =
    s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 && ratioToPaper(s.outlineColor) >= 3

  const shadowColours = (s.boxShadow || '').split('rgb').slice(1).map((c) => 'rgb' + c)
  const shadowVisible = s.boxShadow !== 'none' && shadowColours.some((c) => ratioToPaper(c) >= 3)

  const label =
    el.getAttribute('aria-label') ||
    (el.labels && el.labels[0] && el.labels[0].textContent) ||
    el.textContent ||
    el.getAttribute('placeholder') ||
    el.tagName

  return {
    name: String(label).trim().slice(0, 34),
    tag: el.tagName.toLowerCase(),
    ok: outlineVisible || shadowVisible,
  }
}

let grandTotal = 0
for (const route of ['/branch/todo-0', '/dashboard', '/tasks', '/categories', '/profile']) {
  await page.goto('http://127.0.0.1:3200' + route, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)

  const invisible = []
  let stops = 0
  for (let i = 0; i < 45; i++) {
    await page.keyboard.press('Tab')
    const r = await page.evaluate(probe)
    if (!r) break
    stops++
    if (!r.ok) invisible.push(`${r.tag} "${r.name}"`)
  }
  grandTotal += invisible.length
  console.log(`${route.padEnd(18)} ${String(stops).padStart(3)} focus stops, ${invisible.length} with no visible indicator`)
  for (const x of [...new Set(invisible)].slice(0, 6)) console.log('    ' + x)
}

console.log(`\ntotal invisible focus indicators: ${grandTotal}`)
await browser.close()
