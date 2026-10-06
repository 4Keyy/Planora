"use client"

import { ReactNode, RefObject, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { useExitPresence } from "@/hooks/use-exit-presence"
import { useDismissHiddenAnchor } from "@/hooks/use-dismiss-hidden-anchor"
import { useFixedPopoverPosition } from "@/hooks/use-fixed-popover-position"
import { tokens } from "@/lib/design-tokens"
import { cn } from "@/lib/utils"

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

/** The floating sheet itself, the same in both rendering modes. */
const SURFACE_STYLE = {
  background: "var(--pl-paper)",
  borderRadius: "var(--pl-radius-lg)",
  border: "1px solid var(--pl-line)",
  boxShadow: "var(--pl-shadow-lg)",
} as const

/**
 * A dropdown anchored to its trigger. It unfolds out of the trigger and folds back into it
 * with the product's shared surface motion (`.dropdown-surface` in globals.css), kept
 * mounted through the fold by {@link useExitPresence}. It used to animate with a
 * framer-motion spring, and every opening ended with a blink: the spring overshot and
 * settled in two waves, and framer's hand-off from the Web Animations API left the sheet
 * at its starting `opacity: 0` for a frame — see the hook for the measurements.
 */
export function Popover({ open, onClose, children, width = 300, align = "left", containerRef, portal = false }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { mounted, presenceProps } = useExitPresence(open)
  useDismissHiddenAnchor(open, containerRef, onClose)
  const pos = useFixedPopoverPosition(portal && open, containerRef, ref, width, align)

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

  // ── Portal (viewport-fixed) mode — never grows the document, flips + caps to fit ──
  if (portal) {
    if (typeof document === "undefined" || !mounted || !pos) return null
    return createPortal(
      <div
        ref={ref}
        role="dialog"
        {...presenceProps}
        className={cn("dropdown-surface", pos.above && "dropdown-above")}
        style={{
          position: "fixed",
          left: pos.left,
          top: pos.top,
          bottom: pos.bottom,
          width: pos.width,
          maxHeight: pos.maxHeight,
          overflowY: "auto",
          zIndex: tokens.layer.popover,
          transformOrigin: pos.transformOrigin,
          ...SURFACE_STYLE,
        }}
      >
        {children}
      </div>,
      document.body,
    )
  }

  // ── In-flow (absolute) mode. Positioning lives on the (static) wrapper, so the surface
  // inside it owns its transform for the unfold on open and the fold on close. ──
  if (!mounted) return null

  const alignStyle: React.CSSProperties =
    align === "right"  ? { right: 0 } :
    align === "center" ? { left: "50%", transform: "translateX(-50%)" } :
    { left: 0 }

  return (
    <div style={{ position: "absolute", top: "calc(100% + 8px)", zIndex: tokens.layer.popover, ...alignStyle }}>
      <div
        ref={ref}
        role="dialog"
        {...presenceProps}
        className="dropdown-surface"
        style={{
          width,
          transformOrigin: align === "right" ? "top right" : align === "center" ? "top center" : "top left",
          overflow: "hidden",
          ...SURFACE_STYLE,
        }}
      >
        {children}
      </div>
    </div>
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
      borderBottom: "1px solid var(--pl-gray-100)",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    }}>
      <span style={{
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: "var(--pl-ink-subtle)",
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
