"use client"

import { RefObject } from "react"
import { Popover, PopoverHeader } from "../popover"
import { PRIORITY_LEVELS } from "../utils"

interface PriorityPopoverProps {
  open: boolean
  onClose: () => void
  value: string
  onChange: (key: string) => void
  containerRef: RefObject<HTMLElement | null>
}

export function PriorityPopover({ open, onClose, value, onChange, containerRef }: PriorityPopoverProps) {
  const handleSelect = (key: string) => {
    onChange(key)
    onClose()
  }

  return (
    <Popover open={open} onClose={onClose} width={300} containerRef={containerRef}>
      <PopoverHeader label="Приоритет" />
      <div style={{ padding: 6 }}>
        {PRIORITY_LEVELS.map((p, i) => {
          const isActive = value === p.key
          return (
            <button
              key={p.key}
              onClick={() => handleSelect(p.key)}
              onKeyDown={(e) => {
                if (e.key === String(i + 1)) handleSelect(p.key)
              }}
              aria-label={`Приоритет ${p.label}`}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px",
                borderRadius: 11,
                border: "none",
                cursor: "pointer",
                background: isActive ? "#0a0a0a" : "transparent",
                transition: "background 120ms",
                textAlign: "left",
              }}
              onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "#fafafa" }}
              onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
            >
              {/* Intensity bars */}
              <div style={{ display: "flex", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                {Array.from({ length: 5 }).map((_, barIdx) => {
                  const filled = barIdx <= i
                  return (
                    <div
                      key={barIdx}
                      style={{
                        width: 3,
                        height: 14,
                        borderRadius: 2,
                        background: isActive
                          ? (filled ? "white" : "rgba(255,255,255,0.22)")
                          : (filled ? p.color : "#eaeaea"),
                        transition: "background 120ms",
                      }}
                    />
                  )
                })}
              </div>

              {/* Label + desc */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13,
                  fontWeight: 900,
                  letterSpacing: "-0.01em",
                  color: isActive ? "white" : "#0a0a0a",
                  lineHeight: 1.2,
                }}>
                  {p.label}
                </div>
                <div style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: isActive ? "rgba(255,255,255,0.55)" : "#a3a3a3",
                  marginTop: 2,
                }}>
                  {p.desc}
                </div>
              </div>

              {/* Check mark */}
              {isActive && (
                <span style={{ fontSize: 12, color: "white", flexShrink: 0 }}>✓</span>
              )}
            </button>
          )
        })}
      </div>
    </Popover>
  )
}
