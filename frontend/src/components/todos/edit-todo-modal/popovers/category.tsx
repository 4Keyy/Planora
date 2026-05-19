"use client"

import { RefObject, useState } from "react"
import { Plus } from "lucide-react"
import { Popover, PopoverHeader } from "../popover"
import { CATEGORY_COLOR_SWATCHES } from "../utils"
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
}

export function CategoryPopover({
  open, onClose, value, onChange, categories, onCreateCategory, containerRef, canEdit,
}: CategoryPopoverProps) {
  const [creating, setCreating]   = useState(false)
  const [name,     setName]       = useState("")
  const [color,    setColor]      = useState(CATEGORY_COLOR_SWATCHES[0])
  const [icon,     setIcon]       = useState("Briefcase")
  const [saving,   setSaving]     = useState(false)
  const [error,    setError]      = useState<string | null>(null)
  const [localCats, setLocalCats] = useState<Category[]>(categories)

  // Keep localCats in sync when categories prop changes
  if (localCats !== categories && !creating) setLocalCats(categories)

  const selectCategory = (id: string | null) => {
    onChange(id)
    onClose()
  }

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
      setError(e instanceof Error ? e.message : "Ошибка при создании")
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

  return (
    <Popover open={open} onClose={onClose} width={320} containerRef={containerRef}>
      {creating ? (
        /* ── CREATE PANEL ── */
        <div style={{ padding: 16 }}>
          {/* Header with live preview */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14,
          }}>
            <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color: "#a3a3a3" }}>
              Новая категория
            </span>
            {/* Live preview chip */}
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "#fafafa", borderRadius: 100, padding: "5px 11px 5px 6px",
            }}>
              <div style={{
                width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                background: `${color}22`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <NamePreviewIcon size={10} color={color} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#262626", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {name.trim() || "название"}
              </span>
            </div>
          </div>

          {/* Name input */}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название категории"
            maxLength={30}
            autoFocus
            style={{
              width: "100%", marginBottom: 14,
              background: "#fafafa", border: "1px solid #f0f0f0", borderRadius: 12,
              padding: "11px 14px", fontSize: 13, fontWeight: 700, color: "#262626",
              outline: "none", boxSizing: "border-box",
            }}
          />

          {/* Color swatches */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color: "#a3a3a3", marginBottom: 8 }}>
              Цвет
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {CATEGORY_COLOR_SWATCHES.map((c) => (
                <button
                  key={c}
                  aria-label={`Цвет ${c}`}
                  onClick={() => setColor(c)}
                  style={{
                    width: 24, height: 24, borderRadius: "50%", border: "none", cursor: "pointer",
                    background: c,
                    boxShadow: color === c ? `0 0 0 2px white, 0 0 0 4px #0a0a0a` : "none",
                    transition: "box-shadow 100ms",
                    flexShrink: 0,
                  }}
                />
              ))}
            </div>
          </div>

          {/* Icon grid */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color: "#a3a3a3", marginBottom: 8 }}>
              Иконка
            </div>
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 4,
              maxHeight: 120, overflowY: "auto",
            }}>
              {iconList.map((iconKey) => {
                const IconComp = ICON_MAP[iconKey]
                const isActive = icon === iconKey
                return (
                  <button
                    key={iconKey}
                    onClick={() => setIcon(iconKey)}
                    title={iconKey}
                    style={{
                      aspectRatio: "1/1", borderRadius: 10, border: "none", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: isActive ? "#0a0a0a" : "#fafafa",
                      color: isActive ? "white" : "#525252",
                      transition: "background 100ms, color 100ms",
                    }}
                  >
                    <IconComp size={12} />
                  </button>
                )
              })}
            </div>
          </div>

          {error && <p style={{ fontSize: 11, color: "#ef4444", marginBottom: 8 }}>{error}</p>}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={cancelCreate}
              style={{
                flex: 1, padding: "9px 0", borderRadius: 12, border: "none", cursor: "pointer",
                background: "transparent", fontSize: 12, fontWeight: 900, letterSpacing: "0.04em",
                textTransform: "uppercase", color: "#525252",
              }}
            >
              Отмена
            </button>
            <button
              onClick={handleCreate}
              disabled={!name.trim() || saving}
              style={{
                flex: 2, padding: "9px 0", borderRadius: 12, border: "none",
                cursor: name.trim() && !saving ? "pointer" : "not-allowed",
                background: name.trim() && !saving ? "#0a0a0a" : "#e5e5e5",
                color: name.trim() && !saving ? "white" : "#a3a3a3",
                fontSize: 11, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase",
                boxShadow: name.trim() && !saving ? "0 4px 14px rgba(0,0,0,0.18)" : "none",
                transition: "background 120ms, box-shadow 120ms",
              }}
            >
              {saving ? "Создание…" : "Создать"}
            </button>
          </div>
        </div>
      ) : (
        /* ── CATEGORY LIST ── */
        <>
          <PopoverHeader
            label="Категория"
            sub={<span style={{ fontSize: 11, fontWeight: 600, color: "#a3a3a3" }}>{localCats.length} доступно</span>}
          />

          {/* List */}
          <div style={{ padding: 6, maxHeight: 280, overflowY: "auto" }}>
            {/* No category */}
            <button
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
                width: 22, height: 22, borderRadius: 5, border: "1.5px dashed #d4d4d4", flexShrink: 0,
              }} />
              <span style={{ fontSize: 12, fontWeight: 800, color: "#a3a3a3", flex: 1 }}>Без категории</span>
              {value === null && <span style={{ fontSize: 11, fontWeight: 800, color: "#0a0a0a" }}>✓</span>}
            </button>

            {localCats.map((cat) => {
              const CatIcon = cat.icon ? (ICON_MAP[cat.icon] ?? null) : null
              const isActive = value === cat.id
              return (
                <button
                  key={cat.id}
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
                  {/* Icon tile */}
                  <div style={{
                    width: 22, height: 22, borderRadius: 5, flexShrink: 0,
                    background: cat.color ? `${cat.color}20` : "#f0f0f0",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {CatIcon && <CatIcon size={11} color={cat.color ?? "#525252"} />}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "-0.01em", color: "#0a0a0a", flex: 1 }}>
                    {cat.name}
                  </span>
                  {isActive && <span style={{ fontSize: 11, fontWeight: 800, color: "#0a0a0a" }}>✓</span>}
                </button>
              )
            })}
          </div>

          {/* Create CTA */}
          {canEdit && (
            <div style={{ borderTop: "1px solid #f0f0f0", padding: 6 }}>
              <button
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
                  Создать новую категорию
                </span>
              </button>
            </div>
          )}
        </>
      )}
    </Popover>
  )
}
