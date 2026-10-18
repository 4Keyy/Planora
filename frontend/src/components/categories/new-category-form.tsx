"use client"

import { useEffect, useId, useRef, useState } from "react"
import { AnimatePresence, useReducedMotion } from "framer-motion"
import { ArrowLeft, Folder, Plus } from "lucide-react"
import { motion } from "@/components/ui/motion"
import { Button } from "@/components/ui/button"
import { ColourField, DEFAULT_CATEGORY_COLOR, IconField, SwapIcon } from "@/components/categories/category-look"
import { DURATION_FAST, DURATION_UI, EASE_OUT_EXPO, TAP_PRESS } from "@/lib/animations"
import { ICON_MAP } from "@/lib/icon-map"
import { isTextEntry } from "@/lib/text-entry"
import { cn } from "@/lib/utils"

/**
 * The compact way to make a category, inside the category popover — wherever a task picks its
 * category: the task editor, a task's own page and the New task panel.
 *
 * It is the new-category sheet on /categories folded into a popover: the same hero washed in
 * the category's colour, the same dashed tile and naked name field behind the left rule, the
 * same swatches, custom wheel and icon grid (`category-look.tsx`), the same Enter to create and
 * type-to-focus. What it leaves out is what a popover has no room for: the description, the
 * preview card and the tip line.
 */

const NAME_MAX = 50
const PRINTABLE_KEY = /^\S$/u

export type NewCategoryDraft = { name: string; color: string; icon: string | null }

export function NewCategoryForm({
  onCreate,
  onBack,
}: {
  /** Makes the category; reject to keep the draft and say it failed. */
  onCreate: (draft: NewCategoryDraft) => Promise<void>
  /** Back to the category list, dropping the draft. */
  onBack: () => void
}) {
  const reduce = useReducedMotion() ?? false
  const titleId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState("")
  const [color, setColor] = useState(DEFAULT_CATEGORY_COLOR)
  const [icon, setIcon] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const trimmed = name.trim()
  const Icon = (icon && ICON_MAP[icon]) || Folder
  const tint = (percent: number) => `color-mix(in srgb, ${color} ${percent}%, var(--pl-paper))`

  /*
   * Opening the form focuses the form, not the field: nothing lights up by itself. Focus has
   * to land somewhere — the "Create new category" row that was pressed is gone — and from the
   * form Tab reaches every control while the first key typed goes to the name.
   */
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true })
  }, [])

  /* Type-to-focus, as in the sheet and the New task panel. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !PRINTABLE_KEY.test(event.key)) return
      if ((event.ctrlKey || event.metaKey || event.altKey) && !event.getModifierState("AltGraph")) return
      if (isTextEntry(document.activeElement)) return
      nameRef.current?.focus({ preventScroll: true })
      event.stopPropagation()
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [])

  const create = async () => {
    if (!trimmed) {
      setError("Give the category a name first.")
      nameRef.current?.focus()
      return
    }
    if (saving) return
    setSaving(true)
    setError("")
    try {
      await onCreate({ name: trimmed, color, icon })
    } catch {
      setError("Couldn't create the category. Try again.")
      setSaving(false)
    }
  }

  return (
    <div ref={rootRef} tabIndex={-1} role="group" aria-labelledby={titleId} className="outline-none">
      {/* ── The hero, in the category's colour ── */}
      <div
        className="relative isolate overflow-hidden border-b border-line px-3.5 pb-4 pt-3 transition-[background-color] duration-slow ease-emphasized"
        style={{ backgroundColor: tint(9) }}
      >
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-6 -right-5 -z-10 opacity-[0.07]">
          <SwapIcon icon={Icon} id={icon ?? "Folder"} reduce={reduce} className="h-24 w-24" strokeWidth={1} style={{ color }} />
        </div>

        <div className="flex items-center gap-2">
          <motion.button
            type="button"
            whileTap={TAP_PRESS}
            onClick={onBack}
            aria-label="Back to categories"
            className="-ml-1.5 grid h-9 w-9 flex-shrink-0 place-items-center rounded-full text-ink-muted transition-colors duration-fast hover:bg-ink/5 hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </motion.button>
          <p
            id={titleId}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-ink/25 bg-paper/70 px-2.5 py-0.5 text-caption font-semibold text-ink"
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
            New category
          </p>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-lg border-2 border-dashed transition-[background-color,border-color] duration-slow ease-emphasized"
            style={{ backgroundColor: tint(14), borderColor: `color-mix(in srgb, ${color} 45%, transparent)` }}
          >
            <SwapIcon icon={Icon} id={icon ?? "Folder"} reduce={reduce} className="h-5 w-5" style={{ color }} />
          </span>
          <div className="field-rule min-w-0 flex-1 py-1 pl-3">
            <input
              ref={nameRef}
              value={name}
              maxLength={NAME_MAX}
              autoComplete="off"
              placeholder="Name your category"
              aria-label="Category name"
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setName(event.target.value)
                if (error) setError("")
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return
                event.preventDefault()
                void create()
              }}
              className="field-naked w-full border-none bg-transparent p-0 text-title-sm font-bold tracking-tight text-ink placeholder:text-ink-subtle"
            />
          </div>
        </div>

        <AnimatePresence initial={false}>
          {error && (
            <motion.p
              key={error}
              role="alert"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0, transition: { duration: DURATION_FAST } }}
              transition={reduce ? { duration: 0 } : { duration: DURATION_UI, ease: EASE_OUT_EXPO }}
              className="overflow-hidden pl-14 text-caption font-semibold text-alert"
            >
              <span className="block pt-2">{error}</span>
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* ── Look ── */}
      <div className="space-y-4 px-3.5 py-3.5">
        <ColourField value={color} onChange={setColor} reduce={reduce} compact />
        <IconField value={icon} onChange={setIcon} accent={color} reduce={reduce} compact />
      </div>

      {/* ── The foot ── pinned to the bottom of the popover while the pickers scroll under it:
          on a short screen the popover is capped to the room it has, and Create stays in reach. */}
      <div className="sticky bottom-0 z-10 flex items-center gap-3 border-t border-line bg-paper/95 px-3.5 py-2.5 backdrop-blur-sm">
        <p className="flex items-center gap-1.5 text-caption text-ink-muted">
          <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-line bg-paper-sunken px-1.5 font-sans text-caption font-semibold text-ink-muted">
            Enter
          </kbd>
          creates it
        </p>
        <div className="flex-1" />
        <Button size="sm" onClick={() => void create()} loading={saving} disabled={!trimmed} className={cn("rounded-full px-4")}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Create
        </Button>
      </div>
    </div>
  )
}
