"use client"

import * as React from "react"
import { X } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"
import { useToastStore, type ToastType } from "@/store/toast"
import { VARIANTS_TOAST, TWEEN_UI } from "@/lib/animations"

const TYPE_STYLES: Record<ToastType, string> = {
  success: "border-emerald-200/40 bg-emerald-50/70",
  error: "border-red-200/40 bg-red-50/70",
  warning: "border-amber-200/40 bg-amber-50/70",
  info: "border-blue-200/40 bg-blue-50/70",
}

const Toast = React.forwardRef<
  HTMLDivElement,
  {
    id: string
    title: string
    description?: string
    type: ToastType
    className?: string
  }
>(({ className, id, title, description, type }, ref) => {
  const removeToast = useToastStore((state) => state.removeToast)

  return (
    <motion.div
      ref={ref}
      // Errors interrupt (assertive); everything else is announced politely. role implies the
      // matching aria-live, so a screen reader speaks the toast even though it is purely visual.
      role={type === "error" ? "alert" : "status"}
      initial={VARIANTS_TOAST.hidden}
      animate={VARIANTS_TOAST.visible}
      exit={VARIANTS_TOAST.exit}
      transition={TWEEN_UI}
      className={cn(
        "pointer-events-auto relative flex w-full items-start gap-2.5 overflow-hidden rounded-xl border p-4 shadow-soft-md backdrop-blur-lg",
        TYPE_STYLES[type],
        className
      )}
    >
      <div className="flex-1">
        <div className="font-semibold text-sm leading-tight">{title}</div>
        {description && (
          <div className="mt-1 text-xs opacity-70 leading-relaxed">{description}</div>
        )}
      </div>
      <button
        onClick={() => removeToast(id)}
        aria-label="Dismiss notification"
        className="rounded-lg p-1.5 opacity-60 transition-[opacity,background-color,transform] duration-150 hover:opacity-100 hover:bg-black/5 active:scale-95"
      >
        <X className="h-4 w-4" />
      </button>
    </motion.div>
  )
})
Toast.displayName = "Toast"

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts)

  // MOBILE OVERFLOW: a `w-full` (100vw) box pinned with `right-6` (and no `left`)
  // pushes its own left edge to -1.5rem, which widened the whole document and let
  // every page scroll sideways on phones. On mobile we anchor with `inset-x-0`
  // (width is derived from the insets, never 100vw); from `sm` up we restore the
  // right-anchored, max-360px stack. Top honours the notch via the safe-area inset.
  return (
    <div
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+72px)] z-toast flex max-h-[calc(100vh-72px)] flex-col-reverse gap-2.5 px-4 pb-4 sm:inset-x-auto sm:right-6 sm:top-[72px] sm:w-full sm:max-w-[360px] sm:flex-col"
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <Toast key={toast.id} {...toast} />
        ))}
      </AnimatePresence>
    </div>
  )
}
