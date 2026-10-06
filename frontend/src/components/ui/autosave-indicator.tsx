"use client"

import { AnimatePresence, motion } from "framer-motion"
import { Check, Loader2, RotateCw } from "lucide-react"
import type { AutosaveStatus } from "@/hooks/use-autosave"
import { SPRING_RESPONSIVE, TWEEN_EXIT, TWEEN_FAST } from "@/lib/animations"
import { cn } from "@/lib/utils"

interface AutosaveIndicatorProps {
  status: AutosaveStatus
  /** Optional copy shown in the resting state (default: "Changes save automatically"). */
  idleLabel?: string
  className?: string
}

const LABELS: Record<AutosaveStatus, string> = {
  idle: "Changes save automatically",
  saving: "Saving…",
  saved: "All changes saved",
  error: "Couldn’t save — will retry",
}

/** Icon swaps: in on `fast`, out on the exit curve, one after the other (`mode="wait"`). */
const ICON_FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: TWEEN_FAST },
  exit: { opacity: 0, transition: TWEEN_EXIT },
} as const

/**
 * Quiet, non-blocking confirmation that an autosaving form is persisting edits.
 * Replaces the explicit Save/Cancel buttons: the user never commits manually, so this
 * is the only signal that their change reached the server.
 *
 * Sentence case, not the eyebrow: this line is a message ("All changes saved"), and it
 * used to be set in bold capitals with tracking — a fourth caption style beside the one
 * eyebrow the system allows.
 */
export function AutosaveIndicator({ status, idleLabel, className }: AutosaveIndicatorProps) {
  const label = status === "idle" && idleLabel ? idleLabel : LABELS[status]

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-1.5 text-caption font-semibold",
        status === "error" ? "text-alert" : status === "saved" ? "text-positive" : "text-ink-muted",
        className,
      )}
    >
      <span className="flex h-3.5 w-3.5 items-center justify-center" aria-hidden>
        <AnimatePresence mode="wait" initial={false}>
          {status === "saving" ? (
            <motion.span key="saving" {...ICON_FADE}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            </motion.span>
          ) : status === "saved" ? (
            <motion.span
              key="saved"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={ICON_FADE.exit}
              transition={SPRING_RESPONSIVE}
            >
              <Check className="h-3.5 w-3.5" />
            </motion.span>
          ) : status === "error" ? (
            <motion.span key="error" {...ICON_FADE}>
              <RotateCw className="h-3.5 w-3.5" />
            </motion.span>
          ) : (
            <motion.span key="idle" {...ICON_FADE} className="h-1.5 w-1.5 rounded-full bg-gray-300" />
          )}
        </AnimatePresence>
      </span>
      <span>{label}</span>
    </div>
  )
}
