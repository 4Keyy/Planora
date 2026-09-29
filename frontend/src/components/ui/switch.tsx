"use client"

import type { ReactNode } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { TWEEN_FAST } from "@/lib/animations"
import { cn } from "@/lib/utils"

/**
 * An on/off setting, said as one: `role="switch"` with `aria-checked`, and its label as its
 * own text, so the accessible name is the words beside the track and nothing else.
 *
 * The knob is laid out by flex and moved by `x` alone. It used to sit at an absolute
 * `top`, which is a pixel guess about a border that the track's size already decides;
 * `items-center` puts it on the track's centre line at any height.
 */
export interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  children: ReactNode
  className?: string
}

/** The knob's travel: a 40px track, 1px border and 2px inset each side, less a 16px knob. */
const KNOB_TRAVEL = 18

export function Switch({ checked, onCheckedChange, children, className }: SwitchProps) {
  const reduce = useReducedMotion() ?? false
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "group inline-flex min-h-control items-center gap-3 rounded-full text-left text-body-sm font-semibold text-ink",
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex h-6 w-10 flex-shrink-0 items-center rounded-full border px-0.5 transition-colors duration-fast",
          checked ? "border-ink bg-ink" : "border-line-strong bg-paper group-hover:border-ink"
        )}
      >
        <motion.span
          className={cn(
            "h-4 w-4 rounded-full transition-colors duration-fast",
            checked ? "bg-paper" : "bg-ink-subtle group-hover:bg-ink"
          )}
          initial={false}
          animate={{ x: checked ? KNOB_TRAVEL : 0 }}
          transition={reduce ? { duration: 0 } : TWEEN_FAST}
        />
      </span>
      {children}
    </button>
  )
}
