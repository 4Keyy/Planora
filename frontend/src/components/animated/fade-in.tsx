"use client"

import { useMemo } from "react"
import { motion, HTMLMotionProps, useReducedMotion } from "framer-motion"
import { cn } from "@/lib/utils"
import {
  SPRING_RESPONSIVE,
  EASE_OUT_EXPO,
  TWEEN_UI,
  VARIANTS_STAGGER_ITEM,
  DURATION_UI,
} from "@/lib/animations"

interface FadeInProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children: React.ReactNode
  delay?: number
  duration?: number
  className?: string
  blur?: boolean
}

export function FadeIn({
  children,
  delay = 0,
  duration = DURATION_UI,
  blur = false,
  className,
  ...props
}: FadeInProps) {
  const shouldReduce = useReducedMotion()

  if (shouldReduce) {
    return <div className={className}>{children}</div>
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.97, filter: blur ? "blur(8px)" : "blur(0px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
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
  staggerDelay = 0.08
}: StaggerContainerProps) {
  const containerVariants = useMemo(() => ({
    visible: { transition: { staggerChildren: staggerDelay, delayChildren: 0.05 } },
  }), [staggerDelay])
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

// Slide in animation with spring
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
      transition={{ duration: 0.25, ease: EASE_OUT_EXPO, delay }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  )
}
