"use client"

import { motion } from "framer-motion"
import { TWEEN_UI } from "@/lib/animations"

// Module-level constants — defined once, never recreated on render
const SPINNER_TRANSITION = { duration: 0.8, repeat: Infinity, ease: "linear" as const }
const OVERLAY_INNER_TRANSITION = { duration: 0.3, delay: 0.1 }

const dotsTransition = (i: number) => ({
  duration: 1.2,
  repeat: Infinity,
  delay: i * 0.2,
  ease: [0.16, 1, 0.3, 1] as const,
})

export function LoadingSpinner({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizeMap = {
    sm: "h-4 w-4 border-2",
    md: "h-6 w-6 border-[2.5px]",
    lg: "h-8 w-8 border-3",
  }

  return (
    <motion.div
      className={`${sizeMap[size]} border-gray-200 border-t-black rounded-full`}
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
          className="h-2 w-2 rounded-full bg-black"
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-white/70 backdrop-blur-sm"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={OVERLAY_INNER_TRANSITION}
        className="flex flex-col items-center gap-4 rounded-2xl bg-white/90 p-8 shadow-soft-xl backdrop-blur-xl border border-gray-100/60"
      >
        <LoadingSpinner size="lg" />
        <p className="text-sm text-gray-600 font-medium">Loading...</p>
      </motion.div>
    </motion.div>
  )
}

// Premium Skeleton Loader - Enhanced with better shimmer
export function SkeletonLoader({ className }: { className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0.6 }}
      animate={{ opacity: [0.6, 1, 0.6] }}
      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      className={`skeleton rounded-xl bg-gradient-to-r from-gray-100 via-gray-50 to-gray-100 ${className}`}
      style={{
        backgroundSize: "200% 100%",
        animation: "skeleton-shimmer 2s infinite",
      }}
    />
  )
}

export function SkeletonCard() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="rounded-2xl border border-gray-100/60 bg-white p-7 shadow-sm"
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
