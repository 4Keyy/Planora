"use client"

import { useMemo } from "react"
import { motion, HTMLMotionProps, useReducedMotion } from "framer-motion"
import { cn } from "@/lib/utils"
import {
  SPRING_RESPONSIVE,
  EASE_OUT_EXPO,
  TWEEN_UI,
  VARIANTS_FADE_UP,
  VARIANTS_STAGGER_ITEM,
  DURATION_UI,
  staggerContainer,
} from "@/lib/animations"

/**
 * 40ms between siblings — the list rhythm the design system specifies (§ 9.9).
 * `staggerContainer`'s own default is 80ms, which by the sixth child is already a wait.
 */
const LIST_STAGGER_S = 0.04

interface FadeInProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children: React.ReactNode
  delay?: number
  duration?: number
  className?: string
}

/**
 * The general-purpose entrance: `VARIANTS_FADE_UP`, arriving from below. It used to take
 * a `blur` flag that animated `filter` — a property that repaints every frame and that the
 * motion laws exclude outright; nothing passed it.
 */
export function FadeIn({
  children,
  delay = 0,
  duration = DURATION_UI,
  className,
  ...props
}: FadeInProps) {
  const shouldReduce = useReducedMotion()

  if (shouldReduce) {
    return <div className={className}>{children}</div>
  }

  return (
    <motion.div
      initial={VARIANTS_FADE_UP.hidden}
      animate={VARIANTS_FADE_UP.visible}
      transition={{ duration, delay, ease: EASE_OUT_EXPO }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  )
}

interface StaggerContainerProps {
  children: React.ReactNode
  className?: string
  staggerDelay?: number
}

export function StaggerContainer({
  children,
  className,
  staggerDelay = LIST_STAGGER_S,
}: StaggerContainerProps) {
  const containerVariants = useMemo(() => staggerContainer(staggerDelay), [staggerDelay])
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({
  children,
  className,
  ...props
}: HTMLMotionProps<"div">) {
  const shouldReduce = useReducedMotion()

  if (shouldReduce) {
    return <div className={cn(className)}>{children as React.ReactNode}</div>
  }

  return (
    <motion.div
      variants={VARIANTS_STAGGER_ITEM}
      transition={TWEEN_UI}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  )
}

// Premium scale animation with spring physics
interface ScaleInProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children: React.ReactNode
  delay?: number
  className?: string
}

export function ScaleIn({
  children,
  delay = 0,
  className,
  ...props
}: ScaleInProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{
        ...SPRING_RESPONSIVE,
        delay,
      }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  )
}

// Slide in animation, on the default UI tween
interface SlideInProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children: React.ReactNode
  direction?: "up" | "down" | "left" | "right"
  delay?: number
  className?: string
}

export function SlideIn({
  children,
  direction = "up",
  delay = 0,
  className,
  ...props
}: SlideInProps) {
  const shouldReduce = useReducedMotion()

  const directionOffset = {
    up: { y: 20 },
    down: { y: -20 },
    left: { x: 20 },
    right: { x: -20 },
  }

  if (shouldReduce) {
    return <div className={className}>{children}</div>
  }

  return (
    <motion.div
      initial={{ opacity: 0, ...directionOffset[direction] }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ ...TWEEN_UI, delay }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  )
}
