"use client"

import { useCallback, useId } from "react"
import { X, Check, SlidersHorizontal, Tag } from "lucide-react"
import type { Category } from "@/types/category"
import { ICON_MAP } from "@/lib/icon-map"
import { Overlay } from "@/components/ui/overlay"

interface Props {
  isOpen: boolean
  onClose: () => void
  categories: Category[]
  selected: string[]
  onChange: (ids: string[]) => void
}

/**
 * "Choose categories" — the category filter for /tasks and /tasks/completed.
 *
 * It is an {@link Overlay}: the scrim, focus trap, Escape, scroll lock and the motion all
 * come from there. It used to carry its own copy of each, animated with a framer-motion
 * spring, and that copy flickered: framer's hand-off from the Web Animations API left the
 * dialog at its starting opacity for a frame once it had opened — the dark "Show All Tasks"
 * row blinked — and brought it back at full opacity for a frame after it had faded out on
 * close. Its own scroll lock also set `overflow` on `<body>`, which never stopped the page
 * behind it from scrolling (see `useScrollLock`).
 */
export function CategoryFilterModal({ isOpen, onClose, categories, selected, onChange }: Props) {
  const headingId = useId()

  const toggle = useCallback((id: string) => {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id])
  }, [selected, onChange])

  return (
    <Overlay
      open={isOpen}
      onClose={onClose}
      labelledBy={headingId}
      hideHeader
      className="max-w-sm overflow-hidden border border-line shadow-black/30"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-50">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-gray-900 text-paper flex items-center justify-center shadow-lg">
            <SlidersHorizontal className="h-4 w-4" />
          </div>
          <h2 id={headingId} className="text-caption font-semibold text-ink uppercase tracking-wider">
            Filter Views{" "}<span className="sr-only">by category</span>
          </h2>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="h-8 w-8 rounded-full flex items-center justify-center text-ink-subtle hover:text-ink hover:bg-gray-100 transition-[color,background-color,border-color,opacity,transform,box-shadow]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* List */}
      <div className="px-3 py-3 max-h-[60vh] overflow-y-auto custom-scrollbar">
        {categories.length === 0 ? (
          <div className="text-center py-10 space-y-2">
            <div className="h-10 w-10 bg-paper-sunken rounded-xl flex items-center justify-center mx-auto">
              <Tag className="h-5 w-5 text-ink-subtle" />
            </div>
            <p className="text-caption font-semibold text-ink-muted uppercase tracking-wider">No categories found</p>
          </div>
        ) : (
          <div className="grid gap-1">
            <button
              onClick={() => onChange([])}
              className={`flex items-center gap-4 px-4 py-3 rounded-xl text-left transition-[color,background-color,border-color,opacity,transform,box-shadow] ${
                selected.length === 0
                  ? "bg-gray-900 text-paper shadow-lg shadow-black/10"
                  : "hover:bg-paper-sunken text-ink-muted"
              }`}
            >
              <div className={`h-2.5 w-2.5 rounded-full ring-4 ${selected.length === 0 ? "bg-paper ring-white/20" : "bg-gray-200 ring-transparent"}`} />
              <span className="text-body-sm font-bold flex-1">Show All Tasks</span>
              {selected.length === 0 && <Check className="h-4 w-4" />}
            </button>

            <div className="h-px bg-gray-100 my-2 mx-4" />

            {categories.map(cat => {
              const active = selected.includes(cat.id)
              const IconComponent = ICON_MAP[cat.icon ?? ""]
              return (
                <button
                  key={cat.id}
                  onClick={() => toggle(cat.id)}
                  className={`flex items-center gap-4 px-4 py-3 rounded-xl text-left transition-[color,background-color,border-color,opacity,transform,box-shadow] ${
                    active ? "bg-paper-sunken ring-1 ring-gray-200" : "hover:bg-paper-sunken text-ink-muted"
                  }`}
                >
                  <div
                    className="h-10 w-10 rounded-lg flex items-center justify-center shadow-sm"
                    style={{ backgroundColor: `${cat.color ?? "var(--pl-ink-subtle)"}15` }}
                  >
                    {IconComponent ? (
                      <IconComponent
                        className="h-5 w-5"
                        style={{ color: cat.color ?? "var(--pl-ink-subtle)" }}
                      />
                    ) : (
                      <Tag className="h-5 w-5" style={{ color: cat.color ?? "var(--pl-ink-subtle)" }} />
                    )}
                  </div>
                  <span className={`text-body-sm flex-1 truncate ${active ? "font-bold text-ink" : "font-bold"}`}>
                    {cat.name}
                  </span>
                  {active && (
                    <div className="h-6 w-6 rounded-full bg-gray-900 text-paper flex items-center justify-center">
                      <Check className="h-3.5 w-3.5 stroke-[3]" />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      {selected.length > 0 && (
        <div className="px-6 py-4 bg-paper-sunken border-t border-line flex items-center justify-between">
          <span className="text-caption font-semibold text-ink-muted uppercase tracking-wider">
            {selected.length} Selected
          </span>
          <button
            onClick={() => onChange([])}
            className="text-caption font-semibold text-alert hover:text-alert uppercase tracking-wider transition-colors"
          >
            Reset All
          </button>
        </div>
      )}
    </Overlay>
  )
}
