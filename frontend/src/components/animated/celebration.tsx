"use client"

import { motion } from "framer-motion"
import { useMemo } from "react"
import { cn } from "@/lib/utils"

const CONFETTI_COLORS = ["#10b981", "#111827", "#f59e0b", "#60a5fa", "#f43f5e"]
const CONFETTI_COUNT = 18

interface ConfettiPieceProps {
  index: number
  variant: "screen" | "card"
}

function ConfettiPiece({ index, variant }: ConfettiPieceProps) {
  const angle = (index / CONFETTI_COUNT) * Math.PI * 2 + (index % 2 === 0 ? 0.14 : -0.1)
  const distance = variant === "card" ? 34 + (index % 4) * 8 : 88 + (index % 5) * 18
  const duration = variant === "card" ? 0.58 + (index % 3) * 0.04 : 0.84 + (index % 4) * 0.06
  const delay = (index % 6) * 0.012

  return (
    <motion.div
      initial={{
        opacity: 0,
        x: 0,
        y: 0,
        scale: 0.72,
        rotate: index * 17,
      }}
      animate={{
        opacity: [0, 1, 0],
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance + (variant === "screen" ? 36 : 10),
        scale: [0.72, 1, 0.82],
        rotate: index % 2 === 0 ? 180 : -180,
      }}
      transition={{
        duration,
        delay,
        ease: [0.16, 1, 0.3, 1],
      }}
      data-testid="confetti-piece"
      className={cn(
        "absolute pointer-events-none",
        variant === "screen" ? "left-1/2 top-1/2" : "left-10 top-1/2"
      )}
      style={{
        width: variant === "card" ? "5px" : "7px",
        height: variant === "card" ? "5px" : "7px",
        backgroundColor: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
        borderRadius: index % 3 === 0 ? "999px" : "2px",
      }}
    />
  )
}

export function CompletionCelebration({
  show,
  variant = "screen",
}: {
  show: boolean
  variant?: "screen" | "card"
}) {
  const confettiPieces = useMemo(() => [...Array(CONFETTI_COUNT)].map((_, i) => i), [])

  if (!show) return null

  return (
    <div
      className={cn(
        "pointer-events-none overflow-hidden",
        variant === "screen" ? "fixed inset-0 z-[3000]" : "absolute inset-0 z-40"
      )}
    >
      {confettiPieces.map((i) => (
        <ConfettiPiece key={i} index={i} variant={variant} />
      ))}

      {/* Success pulse */}
      <motion.div
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: [0, 0.28, 0], scale: [0.74, 1.28] }}
        transition={{ duration: variant === "card" ? 0.5 : 0.64, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          "pointer-events-none",
          variant === "screen"
            ? "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
            : "absolute left-10 top-1/2 -translate-x-1/2 -translate-y-1/2"
        )}
      >
        <div className={cn("relative flex items-center justify-center", variant === "card" ? "h-16 w-16" : "h-24 w-24")}>
          <motion.div
            initial={{ scale: 0.7, rotate: -18 }}
            animate={{ scale: [0.7, 1, 0.92], rotate: [ -18, 8, 0 ] }}
            transition={{ duration: variant === "card" ? 0.42 : 0.52, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "rounded-full bg-gray-900 flex items-center justify-center shadow-xl shadow-emerald-500/20",
              variant === "card" ? "h-9 w-9" : "h-14 w-14"
            )}
          >
            <svg className={cn("text-white", variant === "card" ? "h-5 w-5" : "h-7 w-7")} fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
            </svg>
          </motion.div>
        </div>
      </motion.div>
    </div>
  )
}

export function SuccessPulse({ position = "center" }: { position?: "center" | "inline" }) {
  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 1 }}
      animate={{ scale: 1.2, opacity: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className={`absolute pointer-events-none ${
        position === "center" ? "inset-0 flex items-center justify-center" : ""
      }`}
    >
      <div className="w-full h-full rounded-full border-2 border-green-400" />
    </motion.div>
  )
}
