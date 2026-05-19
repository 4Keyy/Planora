"use client"

import { ReactNode, RefObject, useEffect, useRef } from "react"

interface PopoverProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  width?: number
  align?: "left" | "right" | "center"
  /** Ref to the containing wrapper — clicks inside it don't trigger close. */
  containerRef?: RefObject<HTMLElement | null>
}

export function Popover({ open, onClose, children, width = 300, align = "left", containerRef }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

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

  if (!open) return null

  const alignStyle: React.CSSProperties =
    align === "right"  ? { right: 0 } :
    align === "center" ? { left: "50%", transform: "translateX(-50%)" } :
    { left: 0 }

  return (
    <div
      ref={ref}
      role="dialog"
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        ...alignStyle,
        width,
        zIndex: 50,
        background: "white",
        borderRadius: 16,
        border: "1px solid #f0f0f0",
        boxShadow: "0 16px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.05)",
        overflow: "hidden",
        animation: "pop_in 180ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
      }}
    >
      {children}
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
