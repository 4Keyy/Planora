"use client"

import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react"

type Alignment = "left" | "right" | "center"
type FixedPosition = {
  left: number
  top?: number
  bottom?: number
  width: number
  maxHeight: number
  transformOrigin: string
  above: boolean
}

/** Before its content has a height (the first pass, or jsdom), a sheet is taken to be this tall. */
const UNMEASURED_HEIGHT = 300

/**
 * The shared portal positioning, including the space available on a small or zoomed viewport.
 *
 * Where the sheet goes, in order:
 *
 * 1. **Below its trigger**, when all of it fits there.
 * 2. **Above it**, when all of it fits there instead.
 * 3. **Wherever all of it fits on the screen**, on the side with more room, slid towards the
 *    trigger until its far edge meets the viewport's margin — it may cover the trigger, as a
 *    native select does, and it unfolds from the trigger's height. A sheet used to take the
 *    roomier side and cap its height to it, so the 520px calendar under a field in the middle
 *    of a 900px screen sat in 400px with a scrollbar for good.
 * 4. Only a sheet taller than the whole viewport scrolls, and only by what does not fit.
 *
 * `contentRef` is what the sheet holds, measured at its own height: the sheet itself is capped
 * and clips, so it cannot say how tall it would like to be. Without it the sheet's `scrollHeight`
 * is used, as before.
 */
export function useFixedPopoverPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null> | undefined,
  panelRef: RefObject<HTMLElement | null>,
  requestedWidth: number,
  align: Alignment,
  margin = 8,
  contentRef?: RefObject<HTMLElement | null>,
) {
  const [position, setPosition] = useState<FixedPosition | null>(null)
  const reposition = useCallback(() => {
    const anchor = anchorRef?.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const viewport = window.visualViewport
    const vw = viewport?.width ?? window.innerWidth
    const vh = viewport?.height ?? window.innerHeight
    const vx = viewport?.offsetLeft ?? 0
    const vy = viewport?.offsetTop ?? 0
    // Keep the last on-screen position for the normal fold while the visibility observer closes it.
    if (rect.width > 0 && rect.height > 0 &&
      (rect.bottom <= vy || rect.top >= vy + vh || rect.right <= vx || rect.left >= vx + vw)) return
    const gap = 8
    const width = Math.min(requestedWidth, Math.max(0, vw - 2 * margin))
    let left = align === "right" ? rect.right - width :
      align === "center" ? rect.left + rect.width / 2 - width / 2 : rect.left
    left = Math.min(Math.max(left, vx + margin), Math.max(vx + margin, vx + vw - width - margin))

    const below = Math.max(0, vy + vh - rect.bottom - gap - margin)
    const above = Math.max(0, rect.top - vy - gap - margin)
    const screen = Math.max(0, vh - 2 * margin)
    // Layout heights (offsetHeight), never a rect: the sheet is mid-unfold, scaled, when measured.
    const panel = panelRef.current
    const content = contentRef?.current
    const frame = panel ? panel.offsetHeight - panel.clientHeight : 0
    const measured = content ? content.offsetHeight + frame : panel?.scrollHeight ?? 0
    const desiredHeight = measured > 0 ? measured : UNMEASURED_HEIGHT
    const originX = align === "right" ? "right" : align === "center" ? "center" : "left"

    let next: FixedPosition
    if (desiredHeight <= below) {
      next = { left, width, above: false, top: rect.bottom + gap, maxHeight: below, transformOrigin: `top ${originX}` }
    } else if (desiredHeight <= above) {
      next = { left, width, above: true, bottom: window.innerHeight - rect.top + gap, maxHeight: above, transformOrigin: `bottom ${originX}` }
    } else {
      // On the screen, whole — or the whole screen, for a sheet taller than it: laid over the
      // trigger from its near edge (its top, going down; its bottom, going up), as a native
      // select is, and slid further only as far as the viewport's margin needs. Never over just
      // a strip of it: a sliver of the trigger's frame peeking past the sheet read as a glitch.
      const openUp = above > below
      const shown = Math.min(desiredHeight, screen)
      const lowest = vy + vh - margin - shown
      const top = Math.max(vy + margin, Math.min(openUp ? rect.bottom - shown : rect.top, lowest))
      const pivot = Math.min(Math.max(rect.top + rect.height / 2 - top, 0), shown)
      next = { left, width, above: openUp, top, maxHeight: screen, transformOrigin: `${originX} ${Math.round(pivot)}px` }
    }
    setPosition((old) => old && old.left === next.left && old.top === next.top && old.bottom === next.bottom &&
      old.width === next.width && old.maxHeight === next.maxHeight && old.transformOrigin === next.transformOrigin &&
      old.above === next.above ? old : next)
  }, [anchorRef, panelRef, contentRef, requestedWidth, align, margin])

  // The portal attaches after the first positioning pass. Measure its natural content before paint.
  useLayoutEffect(() => { if (open) reposition() })
  // An initially open child can run its layout effect before its parent's anchor ref attaches.
  useEffect(() => { if (open) reposition() }, [open, reposition])
  const positioned = position !== null
  useLayoutEffect(() => {
    if (!open) return
    window.addEventListener("scroll", reposition, true)
    window.addEventListener("resize", reposition)
    window.visualViewport?.addEventListener("resize", reposition)
    window.visualViewport?.addEventListener("scroll", reposition)
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reposition)
    if (anchorRef?.current) observer?.observe(anchorRef.current)
    if (panelRef.current) observer?.observe(panelRef.current)
    // The content's own size: it changes inside a capped sheet that does not change with it.
    if (contentRef?.current) observer?.observe(contentRef.current)
    return () => {
      window.removeEventListener("scroll", reposition, true)
      window.removeEventListener("resize", reposition)
      window.visualViewport?.removeEventListener("resize", reposition)
      window.visualViewport?.removeEventListener("scroll", reposition)
      observer?.disconnect()
    }
  }, [open, positioned, reposition, anchorRef, panelRef, contentRef])

  return position
}
