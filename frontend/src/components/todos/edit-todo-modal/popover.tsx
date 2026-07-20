"use client"

import { ReactNode, RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"

interface PopoverProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  width?: number
  align?: "left" | "right" | "center"
  /** Ref to the containing wrapper — clicks inside it don't trigger close. */
  containerRef?: RefObject<HTMLElement | null>
  /**
   * Render into a `document.body` portal with viewport-**fixed** positioning instead of an
   * absolutely-positioned in-flow child.
   *
   * A fixed/portaled popover never contributes to the document's scroll height, so opening it
   * can never stretch the page and closing it can never snap it back — and it flips above the
   * trigger + caps its height to stay within the viewport. Use this in normal page flow (the
   * create-task panel on `/tasks` and the dashboard sidebar), where an in-flow popover would
   * otherwise grow the page. The default (`false`) keeps the in-flow absolute popover used
   * inside the scrollable edit modal, where the popover must scroll *with* the modal body.
   */
  portal?: boolean
}

type FixedPos = {
  left: number
  top?: number
  bottom?: number
  maxHeight: number
  transformOrigin: string
}

/** Position a fixed popover against the trigger rect, flipping up + capping height to fit the viewport. */
function computeFixedPos(rect: DOMRect, width: number, align: "left" | "right" | "center"): FixedPos {
  const GAP = 8
  const MARGIN = 8
  const vw = window.innerWidth || 1024
  const vh = window.innerHeight || 768

  let left =
    align === "right" ? rect.right - width :
    align === "center" ? rect.left + rect.width / 2 - width / 2 :
    rect.left
  // Never let the panel spill off either edge of the viewport.
  left = Math.min(Math.max(left, MARGIN), Math.max(MARGIN, vw - width - MARGIN))

  const spaceBelow = vh - rect.bottom - GAP
  const spaceAbove = rect.top - GAP
  // Prefer opening downward; flip up only when below is cramped and above genuinely roomier.
  const openUp = spaceBelow < 300 && spaceAbove > spaceBelow
  const originX = align === "right" ? "right" : align === "center" ? "center" : "left"

  if (openUp) {
    return {
      left,
      bottom: vh - rect.top + GAP,
      maxHeight: Math.max(spaceAbove - MARGIN, 160),
      transformOrigin: `bottom ${originX}`,
    }
  }
  return {
    left,
    top: rect.bottom + GAP,
    maxHeight: Math.max(spaceBelow - MARGIN, 160),
    transformOrigin: `top ${originX}`,
  }
}

export function Popover({ open, onClose, children, width = 300, align = "left", containerRef, portal = false }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<FixedPos | null>(null)

  // Outside-click + Escape — shared by both rendering modes.
  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (containerRef?.current?.contains(t)) return
      if (ref.current?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("mousedown", onMouseDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onMouseDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open, onClose, containerRef])

  // Portal mode: recompute the fixed position from the trigger rect on open, and keep the
  // popover glued to the trigger while the page/modal scrolls or the window resizes.
  const reposition = useCallback(() => {
    const anchor = containerRef?.current
    if (!anchor) return
    setPos(computeFixedPos(anchor.getBoundingClientRect(), width, align))
  }, [containerRef, width, align])

  useLayoutEffect(() => {
    if (!portal || !open) return
    reposition()
    // Capture-phase scroll so nested scroll containers (e.g. the modal body) also reposition.
    window.addEventListener("scroll", reposition, true)
    window.addEventListener("resize", reposition)
    return () => {
      window.removeEventListener("scroll", reposition, true)
      window.removeEventListener("resize", reposition)
    }
  }, [portal, open, reposition])

  // ── Portal (viewport-fixed) mode — never grows the document, flips + caps to fit ──
  if (portal) {
    if (typeof document === "undefined") return null
    return createPortal(
      <AnimatePresence>
        {open && pos && (
          <motion.div
            ref={ref}
            role="dialog"
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.7 }}
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              bottom: pos.bottom,
              width,
              maxHeight: pos.maxHeight,
              overflowY: "auto",
              zIndex: 3000,
              transformOrigin: pos.transformOrigin,
              background: "white",
              borderRadius: 16,
              border: "1px solid #f0f0f0",
              boxShadow: "0 16px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.05)",
            }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>,
      document.body,
    )
  }

  // ── In-flow (absolute) mode — unchanged. Positioning lives on the (static) wrapper so the
  // motion.div can own its transform for a clean scale/fade/slide on BOTH open and close. ──
  const alignStyle: React.CSSProperties =
    align === "right"  ? { right: 0 } :
    align === "center" ? { left: "50%", transform: "translateX(-50%)" } :
    { left: 0 }

  return (
    <AnimatePresence>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 8px)", zIndex: 50, ...alignStyle }}>
          <motion.div
            ref={ref}
            role="dialog"
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.7 }}
            style={{
              width,
              transformOrigin: align === "right" ? "top right" : align === "center" ? "top center" : "top left",
              background: "white",
              borderRadius: 16,
              border: "1px solid #f0f0f0",
              boxShadow: "0 16px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.05)",
              overflow: "hidden",
            }}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

// Shared popover header used by all 4 popovers
interface PopoverHeaderProps {
  label: string
  sub?: ReactNode
  action?: ReactNode
}

export function PopoverHeader({ label, sub, action }: PopoverHeaderProps) {
  return (
    <div style={{
      padding: "12px 14px 8px",
      borderBottom: "1px solid #f5f5f5",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    }}>
      <span style={{
        fontSize: 10,
        fontWeight: 900,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "#a3a3a3",
      }}>
        {label}
      </span>
      {(sub !== undefined || action !== undefined) && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {sub}
          {action}
        </div>
      )}
    </div>
  )
}
