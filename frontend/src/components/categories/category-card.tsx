"use client"

import { forwardRef, useState, type CSSProperties } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Folder, Trash2 } from "lucide-react"
import { Card } from "@/components/ui/card"
import {
  HOVER_LIFT, SPRING_RESPONSIVE, TAP_CARD, TAP_PRESS,
  TWEEN_EXIT, TWEEN_UI, VARIANTS_CARD,
} from "@/lib/animations"
import { ICON_MAP } from "@/lib/icon-map"
import { rememberOrigin } from "@/lib/shared-origin"
import type { Category } from "@/types/category"

// popLayout needs the leaving card's DOM ref to pin its position in the grid.
export const CategoryCard = forwardRef<HTMLDivElement, {
  category: Category
  onEdit: () => void
  onDelete: () => void
}>(function CategoryCard({ category, onEdit, onDelete }, ref) {
  const CategoryIcon = category.icon ? (ICON_MAP[category.icon] ?? Folder) : Folder
  const accentColor = category.color?.trim() || "var(--pl-accent)"
  const glowStyle = {
    "--card-glow": `color-mix(in srgb, ${accentColor} 20%, transparent)`,
  } as CSSProperties
  const [isDeleteZoneHovered, setIsDeleteZoneHovered] = useState(false)
  const [isDeleteZoneFocused, setIsDeleteZoneFocused] = useState(false)

  return (
    <motion.div
      ref={ref}
      // whileTap makes motion elements tabbable; focus belongs to the action buttons.
      tabIndex={-1}
      // Size layout would scale the rounded surface as neighbours leave the grid.
      layout="position"
      initial={VARIANTS_CARD.hidden}
      animate={VARIANTS_CARD.visible}
      exit={VARIANTS_CARD.exit}
      whileHover={isDeleteZoneHovered ? undefined : HOVER_LIFT}
      whileTap={TAP_CARD}
      transition={SPRING_RESPONSIVE}
      className="group/card relative"
    >
      {/* Keep the moving layer free of clipping and shadows, as on task cards:
          repainting a rounded shadow on that layer can leave hover artefacts.
          The static surface clips its contents; CSS owns the coloured glow. */}
      <Card
        data-category-card=""
        style={glowStyle}
        className="relative overflow-hidden border-line bg-paper shadow-sm transition-[box-shadow,border-color,opacity] duration-base ease-emphasized group-hover/card:shadow-[0_8px_32px_-4px_var(--card-glow),0_4px_16px_-2px_var(--card-glow)]"
      >
        {/* The control stays focusable while its panel is parked outside the surface.
            A real button provides Enter/Space activation without a second handler. */}
        <button
          type="button"
          aria-label={`Delete category ${category.name}`}
          className="absolute inset-y-0 right-0 z-30 hidden w-16 overflow-hidden focus-visible:-outline-offset-2 md:flex"
          onMouseEnter={() => setIsDeleteZoneHovered(true)}
          onMouseLeave={() => setIsDeleteZoneHovered(false)}
          onFocus={() => setIsDeleteZoneFocused(true)}
          onBlur={() => setIsDeleteZoneFocused(false)}
          onClick={(e) => { e.stopPropagation(); onDelete() }}
        >
          <AnimatePresence>
            {(isDeleteZoneHovered || isDeleteZoneFocused) && (
              <motion.span
                key="delete-panel"
                // Translate the panel rather than repainting an animated clip-path.
                variants={{
                  hidden: { x: "100%", transition: TWEEN_EXIT },
                  visible: { x: 0, transition: TWEEN_UI },
                }}
                initial="hidden"
                animate="visible"
                exit="hidden"
                className="flex h-full w-full items-center justify-center bg-gradient-to-r from-alert/0 via-alert/85 via-35% to-alert text-paper"
                whileHover={{ opacity: 0.92 }}
              >
                <motion.span
                  variants={{
                    hidden: { scale: 0.5, opacity: 0, y: 6 },
                    visible: { scale: 1, opacity: 1, y: 0, transition: { ...SPRING_RESPONSIVE, delay: 0.06 } },
                  }}
                >
                  <Trash2 className="h-5 w-5" aria-hidden="true" />
                </motion.span>
              </motion.span>
            )}
          </AnimatePresence>
        </button>

        {/* Neutral until pressed: the confirmation carries the destructive colour. */}
        <motion.button
          type="button"
          whileTap={TAP_PRESS}
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="absolute right-2 top-2 z-30 flex h-11 w-11 items-center justify-center rounded-full text-ink-muted transition-colors duration-fast active:bg-alert-surface active:text-alert md:hidden"
          aria-label={`Delete category ${category.name}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </motion.button>

        <div aria-hidden="true" className="pointer-events-none absolute -bottom-6 -right-6 opacity-5 transition-opacity duration-slow group-hover/card:opacity-10">
          <CategoryIcon className="h-28 w-28 text-ink" strokeWidth={1} />
        </div>

        <button
          type="button"
          onClick={(e) => {
            rememberOrigin(e.currentTarget.closest<HTMLElement>("[data-category-card]") ?? e.currentTarget)
            onEdit()
          }}
          aria-label={`Edit category ${category.name}`}
          // Keep the focus outline inside the surface's clipped edge.
          className="relative z-10 flex w-full items-center gap-4 rounded-lg p-5 pr-14 text-left focus-visible:-outline-offset-2 md:pr-5"
        >
          <span
            aria-hidden="true"
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md"
            style={{ backgroundColor: `color-mix(in srgb, ${accentColor} 12%, transparent)` }}
          >
            <CategoryIcon className="h-5 w-5" style={{ color: accentColor }} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-semibold tracking-tight text-ink">{category.name}</span>
            <span className="mt-0.5 line-clamp-1 text-body-sm text-ink-muted">
              {category.description?.trim() || "No description"}
            </span>
          </span>
        </button>
      </Card>
    </motion.div>
  )
})
