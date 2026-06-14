"use client"

import { RefObject, useState } from "react"
import { Plus } from "lucide-react"
import { Popover, PopoverHeader } from "../popover"
import { CATEGORY_COLOR_SWATCHES } from "../utils"
import { ColorPicker } from "../color-picker"
import { ICON_MAP } from "@/lib/icon-map"
import { Category } from "@/types/category"
import { api, parseApiResponse, type ApiResponse } from "@/lib/api"

const iconList = Object.keys(ICON_MAP)

interface CategoryPopoverProps {
  open: boolean
  onClose: () => void
  value: string | null
  onChange: (id: string | null) => void
  categories: Category[]
  onCreateCategory: () => Promise<void>
  containerRef: RefObject<HTMLElement | null>
  canEdit: boolean
  /** Popover alignment under the trigger. Default "left"; the page sidebar uses "center". */
  align?: "left" | "right" | "center"
}

export function CategoryPopover({
  open, onClose, value, onChange, categories, onCreateCategory, containerRef, canEdit, align = "left",
}: CategoryPopoverProps) {
  const [creating,  setCreating]  = useState(false)
  const [name,      setName]      = useState("")
  const [color,     setColor]     = useState(CATEGORY_COLOR_SWATCHES[0])
  const [icon,      setIcon]      = useState("Briefcase")
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [localCats, setLocalCats] = useState<Category[]>(categories)

  if (localCats !== categories && !creating) setLocalCats(categories)

  const selectCategory = (id: string | null) => { onChange(id); onClose() }

  const handleCreate = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await api.post<ApiResponse<Category>>("/categories/api/v1/categories", {
        name: name.trim(),
        color,
        icon,
        displayOrder: 0,
      })
      const newCat = parseApiResponse<Category>(res.data)
      setLocalCats((prev) => [...prev, newCat])
      onChange(newCat.id)
      setCreating(false)
      setName("")
      setColor(CATEGORY_COLOR_SWATCHES[0])
      setIcon("Briefcase")
      await onCreateCategory()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create")
    } finally {
      setSaving(false)
    }
  }

  const cancelCreate = () => {
    setCreating(false)
    setName("")
    setColor(CATEGORY_COLOR_SWATCHES[0])
    setIcon("Briefcase")
    setError(null)
  }

  const NamePreviewIcon = ICON_MAP[icon] ?? ICON_MAP["Briefcase"]

  // Category list uses 320px; create panel needs more room for the color picker
  const width = creating ? 360 : 320

  return (
    <Popover open={open} onClose={onClose} width={width} align={align} containerRef={containerRef}>
      {creating ? (
        /* ── CREATE PANEL ── */
        <div style={{ padding: "16px 16px 14px" }}>

          {/* Header row: label + live preview chip */}
          <div style={{
            display: "flex", alignItems: "center",
            justifyContent: "space-between", marginBottom: 14,
          }}>
            <span style={{
              fontSize: 10, fontWeight: 900, letterSpacing: "0.14em",
              textTransform: "uppercase", color: "#a3a3a3",
            }}>
              New category
            </span>
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "#fafafa", borderRadius: 100, padding: "5px 11px 5px 6px",
              border: "1px solid #f0f0f0",
            }}>
              <div style={{
                width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                background: `${color}22`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <NamePreviewIcon size={10} color={color} />
              </div>
              <span style={{
                fontSize: 11, fontWeight: 800, color: "#262626",
                maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {name.trim() || "name"}
              </span>
            </div>
          </div>

          {/* Name input */}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Category name"
            maxLength={30}
            autoFocus
            style={{
              width: "100%", marginBottom: 14,
              background: "#fafafa", border: "1px solid #f0f0f0", borderRadius: 12,
              padding: "11px 14px", fontSize: 13, fontWeight: 700, color: "#262626",
              outline: "none", boxSizing: "border-box", fontFamily: "inherit",
            }}
          />

          {/* Color picker */}
          <div style={{ marginBottom: 14 }}>
            <div style={{
              fontSize: 9, fontWeight: 900, letterSpacing: "0.14em",
              textTransform: "uppercase", color: "#a3a3a3", marginBottom: 10,
            }}>
              Color
            </div>
            <ColorPicker value={color} onChange={setColor} />
          </div>

          {/* Icon grid */}
          <div style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 9, fontWeight: 900, letterSpacing: "0.14em",
              textTransform: "uppercase", color: "#a3a3a3", marginBottom: 8,
            }}>
              Icon
            </div>
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 4,
              maxHeight: 116, overflowY: "auto",
            }}>
              {iconList.map((iconKey) => {
                const IconComp = ICON_MAP[iconKey]
                const isActive = icon === iconKey
                return (
                  <button
                    key={iconKey}
                    type="button"
                    onClick={() => setIcon(iconKey)}
                    title={iconKey}
                    style={{
                      aspectRatio: "1/1", borderRadius: 10, border: "none", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: isActive ? "#0a0a0a" : "#fafafa",
                      color: isActive ? "white" : "#525252",
                      transition: "background 100ms, color 100ms",
                      padding: 6,
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "#f0f0f0"
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "#fafafa"
                    }}
                  >
                    <IconComp size={12} />
                  </button>
                )
              })}
            </div>
          </div>

          {error && (
            <p style={{ fontSize: 11, color: "#ef4444", marginBottom: 8 }}>{error}</p>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={cancelCreate}
              style={{
                flex: 1, padding: "10px 0", borderRadius: 12, border: "none", cursor: "pointer",
                background: "transparent", fontSize: 12, fontWeight: 900, letterSpacing: "0.04em",
                textTransform: "uppercase", color: "#525252", fontFamily: "inherit",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!name.trim() || saving}
              style={{
                flex: 2, padding: "10px 0", borderRadius: 12, border: "none",
                cursor: name.trim() && !saving ? "pointer" : "not-allowed",
                background: name.trim() && !saving ? "#0a0a0a" : "#e5e5e5",
                color: name.trim() && !saving ? "white" : "#a3a3a3",
                fontSize: 11, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase",
                boxShadow: name.trim() && !saving ? "0 4px 14px rgba(0,0,0,0.18)" : "none",
                transition: "background 120ms, box-shadow 120ms",
                fontFamily: "inherit",
              }}
            >
              {saving ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      ) : (
        /* ── CATEGORY LIST ── */
        <>
          <PopoverHeader
            label="Category"
            sub={
              <span style={{ fontSize: 11, fontWeight: 600, color: "#a3a3a3" }}>
                {localCats.length} available
              </span>
            }
          />

          <div style={{ padding: 6, maxHeight: 280, overflowY: "auto" }}>
            {/* No category */}
            <button
              type="button"
              onClick={() => selectCategory(null)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 8,
                padding: "8px 10px", borderRadius: 10, border: "none", cursor: "pointer",
                background: value === null ? "#fafafa" : "transparent", textAlign: "left",
                transition: "background 100ms",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#fafafa" }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = value === null ? "#fafafa" : "transparent" }}
            >
              <div style={{
                width: 22, height: 22, borderRadius: 5,
                border: "1.5px dashed #d4d4d4", flexShrink: 0,
              }} />
              <span style={{ fontSize: 12, fontWeight: 800, color: "#a3a3a3", flex: 1 }}>
                No category
              </span>
              {value === null && (
                <span style={{ fontSize: 11, fontWeight: 800, color: "#0a0a0a" }}>✓</span>
              )}
            </button>

            {localCats.map((cat) => {
              const CatIcon  = cat.icon ? (ICON_MAP[cat.icon] ?? null) : null
              const isActive = value === cat.id
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => selectCategory(cat.id)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 10px", borderRadius: 10, border: "none", cursor: "pointer",
                    background: isActive ? "#fafafa" : "transparent", textAlign: "left",
                    transition: "background 100ms",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#fafafa" }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = isActive ? "#fafafa" : "transparent" }}
                >
                  <div style={{
                    width: 22, height: 22, borderRadius: 5, flexShrink: 0,
                    background: cat.color ? `${cat.color}20` : "#f0f0f0",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {CatIcon && <CatIcon size={11} color={cat.color ?? "#525252"} />}
                  </div>
                  <span style={{
                    fontSize: 12, fontWeight: 800, letterSpacing: "-0.01em",
                    color: "#0a0a0a", flex: 1,
                  }}>
                    {cat.name}
                  </span>
                  {isActive && (
                    <span style={{ fontSize: 11, fontWeight: 800, color: "#0a0a0a" }}>✓</span>
                  )}
                </button>
              )
            })}
          </div>

          {canEdit && (
            <div style={{ borderTop: "1px solid #f0f0f0", padding: 6 }}>
              <button
                type="button"
                onClick={() => setCreating(true)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 10px", borderRadius: 10, border: "none", cursor: "pointer",
                  background: "transparent", textAlign: "left", transition: "background 100ms",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#f5f5f5" }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: 5, background: "#eef2ff", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Plus size={12} color="#4f46e5" />
                </div>
                <span style={{ fontSize: 12, fontWeight: 800, color: "#4f46e5" }}>
                  Create new category
                </span>
              </button>
            </div>
          )}
        </>
      )}
    </Popover>
  )
}
