"use client"

import { motion } from "framer-motion"
import { DURATION_UI, EASE_OUT_EXPO } from "@/lib/animations"

/**
 * Route transition. A `template.tsx` re-mounts on every navigation (unlike
 * `layout.tsx`), so this gives every route a coherent fade-in as the user moves
 * between pages.
 *
 * ## Opacity only, and this time the reason is measured
 *
 * BLUEPRINT moment 9 asks for the content to rise 8px as it fades. A transform
 * here creates a containing block, and a `position: fixed` descendant anchors to
 * that block instead of the viewport — this page tree has fixed descendants
 * (quick capture, the selection bar, the undo bar).
 *
 * That objection was argued rather than measured, so it was tested. framer-motion
 * genuinely does clean up after itself: on the shipped build, an element that runs
 * a `y` animation and settles reports inline `transform: none`, computed
 * `transform: none`, `will-change: auto`, and a fixed child of it anchors to the
 * viewport. The containing block really does stop existing.
 *
 * **The cost is not the drift during the animation. It is the moment the
 * containing block disappears.** The fixed control is laid out against the
 * transformed ancestor for 220ms and against the viewport from one frame later,
 * and the browser records the difference as a layout shift. Measured on `/tasks`
 * at 390px, four runs:
 *
 * | | CLS |
 * |---|---|
 * | opacity only | 0.0037 |
 * | with `y: 8 → 0` | 0.0600, 0.0607, 0.0600 |
 *
 * A 16× regression on the product's main screen, for an 8px rise. The shift is
 * attributable: the capture control's wrapper, `fixed inset-x-0 bottom-0`, at
 * 339ms — exactly when the transform is cleared.
 *
 * The transform could be bought back by portalling every fixed control out of the
 * page tree, which is three components and a new set of stacking and focus-order
 * questions to answer. It is not worth an 8px rise. The navbar's active-tab
 * indicator carries the continuity between routes instead, moving by `layoutId`,
 * and that half of moment 9 is built.
 *
 * Kept short (160ms) so it layers cleanly over each page's own entrance
 * animations, and the global `MotionConfig` still collapses it under
 * `prefers-reduced-motion`.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO }}
    >
      {children}
    </motion.div>
  )
}
