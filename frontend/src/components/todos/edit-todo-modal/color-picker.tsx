"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CATEGORY_COLOR_SWATCHES } from "./utils"

// ── Color math ───────────────────────────────────────────────────────────────

function hsvToHex(h: number, s: number, v: number): string {
  const hh = h / 360
  const i  = Math.floor(hh * 6)
  const f  = hh * 6 - i
  const p  = v * (1 - s)
  const q  = v * (1 - f * s)
  const t  = v * (1 - (1 - f) * s)
  let r: number, g: number, b: number
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break
    case 1: r = q; g = v; b = p; break
    case 2: r = p; g = v; b = t; break
    case 3: r = p; g = q; b = v; break
    case 4: r = t; g = p; b = v; break
    default: r = v; g = p; b = q
  }
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0")
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

function hexToHsv(hex: string): [number, number, number] {
  const clean = hex.replace("#", "")
  if (clean.length !== 6) return [210, 0.8, 0.9]
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  const max  = Math.max(r, g, b)
  const min  = Math.min(r, g, b)
  const diff = max - min
  let h = 0
  if (diff > 0) {
    if (max === r)      h = ((g - b) / diff + 6) % 6
    else if (max === g) h = (b - r) / diff + 2
    else                h = (r - g) / diff + 4
    h *= 60
  }
  return [h, max === 0 ? 0 : diff / max, max]
}

function isValidHex(hex: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(hex)
}

// ── Component ────────────────────────────────────────────────────────────────

interface ColorPickerProps {
  value: string        // hex like "#0ea5e9"
  onChange: (hex: string) => void
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const [hue, setHue]           = useState(210)
  const [sat, setSat]           = useState(0.8)
  const [bri, setBri]           = useState(0.9)
  const [hexInput, setHexInput] = useState(value)

  const canvasRef = useRef<HTMLDivElement>(null)
  const dragging  = useRef(false)

  // Sync incoming value → internal HSV (only on external change)
  useEffect(() => {
    if (!isValidHex(value)) return
    const [h, s, v] = hexToHsv(value)
    setHue(Math.round(h))
    setSat(s)
    setBri(v)
    setHexInput(value)
  }, [value])

  const emitColor = useCallback((h: number, s: number, v: number) => {
    const hex = hsvToHex(h, s, v)
    setHexInput(hex)
    onChange(hex)
  }, [onChange])

  // 2-D canvas pointer handling
  const updateFromCanvas = useCallback((e: PointerEvent | React.PointerEvent) => {
    const el = canvasRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left)  / rect.width))
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top)   / rect.height))
    const newSat = x
    const newBri = 1 - y
    setSat(newSat)
    setBri(newBri)
    emitColor(hue, newSat, newBri)
  }, [hue, emitColor])

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    updateFromCanvas(e)
  }
  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    updateFromCanvas(e)
  }
  const handleCanvasPointerUp = () => { dragging.current = false }

  // Hue slider
  const handleHueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const h = Number(e.target.value)
    setHue(h)
    emitColor(h, sat, bri)
  }

  // Hex input (value arrives without the leading "#" because the input strips it)
  const handleHexInput = (rawWithoutHash: string) => {
    const raw = "#" + rawWithoutHash
    setHexInput(raw)
    if (isValidHex(raw)) {
      const [h, s, v] = hexToHsv(raw)
      setHue(Math.round(h))
      setSat(s)
      setBri(v)
      onChange(raw)
    }
  }

  const previewHex  = hsvToHex(hue, sat, bri)
  const pureHueHex  = hsvToHex(hue, 1, 1)
  const selectorX   = sat * 100
  const selectorY   = (1 - bri) * 100

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

      {/* ── 2-D Saturation / Brightness canvas ── */}
      <div
        ref={canvasRef}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerLeave={handleCanvasPointerUp}
        style={{
          position: "relative",
          height: 148,
          borderRadius: 10,
          overflow: "hidden",
          cursor: "crosshair",
          userSelect: "none",
          touchAction: "none",
        }}
      >
        {/* Layer 1: white → hue color */}
        <div style={{
          position: "absolute", inset: 0,
          background: `linear-gradient(to right, #ffffff, ${pureHueHex})`,
        }} />
        {/* Layer 2: transparent → black */}
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(to bottom, transparent, #000000)",
        }} />
        {/* Selector circle */}
        <div
          style={{
            position: "absolute",
            left: `${selectorX}%`,
            top:  `${selectorY}%`,
            transform: "translate(-50%, -50%)",
            width: 16,
            height: 16,
            borderRadius: "50%",
            border: "2px solid white",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.3), 0 2px 6px rgba(0,0,0,0.25)",
            pointerEvents: "none",
            background: previewHex,
          }}
        />
      </div>

      {/* ── Hue slider ── */}
      <div style={{ position: "relative", height: 14 }}>
        {/* Rainbow strip */}
        <div style={{
          position: "absolute", inset: 0, borderRadius: 7,
          background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
        }} />
        {/* Thumb */}
        <div style={{
          position: "absolute",
          left: `${(hue / 360) * 100}%`,
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: pureHueHex,
          border: "2px solid white",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.15), 0 2px 6px rgba(0,0,0,0.2)",
          pointerEvents: "none",
          zIndex: 1,
        }} />
        {/* Invisible range input for interaction */}
        <input
          type="range"
          min="0"
          max="360"
          value={hue}
          onChange={handleHueChange}
          style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%",
            opacity: 0, cursor: "pointer", margin: 0,
          }}
        />
      </div>

      {/* ── Preview + hex input row ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Color preview chip */}
        <div style={{
          width: 32, height: 32,
          borderRadius: 8,
          background: previewHex,
          border: "1px solid rgba(0,0,0,0.1)",
          flexShrink: 0,
          boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
        }} />
        {/* Hex input */}
        <div style={{
          flex: 1, display: "flex", alignItems: "center",
          background: "#f5f5f5", borderRadius: 8, padding: "0 10px",
          border: "1px solid #eaeaea",
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#a3a3a3", marginRight: 2 }}>#</span>
          <input
            value={hexInput.replace("#", "")}
            onChange={(e) => handleHexInput(e.target.value)}
            maxLength={6}
            spellCheck={false}
            style={{
              flex: 1, border: "none", background: "transparent",
              fontSize: 12, fontWeight: 700, color: "#262626",
              outline: "none", fontFamily: "monospace", letterSpacing: "0.04em",
              padding: "8px 0",
            }}
          />
        </div>
      </div>

      {/* ── Preset swatches ── */}
      <div>
        <div style={{
          fontSize: 9, fontWeight: 900, letterSpacing: "0.14em",
          textTransform: "uppercase", color: "#a3a3a3", marginBottom: 7,
        }}>
          Presets
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {CATEGORY_COLOR_SWATCHES.map((c) => {
            const isActive = value.toLowerCase() === c.toLowerCase()
            return (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                onClick={() => onChange(c)}
                style={{
                  width: 22, height: 22,
                  borderRadius: "50%",
                  border: "none",
                  cursor: "pointer",
                  background: c,
                  flexShrink: 0,
                  boxShadow: isActive
                    ? `0 0 0 2px white, 0 0 0 3.5px ${c}`
                    : "0 1px 3px rgba(0,0,0,0.18)",
                  transform: isActive ? "scale(1.15)" : "scale(1)",
                  transition: "box-shadow 100ms, transform 100ms",
                }}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
