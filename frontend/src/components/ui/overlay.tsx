"use client"

import { useCallback, useEffect, useId, type ReactNode } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ModalPortal } from "@/components/ui/modal-portal"
import { useFocusTrap } from "@/hooks/use-focus-trap"
import { useScrollLock } from "@/hooks/use-scroll-lock"
import { SPRING_STANDARD, TWEEN_FAST } from "@/lib/animations"
import { cn } from "@/lib/utils"

/**
 * Everything a modal dialog owes the person using it, in one place.
 *
 * The product had three overlays and each implemented a different subset. The
 * category editor — the one with a form in it — had the least: no `role="dialog"`,
 * no `aria-modal`, and no focus trap, so Tab walked straight out of the dialog into
 * the page behind it while a screen reader described the whole thing as a plain
 * group of controls. None of the three locked page scroll, so a wheel over the
 * backdrop scrolled the page underneath, and on a phone the scroll chained out of
 * the sheet and kept going.
 *
 * What this guarantees:
 *
 * - **Portalled** to `<body>`, so an ancestor's `overflow` or `transform` cannot
 *   clip or re-parent a fixed-position dialog.
 * - **Announced** — `role="dialog"`, `aria-modal="true"`, and `aria-labelledby`
 *   pointing at a heading this component renders, so the dialog has a name.
 * - **Focus trapped**, with focus moved in on open and returned to the trigger on
 *   close (see {@link useFocusTrap}).
 * - **Escape closes it**, listening in the capture phase so a nested popover can
 *   still take the key first by stopping propagation.
 * - **Page scroll locked** while open, with the scrollbar's width replaced as
 *   padding so the layout behind does not jump sideways when it disappears.
 * - **Backdrop click closes it** — the pointer equivalent of Escape. The backdrop
 *   is deliberately NOT focusable and carries no role: a viewport-sized button
 *   would be announced as one.
 *
 * `labelledBy` exists for the case where the dialog renders its own heading with
 * markup this component should not own; pass the heading's id and omit `title`.
 */

export interface OverlayProps {
  open: boolean
  onClose: () => void
  /** Rendered as the dialog's `<h2>` and used as its accessible name. */
  title?: string
  /** A subtitle under the title. Purely visual. */
  description?: ReactNode
  /** Use instead of `title` when the content supplies its own heading element. */
  labelledBy?: string
  /** Extra classes for the dialog panel (width, max-height, padding). */
  className?: string
  /** Hides the built-in header entirely; requires `labelledBy`. */
  hideHeader?: boolean
  children: ReactNode
}

export function Overlay({
  open,
  onClose,
  title,
  description,
  labelledBy,
  className,
  hideHeader,
  children,
}: OverlayProps) {
  const generatedId = useId()
  const titleId = labelledBy ?? `${generatedId}-title`
  const dialogRef = useFocusTrap<HTMLDivElement>(open)

  useScrollLock(open)

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    },
    [onClose],
  )

  useEffect(() => {
    if (!open) return
    /**
     * Bubble phase, deliberately. A nested popover inside the dialog registers its
     * own Escape handler on a deeper node; in the bubble phase that handler runs
     * FIRST and can call `stopPropagation()` to keep the key for itself, so Escape
     * peels one layer at a time instead of closing the whole dialog out from under
     * an open date picker. Capture would invert that and make the innermost layer
     * unreachable. (The focus trap listens in capture for the opposite reason: Tab
     * must be contained no matter what the content does with it.)
     */
    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [open, handleEscape])

  return (
    <ModalPortal>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={TWEEN_FAST}
              onClick={onClose}
              // Not focusable and no role: the pointer affordance is real, but a
              // viewport-sized "button" in the accessibility tree is noise. Escape
              // is the keyboard equivalent and is handled above.
              aria-hidden="true"
              className="absolute inset-0 bg-ink/60 backdrop-blur-md"
            />

            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              tabIndex={-1}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={SPRING_STANDARD}
              className={cn(
                "relative z-modal max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-paper shadow-xl outline-none",
                className,
              )}
            >
              {!hideHeader && title ? (
                <div className="flex items-start justify-between gap-4 p-6 pb-0">
                  <div>
                    <h2 id={titleId} className="text-title-sm font-bold tracking-tight text-ink">
                      {title}
                    </h2>
                    {description ? (
                      <p className="mt-1 text-body-sm font-medium text-ink-subtle">{description}</p>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {children}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </ModalPortal>
  )
}
