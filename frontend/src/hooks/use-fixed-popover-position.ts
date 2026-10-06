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

/** The shared portal positioning, including the space available on a small or zoomed viewport. */
export function useFixedPopoverPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null> | undefined,
  panelRef: RefObject<HTMLElement | null>,
  requestedWidth: number,
  align: Alignment,
  margin = 8,
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
    const desiredHeight = panelRef.current?.scrollHeight || 300
    const openUp = below < desiredHeight && above > below
    const originX = align === "right" ? "right" : align === "center" ? "center" : "left"
    const next: FixedPosition = {
      left, width, above: openUp,
      ...(openUp ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }),
      maxHeight: openUp ? above : below,
      transformOrigin: `${openUp ? "bottom" : "top"} ${originX}`,
    }
    setPosition((old) => old && old.left === next.left && old.top === next.top && old.bottom === next.bottom &&
      old.width === next.width && old.maxHeight === next.maxHeight && old.transformOrigin === next.transformOrigin ? old : next)
  }, [anchorRef, panelRef, requestedWidth, align, margin])

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
    return () => {
      window.removeEventListener("scroll", reposition, true)
      window.removeEventListener("resize", reposition)
      window.visualViewport?.removeEventListener("resize", reposition)
      window.visualViewport?.removeEventListener("scroll", reposition)
      observer?.disconnect()
    }
  }, [open, positioned, reposition, anchorRef, panelRef])

  return position
}
