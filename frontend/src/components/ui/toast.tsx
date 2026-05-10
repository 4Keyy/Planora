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

  return (
    <div className="pointer-events-none fixed top-16 right-6 z-toast flex max-h-[calc(100vh-4rem)] w-full flex-col-reverse gap-2.5 p-4 sm:flex-col sm:max-w-[360px]">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <Toast key={toast.id} {...toast} />
        ))}
      </AnimatePresence>
    </div>
  )
}
