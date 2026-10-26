"use client"

import { useId, useState, type CSSProperties } from "react"
import { AnimatePresence } from "framer-motion"
import { Check, Folder, Pipette } from "lucide-react"
import { motion } from "@/components/ui/motion"
import { FIELD_LABEL_CLASS } from "@/components/ui/field"
import { ICON_PICKER_ITEMS } from "@/components/ui/icon-picker"
import { ColorPicker } from "@/components/todos/edit-todo-modal/color-picker"
import { CATEGORY_COLOR_SWATCHES } from "@/components/todos/edit-todo-modal/utils"
import { DURATION_SLOW, DURATION_UI, SPRING_RESPONSIVE, SPRING_STANDARD, TAP_PRESS } from "@/lib/animations"
import { cn } from "@/lib/utils"

/**
 * How a category looks — its colour and its icon — picked the same way wherever a category is
 * made or changed: the category sheets on /categories and the compact form inside the category
 * popover (task editor, branch page, New task panel). One set of controls, so the two can never
 * drift apart; `compact` only tightens the spacing.
 */

/** A new category starts on the first swatch: a real colour the API accepts, never a CSS variable. */
export const DEFAULT_CATEGORY_COLOR = CATEGORY_COLOR_SWATCHES[0]

export const isHexColor = (value: string | null | undefined): value is string => !!value && /^#[0-9a-f]{6}$/i.test(value)

/** An icon that swaps with a small spring when the choice changes, instead of blinking. */
export function SwapIcon({
  icon: Glyph,
  id,
  reduce,
  className,
  strokeWidth,
  style,
}: {
  icon: typeof Folder
  id: string
  reduce: boolean
  className: string
  strokeWidth?: number
  style?: CSSProperties
}) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      <motion.span
        key={id}
        className="grid place-items-center"
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: -12 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: 12 }}
        transition={reduce ? { duration: 0 } : SPRING_RESPONSIVE}
      >
        <Glyph className={cn("transition-colors duration-slow", className)} strokeWidth={strokeWidth} style={style} />
      </motion.span>
    </AnimatePresence>
  )
}

/**
 * Twelve swatches and a custom colour. The full wheel stays folded until the custom swatch is
 * pressed — also for a category whose colour is already custom: its swatch is the one ringed,
 * and the wheel opens only when asked for. Each mount starts folded, so a sheet or form that is
 * opened again does not remember an open wheel from last time.
 */
export function ColourField({
  value,
  onChange,
  reduce,
  compact = false,
}: {
  value: string | null
  onChange: (hex: string) => void
  reduce: boolean
  compact?: boolean
}) {
  const groupId = useId()
  const preset = CATEGORY_COLOR_SWATCHES.find((c) => c.toLowerCase() === value?.toLowerCase())
  const custom = !!value && !preset
  const [wheelOpen, setWheelOpen] = useState(false)

  const ring = (
    <motion.span
      layoutId={`${groupId}-ring`}
      aria-hidden="true"
      className="absolute -inset-0.5 rounded-full border-2 border-ink"
      transition={reduce ? { duration: 0 } : SPRING_STANDARD}
    />
  )

  return (
    <fieldset>
      <legend className={FIELD_LABEL_CLASS}>Colour</legend>
      <div role="radiogroup" aria-label="Colour" className={cn("grid grid-cols-7", compact ? "mt-2 gap-1" : "mt-3 gap-2 sm:gap-1.5")}>
        {CATEGORY_COLOR_SWATCHES.map((swatch) => {
          const selected = swatch === preset
          return (
            <motion.button
              key={swatch}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`Colour ${swatch}`}
              whileTap={TAP_PRESS}
              onClick={() => {
                onChange(swatch)
                setWheelOpen(false)
              }}
              className={cn("relative grid aspect-square place-items-center rounded-full", compact && "touch-target")}
            >
              {selected && ring}
              <span aria-hidden="true" className="h-[78%] w-[78%] rounded-full shadow-sm" style={{ backgroundColor: swatch }} />
              {selected && <Check className={cn("absolute text-paper", compact ? "h-3 w-3" : "h-3.5 w-3.5")} strokeWidth={3} aria-hidden="true" />}
            </motion.button>
          )
        })}
        {/* eslint-disable-next-line jsx-a11y/role-supports-aria-props -- this swatch is one of the colour radios and also opens the wheel, and ARIA has no role that is both; giving it another role is a design decision, not a lint fix */}
        <motion.button
          type="button"
          role="radio"
          aria-checked={custom}
          aria-expanded={wheelOpen}
          aria-label="Custom colour"
          whileTap={TAP_PRESS}
          onClick={() => setWheelOpen((open) => !open)}
          className={cn("relative grid aspect-square place-items-center rounded-full", compact && "touch-target")}
        >
          {custom && ring}
          <span
            aria-hidden="true"
            className="grid h-[78%] w-[78%] place-items-center rounded-full shadow-sm"
            // The wheel of the swatches themselves, closed on the first one — or the custom colour
            // itself once there is one, so the ringed swatch shows what was chosen.
            style={{
              background: custom ? value : `conic-gradient(${[...CATEGORY_COLOR_SWATCHES, CATEGORY_COLOR_SWATCHES[0]].join(", ")})`,
            }}
          >
            <span className={cn("grid place-items-center rounded-full bg-paper", custom ? "h-[46%] w-[46%]" : "h-[58%] w-[58%]")}>
              <Pipette className={cn("text-ink-muted", compact ? "h-2.5 w-2.5" : "h-3 w-3")} />
            </span>
          </span>
        </motion.button>
      </div>

      {/* The full wheel folds out under the swatches, the New task plate's way: a grid row
          growing from 0fr on the slow curve while its content fades in behind it. */}
      <div
        className="grid"
        style={{
          gridTemplateRows: wheelOpen ? "1fr" : "0fr",
          transition: reduce ? "none" : `grid-template-rows ${DURATION_SLOW}s var(--pl-ease-emphasized)`,
        }}
      >
        <div className="min-h-0 overflow-hidden" inert={!wheelOpen} aria-hidden={!wheelOpen}>
          <div
            className={compact ? "pt-3" : "pt-4"}
            style={{ opacity: wheelOpen ? 1 : 0, transition: reduce ? "none" : `opacity ${DURATION_UI}s var(--pl-ease-emphasized)` }}
          >
            <div className={cn("rounded-lg border border-line bg-paper-sunken", compact ? "p-3" : "p-4")}>
              <ColorPicker value={value ?? DEFAULT_CATEGORY_COLOR} onChange={onChange} />
            </div>
          </div>
        </div>
      </div>
    </fieldset>
  )
}

/**
 * The 34 icons. Six across at 44px on a phone and nine across at 36px from `sm` in the sheet;
 * nine across at 32px in the compact form. Every cell is still a 44px target (`touch-target`).
 * The choice is one surface in the category's colour that springs to the new icon.
 */
export function IconField({
  value,
  onChange,
  accent,
  reduce,
  compact = false,
}: {
  value: string | null
  onChange: (name: string) => void
  accent: string
  reduce: boolean
  compact?: boolean
}) {
  const groupId = useId()
  const current = value ?? "Folder"
  return (
    <fieldset>
      <legend className={FIELD_LABEL_CLASS}>Icon</legend>
      <div
        role="radiogroup"
        aria-label="Icon"
        className={cn("grid", compact ? "mt-2 grid-cols-9 gap-1" : "mt-3 grid-cols-6 gap-1.5 sm:grid-cols-9 sm:gap-1")}
      >
        {ICON_PICKER_ITEMS.map((item) => {
          const Glyph = item.icon
          const selected = current === item.name
          return (
            <motion.button
              key={item.name}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${item.name} icon`}
              whileTap={TAP_PRESS}
              onClick={() => onChange(item.name)}
              className={cn(
                "touch-target relative grid place-items-center rounded-md transition-colors duration-fast",
                compact ? "h-8" : "h-11 sm:h-9",
                selected ? "text-paper" : "text-ink-muted hover:bg-paper-sunken hover:text-ink",
              )}
            >
              {selected && (
                <motion.span
                  layoutId={`${groupId}-fill`}
                  aria-hidden="true"
                  className="absolute inset-0 rounded-md shadow-sm"
                  style={{ backgroundColor: accent }}
                  transition={reduce ? { duration: 0 } : SPRING_STANDARD}
                />
              )}
              <Glyph className={cn("relative", compact ? "h-4 w-4" : "h-[1.125rem] w-[1.125rem]")} aria-hidden="true" />
            </motion.button>
          )
        })}
      </div>
    </fieldset>
  )
}
