"use client"

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefCallback } from "react"
import { useAnimationControls, useReducedMotion, type HTMLMotionProps } from "framer-motion"
import { motion } from "@/components/ui/motion"
import { ModalPortal } from "@/components/ui/modal-portal"
import { useExitPresence } from "@/hooks/use-exit-presence"
import { useFocusTrap } from "@/hooks/use-focus-trap"
import { useScrollLock } from "@/hooks/use-scroll-lock"
import { DURATION_FAST, DURATION_UI, EASE_STANDARD, SPRING_LAYOUT, TWEEN_FAST } from "@/lib/animations"
import { takeOriginShape } from "@/lib/shared-origin"
import { dropMorph, measureAtRest, morphFrom, useOriginMorph } from "@/hooks/use-origin-morph"
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
 * - **Exit presence** keeps the dialog mounted through its controlled motion exit.
 *   Ordinary dialogs use the centred fallback; card editors can opt into a shared
 *   origin and return to the same card on close. Exiting dialogs let clicks through.
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
  /** Accessible description supplied by the content, independently of the header. */
  describedBy?: string
  /** Extra classes for the dialog panel (width, max-height, padding). */
  className?: string
  /** Hides the built-in header entirely; requires `labelledBy`. */
  hideHeader?: boolean
  /** Use the task editor's entrance and exit; without a card, use its centred fallback. */
  animateFromOrigin?: boolean
  children: ReactNode
}

function OriginBackdrop({ open, ...props }: Omit<HTMLMotionProps<"div">, "animate" | "initial"> & { open: boolean }) {
  const controls = useAnimationControls()
  useLayoutEffect(() => {
    if (open) {
      controls.set({ opacity: 0 })
      void controls.start({ opacity: 1 }, TWEEN_FAST)
    } else {
      controls.stop()
      void controls.start({ opacity: 0 }, TWEEN_FAST)
    }
  }, [open, controls])

  return <motion.div {...props} initial={{ opacity: 0 }} animate={controls} style={{ animation: "none" }} />
}

/**
 * The dialog panel. Opened from a card or a button (`fromOrigin` and a recorded origin), it is that
 * control, grown — `useOriginMorph`: the panel starts and ends as the control's own rectangle and
 * corners on the task editor's critically damped spring, its content at its natural size,
 * uncovered as it grows and faded first on the way back. Without an origin it rises from 20px
 * below at 95%; under reduced motion it only fades. The category sheet used to scale uniformly
 * from the control with a floor of 0.55, so closing into the 191×44 New category button ended as
 * a 484×417 box with its top above the screen.
 */
function OriginDialog({
  open,
  fromOrigin,
  dialogRef,
  onExitComplete,
  onExitDurationChange,
  children,
  ...props
}: Omit<HTMLMotionProps<"div">, "animate" | "initial" | "ref" | "style"> & {
  open: boolean
  fromOrigin: boolean
  dialogRef: RefCallback<HTMLDivElement>
  onExitComplete: () => void
  onExitDurationChange: (durationMs: number) => void
}) {
  const reduce = useReducedMotion() ?? false
  const { morph, play, stop, surfaceStyle, contentStyle } = useOriginMorph(dropMorph(0, 20, 0.95))
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const wasOpen = useRef(false)
  const animationRun = useRef(0)
  const attachRef = useCallback((element: HTMLDivElement | null) => {
    dialogRef(element)
    setNode(element)
  }, [dialogRef])

  useLayoutEffect(() => {
    if (!node) return
    if (!open) {
      if (!wasOpen.current) return
      wasOpen.current = false
      stop()
      const run = ++animationRun.current
      const grow = !reduce && morph.get().grow
      const duration = grow ? DURATION_UI : DURATION_FAST
      onExitDurationChange(duration * 1000)
      // From wherever it is: a close during the entrance turns round without a jump.
      void play(0, { duration, ease: EASE_STANDARD }).then(() => {
        // An interrupted close must never remove a freshly reopened editor.
        if (animationRun.current === run && !wasOpen.current) onExitComplete()
      })
      return
    }
    if (wasOpen.current) return
    wasOpen.current = true
    ++animationRun.current
    stop()

    // The portal attaches later, and this dialog has natural height. Measure its untransformed
    // panel before the first visible frame, once per opening edge. Only card editors own the
    // shared origin. Filters and confirmations must leave it intact.
    const origin = fromOrigin ? takeOriginShape() : null
    const { rect, radius } = measureAtRest(node)
    const next = reduce
      ? dropMorph(radius, 0, 1)
      : origin && rect
        ? morphFrom(origin.rect, rect, origin.radius, radius)
        : dropMorph(radius, 20, 0.95)
    morph.set(next)
    onExitDurationChange((next.grow ? DURATION_UI : DURATION_FAST) * 1000)
    void play(1, reduce ? TWEEN_FAST : { ...SPRING_LAYOUT, restDelta: 0.0005, restSpeed: 0.005 })
  }, [node, open, fromOrigin, reduce, morph, play, stop, onExitComplete, onExitDurationChange])

  useLayoutEffect(() => () => {
    ++animationRun.current
    stop()
  }, [stop])

  return (
    <motion.div {...props} ref={attachRef} style={{ ...surfaceStyle, animation: "none" }}>
      {/* The content at its own size, uncovered by the panel as it grows. */}
      <motion.div style={contentStyle}>{children}</motion.div>
    </motion.div>
  )
}

export function Overlay({
  open,
  onClose,
  title,
  description,
  labelledBy,
  describedBy,
  className,
  hideHeader,
  animateFromOrigin = false,
  children,
}: OverlayProps) {
  const generatedId = useId()
  const titleId = labelledBy ?? `${generatedId}-title`
  const dialogRef = useFocusTrap<HTMLDivElement>(open)
  const [originExitMs, setOriginExitMs] = useState(DURATION_FAST * 1000)
  const { mounted, presenceProps, finishExit } = useExitPresence(open, originExitMs)

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
    "aria-describedby": describedBy,
    tabIndex: -1,
    "data-state": presenceProps["data-state"],
    className: cn(
      "relative z-modal max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-paper shadow-xl outline-none will-change-[transform,opacity]",
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
          <OriginBackdrop open={open} {...backdropProps} />
          <OriginDialog
            open={open}
            fromOrigin={animateFromOrigin}
            dialogRef={dialogRef}
            onExitComplete={finishExit}
            onExitDurationChange={setOriginExitMs}
            {...panelProps}
          >{content}</OriginDialog>
        </div>
      )}
    </ModalPortal>
  )
}
