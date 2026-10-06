"use client"

import { motion } from "@/components/ui/motion"
import { cn } from "@/lib/utils"
import { DURATION_DELIBERATE, EASE_LINEAR, EASE_OUT_EXPO, TWEEN_UI } from "@/lib/animations"

// Module-level constants — defined once, never recreated on render.

/** One turn per `deliberate` beat: a spinner reports that work is happening, not a press. */
const SPINNER_TRANSITION = { duration: DURATION_DELIBERATE, repeat: Infinity, ease: EASE_LINEAR }

/**
 * The dots share the skeleton shimmer's 1200ms period (`tailwind.config.ts`), so two
 * loading indicators on one screen never beat against each other. A loop period is not a
 * UI response, which is why it has no duration token of its own; each dot starts a sixth
 * of the period after the one before it.
 */
const DOTS_PERIOD_S = 1.2
const dotsTransition = (i: number) => ({
  duration: DOTS_PERIOD_S,
  repeat: Infinity,
  delay: (i * DOTS_PERIOD_S) / 6,
  ease: EASE_OUT_EXPO,
})

export function LoadingSpinner({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizeMap = {
    sm: "h-4 w-4",
    md: "h-6 w-6",
    lg: "h-8 w-8",
  }

  return (
    <motion.div
      className={cn(sizeMap[size], "rounded-full border-2 border-line border-t-ink")}
      animate={{ rotate: 360 }}
      transition={SPINNER_TRANSITION}
      style={{ willChange: "transform" }}
    />
  )
}

export function LoadingDots() {
  return (
    <div className="flex items-center justify-center gap-1.5">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="h-2 w-2 rounded-full bg-ink"
          animate={{
            scale: [1, 1.25, 1],
            opacity: [0.4, 1, 0.4]
          }}
          transition={dotsTransition(i)}
        />
      ))}
    </div>
  )
}

export function LoadingOverlay() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={TWEEN_UI}
      className="fixed inset-0 z-overlay flex items-center justify-center bg-paper/70 backdrop-blur-sm"
    >
      {/* The card arrives on the backdrop's beat rather than a step behind it. */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={TWEEN_UI}
        className="flex flex-col items-center gap-4 rounded-xl border border-line bg-paper p-8 shadow-xl"
      >
        <LoadingSpinner size="lg" />
        <p className="text-body-sm font-medium text-ink-muted">Loading...</p>
      </motion.div>
    </motion.div>
  )
}

/**
 * A skeleton block. The `.skeleton` class already sweeps a composited shimmer across it
 * (`globals.css`); a second, framer-driven opacity pulse on the same box ran two loops at
 * once, at two different periods.
 */
export function SkeletonLoader({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("skeleton rounded-sm", className)} />
}

export function SkeletonCard() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={TWEEN_UI}
      className="rounded-lg border border-line bg-paper p-6 shadow-sm"
    >
      <div className="space-y-4">
        <SkeletonLoader className="h-6 w-3/4" />
        <SkeletonLoader className="h-4 w-full" />
        <SkeletonLoader className="h-4 w-5/6" />
        <div className="flex gap-2 pt-2">
          <SkeletonLoader className="h-6 w-16" />
          <SkeletonLoader className="h-6 w-20" />
        </div>
      </div>
    </motion.div>
  )
}
