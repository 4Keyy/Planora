"use client"

import { motion } from "framer-motion"
import { useMemo } from "react"
import { cn } from "@/lib/utils"
import { DURATION_DELIBERATE, DURATION_SLOW, EASE_OUT_EXPO } from "@/lib/animations"

/**
 * The burst's palette: the confirmed state and the neutrals around it. It used to throw
 * warn, accent and alert as well — the three colours the system spends on meaning — so
 * finishing a task scattered "overdue" red across the card that had just stopped being
 * overdue.
 */
const CONFETTI_FILLS = ["bg-positive", "bg-ink", "bg-ink-faint", "bg-positive/60", "bg-ink-muted"]
const CONFETTI_COUNT = 18

interface ConfettiPieceProps {
  index: number
  variant: "screen" | "card"
}

function ConfettiPiece({ index, variant }: ConfettiPieceProps) {
  const angle = (index / CONFETTI_COUNT) * Math.PI * 2 + (index % 2 === 0 ? 0.14 : -0.1)
  const distance = variant === "card" ? 34 + (index % 4) * 8 : 88 + (index % 5) * 18
  // Two beats instead of eighteen hand-tuned ones: half the pieces land on `slow`, half on
  // `deliberate`, which is all the scatter the eye reads in a burst this short.
  const duration = index % 2 === 0 ? DURATION_DELIBERATE : DURATION_SLOW

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
      transition={{ duration, ease: EASE_OUT_EXPO }}
      data-testid="confetti-piece"
      className={cn(
        "pointer-events-none absolute",
        variant === "screen" ? "left-1/2 top-1/2 h-2 w-2" : "left-9 top-1/2 h-1.5 w-1.5",
        index % 3 === 0 ? "rounded-full" : "rounded-none",
        CONFETTI_FILLS[index % CONFETTI_FILLS.length],
      )}
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
        variant === "screen" ? "fixed inset-0 z-tooltip" : "absolute inset-0 z-40"
      )}
    >
      {confettiPieces.map((i) => (
        <ConfettiPiece key={i} index={i} variant={variant} />
      ))}

      {/*
        The pulse is centred by framer's own `x`/`y`, not by `-translate-*` classes: a
        motion element writes its whole `transform` inline, which silently overrode the
        Tailwind translate and parked the pulse's top-left corner on the centre point.
      */}
      <motion.div
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: [0, 0.28, 0], scale: [0.74, 1.28] }}
        transition={{ duration: DURATION_DELIBERATE, ease: EASE_OUT_EXPO }}
        style={{ x: "-50%", y: "-50%" }}
        className={cn(
          "pointer-events-none",
          variant === "screen" ? "fixed left-1/2 top-1/2" : "absolute left-9 top-1/2"
        )}
      >
        <div className={cn("relative flex items-center justify-center", variant === "card" ? "h-16 w-16" : "h-24 w-24")}>
          <motion.div
            initial={{ scale: 0.7, rotate: -18 }}
            animate={{ scale: [0.7, 1, 0.92], rotate: [-18, 8, 0] }}
            transition={{ duration: DURATION_DELIBERATE, ease: EASE_OUT_EXPO }}
            className={cn(
              "flex items-center justify-center rounded-full bg-ink shadow-xl",
              variant === "card" ? "h-9 w-9" : "h-14 w-14"
            )}
          >
            <svg
              aria-hidden="true"
              className={cn("text-paper", variant === "card" ? "h-5 w-5" : "h-7 w-7")}
              fill="currentColor"
              viewBox="0 0 24 24"
            >
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
      transition={{ duration: DURATION_DELIBERATE, ease: EASE_OUT_EXPO }}
      className={cn("pointer-events-none absolute", position === "center" && "inset-0 flex items-center justify-center")}
    >
      <div className="h-full w-full rounded-full border-2 border-positive" />
    </motion.div>
  )
}
