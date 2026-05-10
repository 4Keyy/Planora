"use client"

import { useState, useEffect, useCallback } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { X, Check, SlidersHorizontal, Tag } from "lucide-react"
import type { Category } from "@/types/category"
import { ICON_MAP } from "@/lib/icon-map"

interface Props {
  isOpen: boolean
  onClose: () => void
  categories: Category[]
  selected: string[]
  onChange: (ids: string[]) => void
}

export function CategoryFilterModal({ isOpen, onClose, categories, selected, onChange }: Props) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [isOpen, onClose])

  // Lock body scroll while open
  useEffect(() => {
    if (!isOpen) return
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = "" }
  }, [isOpen])

  const toggle = useCallback((id: string) => {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id])
  }, [selected, onChange])

  if (!mounted) return null

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
          <motion.div
            key="cat-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-[4px]"
            onClick={onClose}
          />

          <motion.div
            key="cat-modal"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="relative z-10 w-full max-w-sm bg-white rounded-[2rem] shadow-2xl shadow-black/30 border border-gray-100 overflow-hidden"
            role="dialog"
            aria-modal="true"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-50">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-xl bg-gray-900 text-white flex items-center justify-center shadow-lg">
                  <SlidersHorizontal className="h-4 w-4" />
                </div>
                <span className="text-xs font-black text-gray-900 uppercase tracking-widest">
                  Filter Views
                </span>
              </div>
              <button
                onClick={onClose}
                className="h-8 w-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition-all"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* List */}
            <div className="px-3 py-3 max-h-[60vh] overflow-y-auto custom-scrollbar">
              {categories.length === 0 ? (
                <div className="text-center py-10 space-y-2">
                  <div className="h-10 w-10 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto">
                    <Tag className="h-5 w-5 text-gray-300" />
                  </div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">No categories found</p>
                </div>
              ) : (
                <div className="grid gap-1">
                  <button
                    onClick={() => onChange([])}
                    className={`flex items-center gap-4 px-4 py-3 rounded-2xl text-left transition-all ${
                      selected.length === 0
                        ? "bg-gray-900 text-white shadow-lg shadow-black/10"
                        : "hover:bg-gray-50 text-gray-600"
                    }`}
                  >
                    <div className={`h-2.5 w-2.5 rounded-full ring-4 ${selected.length === 0 ? "bg-white ring-white/20" : "bg-gray-200 ring-transparent"}`} />
                    <span className="text-sm font-black flex-1">Show All Tasks</span>
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
                        className={`flex items-center gap-4 px-4 py-3 rounded-2xl text-left transition-all ${
                          active ? "bg-gray-50 ring-1 ring-gray-200" : "hover:bg-gray-50 text-gray-600"
                        }`}
                      >
                        <div 
                          className="h-10 w-10 rounded-xl flex items-center justify-center shadow-sm"
                          style={{ backgroundColor: `${cat.color ?? "#9ca3af"}15` }}
                        >
                          {IconComponent ? (
                            <IconComponent
                              className="h-5 w-5"
                              style={{ color: cat.color ?? "#9ca3af" }}
                            />
                          ) : (
                            <Tag className="h-5 w-5" style={{ color: cat.color ?? "#9ca3af" }} />
                          )}
                        </div>
                        <span className={`text-sm flex-1 truncate ${active ? "font-black text-gray-900" : "font-bold"}`}>
                          {cat.name}
                        </span>
                        {active && (
                          <div className="h-6 w-6 rounded-full bg-gray-900 text-white flex items-center justify-center">
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
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                  {selected.length} Selected
                </span>
                <button
                  onClick={() => onChange([])}
                  className="text-[10px] font-black text-red-500 hover:text-red-600 uppercase tracking-widest transition-colors"
                >
                  Reset All
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}
