"use client"

import { RefObject, useState } from "react"
import { AnimatePresence, useReducedMotion } from "framer-motion"
import { Plus, X } from "lucide-react"
import { Popover, PopoverHeader } from "../popover"
import { motion } from "@/components/ui/motion"
import { NewCategoryForm, type NewCategoryDraft } from "@/components/categories/new-category-form"
import { DURATION_FAST, DURATION_UI, EASE_OUT_EXPO } from "@/lib/animations"
import { ICON_MAP } from "@/lib/icon-map"
import { Category } from "@/types/category"
import { api, parseApiResponse, type ApiResponse } from "@/lib/api"

/**
 * One width for the list and the form: the popover never jumps sideways when it turns from one
 * into the other, and the form's nine-across icon grid fits it exactly.
 */
const POPOVER_WIDTH = 344

interface CategoryPopoverProps {
  open: boolean
  onClose: () => void
  value: string | null
  onChange: (id: string | null) => void
  categories: Category[]
  onCreateCategory: () => Promise<void>
  /** When provided, each category row exposes a delete control (create panel only). */
  onDeleteCategory?: (id: string) => void | Promise<void>
  containerRef: RefObject<HTMLElement | null>
  canEdit: boolean
  /** Popover alignment under the trigger. Default "left"; the page sidebar uses "center". */
  align?: "left" | "right" | "center"
  /** Render in a viewport-fixed body portal (create panel / dashboard) so it can't stretch the page. */
  portal?: boolean
}

export function CategoryPopover({
  open, onClose, value, onChange, categories, onCreateCategory, onDeleteCategory, containerRef, canEdit, align = "left", portal,
}: CategoryPopoverProps) {
  const reduce = useReducedMotion() ?? false
  const [creating,  setCreating]  = useState(false)
  const [localCats, setLocalCats] = useState<Category[]>(categories)

  if (localCats !== categories && !creating) setLocalCats(categories)

  const selectCategory = (id: string | null) => { onChange(id); onClose() }

  const createCategory = async ({ name, color, icon }: NewCategoryDraft) => {
    const res = await api.post<ApiResponse<Category>>("/categories/api/v1/categories", {
      name,
      color,
      icon,
      displayOrder: 0,
    })
    const newCat = parseApiResponse<Category>(res.data)
    setLocalCats((prev) => [...prev, newCat])
    onChange(newCat.id)
    setCreating(false)
    await onCreateCategory()
    onClose()
  }

  /*
   * The list and the form slide past each other: the form comes in from the right as the list
   * leaves to the left, and back. The popover's own size follows on its open/close motion only;
   * between the two faces it keeps one width, so nothing jumps sideways.
   */
  const face = (direction: 1 | -1) => ({
    initial: reduce ? { opacity: 0 } : { opacity: 0, x: 16 * direction },
    animate: { opacity: 1, x: 0, transition: reduce ? { duration: 0 } : { duration: DURATION_UI, ease: EASE_OUT_EXPO } },
    exit: reduce ? { opacity: 0 } : { opacity: 0, x: -16 * direction, transition: { duration: DURATION_FAST } },
  })

  return (
    <Popover open={open} onClose={onClose} width={POPOVER_WIDTH} align={align} containerRef={containerRef} portal={portal}>
      <AnimatePresence initial={false} mode="popLayout">
      {creating ? (
        /* ── CREATE PANEL ── */
        <motion.div key="create" {...face(1)}>
          <NewCategoryForm onCreate={createCategory} onBack={() => setCreating(false)} />
        </motion.div>
      ) : (
        /* ── CATEGORY LIST ── */
        <motion.div key="list" {...face(-1)}>
          <PopoverHeader
            label="Category"
            sub={
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--pl-ink-muted)" }}>
                {localCats.length} available
              </span>
            }
          />

          <div data-cascade style={{ padding: 6, maxHeight: 280, overflowY: "auto" }}>
            {/* No category */}
            <button
              type="button"
              onClick={() => selectCategory(null)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 8,
                padding: "8px 10px", borderRadius: 10, border: "none", cursor: "pointer",
                background: value === null ? "var(--pl-paper-sunken)" : "transparent", textAlign: "left",
                transition: "background 100ms",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--pl-paper-sunken)" }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = value === null ? "var(--pl-paper-sunken)" : "transparent" }}
            >
              <div style={{
                width: 22, height: 22, borderRadius: 5,
                border: "1.5px dashed var(--pl-line-strong)", flexShrink: 0,
              }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--pl-ink-muted)", flex: 1 }}>
                No category
              </span>
              {value === null && (
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--pl-ink)" }}>✓</span>
              )}
            </button>

            {localCats.map((cat) => {
              const CatIcon  = cat.icon ? (ICON_MAP[cat.icon] ?? null) : null
              const isActive = value === cat.id
              return (
                <div key={cat.id} style={{ position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => selectCategory(cat.id)}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 8,
                      padding: "8px 10px", borderRadius: 10, border: "none", cursor: "pointer",
                      paddingRight: onDeleteCategory ? 34 : 10,
                      background: isActive ? "var(--pl-paper-sunken)" : "transparent", textAlign: "left",
                      transition: "background 100ms",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--pl-paper-sunken)" }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = isActive ? "var(--pl-paper-sunken)" : "transparent" }}
                  >
                    <div style={{
                      width: 22, height: 22, borderRadius: 5, flexShrink: 0,
                      background: cat.color ? `${cat.color}20` : "var(--pl-line)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {CatIcon && <CatIcon size={11} color={cat.color ?? "var(--pl-ink-muted)"} />}
                    </div>
                    <span style={{
                      fontSize: 12, fontWeight: 700, letterSpacing: "-0.01em",
                      color: "var(--pl-ink)", flex: 1,
                    }}>
                      {cat.name}
                    </span>
                    {isActive && (
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--pl-ink)" }}>✓</span>
                    )}
                  </button>
                  {/* Sibling (not nested) delete control — a button inside a button is invalid HTML. */}
                  {onDeleteCategory && (
                    <button
                      type="button"
                      aria-label={`Delete ${cat.name}`}
                      onClick={(e) => { e.stopPropagation(); void onDeleteCategory(cat.id) }}
                      style={{
                        position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                        width: 22, height: 22, borderRadius: 7, border: "none", cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: "transparent", color: "var(--pl-ink-subtle)",
                        transition: "background 100ms, color 100ms",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = "var(--pl-alert-surface)"
                        ;(e.currentTarget as HTMLButtonElement).style.color = "var(--pl-alert)"
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = "transparent"
                        ;(e.currentTarget as HTMLButtonElement).style.color = "var(--pl-line-strong)"
                      }}
                    >
                      <X size={11} strokeWidth={2.5} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {canEdit && (
            <div style={{ borderTop: "1px solid var(--pl-line)", padding: 6 }}>
              <button
                type="button"
                onClick={() => setCreating(true)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 10px", borderRadius: 10, border: "none", cursor: "pointer",
                  background: "transparent", textAlign: "left", transition: "background 100ms",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--pl-gray-100)" }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: 5, background: "var(--pl-accent-surface)", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Plus size={12} color="var(--pl-accent)" />
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--pl-accent)" }}>
                  Create new category
                </span>
              </button>
            </div>
          )}
        </motion.div>
      )}
      </AnimatePresence>
    </Popover>
  )
}
