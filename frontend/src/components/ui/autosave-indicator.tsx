"use client"

import { AnimatePresence, motion } from "framer-motion"
import { Check, Loader2, RotateCw } from "lucide-react"
import type { AutosaveStatus } from "@/hooks/use-autosave"
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

/**
 * Quiet, non-blocking confirmation that an autosaving form is persisting edits.
 * Replaces the explicit Save/Cancel buttons: the user never commits manually, so this
 * is the only signal that their change reached the server.
 */
export function AutosaveIndicator({ status, idleLabel, className }: AutosaveIndicatorProps) {
  const label = status === "idle" && idleLabel ? idleLabel : LABELS[status]

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider",
        status === "error" ? "text-red-500" : status === "saved" ? "text-emerald-600" : "text-gray-400",
        className,
      )}
    >
      <span className="flex h-3.5 w-3.5 items-center justify-center" aria-hidden>
        <AnimatePresence mode="wait" initial={false}>
          {status === "saving" ? (
            <motion.span key="saving" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            </motion.span>
          ) : status === "saved" ? (
            <motion.span
              key="saved"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 460, damping: 24 }}
            >
              <Check className="h-3.5 w-3.5" />
            </motion.span>
          ) : status === "error" ? (
            <motion.span key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <RotateCw className="h-3.5 w-3.5" />
            </motion.span>
          ) : (
            <motion.span
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-1.5 w-1.5 rounded-full bg-gray-300"
            />
          )}
        </AnimatePresence>
      </span>
      <span>{label}</span>
    </div>
  )
}
