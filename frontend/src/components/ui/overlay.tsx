"use client"

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefCallback } from "react"
import { motion, useAnimationControls, useReducedMotion, type HTMLMotionProps } from "framer-motion"
import { ModalPortal } from "@/components/ui/modal-portal"
import { useExitPresence } from "@/hooks/use-exit-presence"
import { useFocusTrap } from "@/hooks/use-focus-trap"
import { useScrollLock } from "@/hooks/use-scroll-lock"
import { SPRING_LAYOUT, TWEEN_FAST } from "@/lib/animations"
import { originTransform, takeOrigin } from "@/lib/shared-origin"
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
 * - **Page scroll locked** while open, on `<html>`, without moving the layout
 *   behind it (see {@link useScrollLock}).
 * - **Backdrop click closes it** — the pointer equivalent of Escape. The backdrop
 *   is deliberately NOT focusable and carries no role: a viewport-sized button
 *   would be announced as one.
 * - **CSS exits** keep the dialog mounted through its fold-away by
 *   {@link useExitPresence}, without framer-motion's exit hand-off blink. The normal
 *   entrance is also CSS; card editors can opt into the task editor's shared-origin
 *   entrance. While it folds away it lets clicks through to the page beneath.
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
  /** Use the task editor's card-to-dialog entrance; ordinary dialogs keep their CSS entrance. */
  animateFromOrigin?: boolean
  children: ReactNode
}

const RESTING_TRANSFORM = { opacity: 1, scale: 1, x: 0, y: 0 }

function OriginBackdrop({ open, ...props }: Omit<HTMLMotionProps<"div">, "animate" | "initial"> & { open: boolean }) {
  const controls = useAnimationControls()
  useLayoutEffect(() => {
    if (open) {
      controls.set({ opacity: 0 })
      void controls.start({ opacity: 1 }, TWEEN_FAST)
    } else {
      controls.stop()
    }
  }, [open, controls])

  return <motion.div {...props} initial={{ opacity: 0 }} animate={controls} style={{ animation: open ? "none" : undefined }} />
}

function OriginDialog({
  open,
  dialogRef,
  children,
  ...props
}: Omit<HTMLMotionProps<"div">, "animate" | "initial" | "ref"> & {
  open: boolean
  dialogRef: RefCallback<HTMLDivElement>
}) {
  const controls = useAnimationControls()
  const reduce = useReducedMotion() ?? false
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const wasOpen = useRef(false)
  const attachRef = useCallback((element: HTMLDivElement | null) => {
    dialogRef(element)
    setNode(element)
  }, [dialogRef])

  useLayoutEffect(() => {
    if (!node) return
    if (!open) {
      wasOpen.current = false
      controls.stop()
      // Let CSS leave from the current pose, including an interrupted entrance.
      return
    }
    if (wasOpen.current) return
    wasOpen.current = true

    // The portal attaches later, and this dialog has natural height. Measure its
    // untransformed panel before the first visible frame, once per opening edge.
    const origin = takeOrigin()
    // Motion's DOM write can lag its values by a frame on a rapid reopen.
    const previousTransform = node.style.transform
    node.style.transform = "none"
    const target = node.getBoundingClientRect()
    node.style.transform = previousTransform
    const entrance = !reduce && origin && target.width > 0 && target.height > 0
      ? originTransform(origin, target)
      : null
    controls.set(entrance
      ? { opacity: 0, ...entrance }
      : { opacity: 0, scale: reduce ? 1 : 0.95, x: 0, y: reduce ? 0 : 20 })
    void controls.start(RESTING_TRANSFORM, SPRING_LAYOUT)
  }, [node, open, reduce, controls])

  return (
    <motion.div
      {...props}
      ref={attachRef}
      initial={{ opacity: 0 }}
      animate={controls}
      // Only the entrance belongs to motion; retain Overlay's existing CSS exit.
      style={{ animation: open ? "none" : undefined }}
    >
      {children}
    </motion.div>
  )
}

export function Overlay({
  open,
  onClose,
  title,
  description,
  labelledBy,
  className,
  hideHeader,
  animateFromOrigin = false,
  children,
}: OverlayProps) {
  const generatedId = useId()
  const titleId = labelledBy ?? `${generatedId}-title`
  const dialogRef = useFocusTrap<HTMLDivElement>(open)
  const { mounted, presenceProps } = useExitPresence(open)

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

  const backdropProps = {
    "data-state": presenceProps["data-state"],
    onClick: onClose,
    // A viewport-sized button would add noise to the accessibility tree.
    "aria-hidden": true as const,
    className: "backdrop-surface absolute inset-0 bg-ink/40 backdrop-blur-sm",
  }
  const panelProps = {
    role: "dialog",
    "aria-modal": true as const,
    "aria-labelledby": titleId,
    tabIndex: -1,
    ...presenceProps,
    className: cn(
      "dialog-surface relative z-modal max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-paper shadow-xl outline-none",
      className,
    ),
  }
  const content = (
    <>
      {!hideHeader && title ? (
        <div className="flex items-start justify-between gap-4 p-6 pb-0">
          <div>
            <h2 id={titleId} className="text-title-sm font-bold tracking-tight text-ink">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-body-sm text-ink-muted">{description}</p>
            ) : null}
          </div>
        </div>
      ) : null}
      {children}
    </>
  )

  return (
    <ModalPortal>
      {mounted && (
        <div className={cn("fixed inset-0 z-modal flex items-center justify-center p-4", !open && "pointer-events-none")}>
          {animateFromOrigin ? (
            <OriginBackdrop open={open} {...backdropProps} />
          ) : (
            <div {...backdropProps} />
          )}

          {animateFromOrigin ? (
            <OriginDialog open={open} dialogRef={dialogRef} {...panelProps}>{content}</OriginDialog>
          ) : (
            <div ref={dialogRef} {...panelProps}>{content}</div>
          )}
        </div>
      )}
    </ModalPortal>
  )
}
