"use client"

import { useEffect, useRef, useState } from "react"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import {
  Trash, Check, Calendar, AlertTriangle, Share2, Eye, Clock, Zap, Users,
} from "lucide-react"
import { ICON_MAP } from "@/lib/icon-map"
import { Card, CardContent } from "@/components/ui/card"
import { isTodoOwner, type Todo } from "@/types/todo"
import { formatDate, isPastDate, truncateText, formatPublicName, cn } from "@/lib/utils"
import { useAuthStore } from "@/store/auth"
import { EASE_OUT_EXPO, SPRING_RESPONSIVE, VARIANTS_CARD, TAP_CARD } from "@/lib/animations"
import { CompletionCelebration } from "@/components/animated/celebration"
import { WorkerJoinButton } from "@/components/todos/worker-join-button"

const PRIORITY_CONFIG: Record<string, { color: string; num: number }> = {
  "1": { color: "#9ca3af", num: 1 },
  "2": { color: "#6b7280", num: 2 },
  "3": { color: "#4b5563", num: 3 },
  "4": { color: "#1f2937", num: 4 },
  "5": { color: "#000000", num: 5 },
  VeryLow:  { color: "#9ca3af", num: 1 },
  Low:      { color: "#6b7280", num: 2 },
  Medium:   { color: "#4b5563", num: 3 },
  High:     { color: "#1f2937", num: 4 },
  Urgent:   { color: "#000000", num: 5 },
  Critical: { color: "#000000", num: 5 },
}

const CARD_VISIBILITY_LAYOUT = {
  type: "spring" as const,
  stiffness: 430,
  damping: 40,
  mass: 0.66,
}

const CARD_VISIBILITY_CONTENT = {
  duration: 0.18,
  ease: EASE_OUT_EXPO,
} as const

const COMPLETION_PRE_COMMIT_MS = 360
const REOPEN_PRE_COMMIT_MS = 260

const COMPLETION_BUTTON_TRANSITION = {
  type: "spring" as const,
  stiffness: 520,
  damping: 28,
  mass: 0.72,
}

type CompletionPhase = "completing" | "reopening" | null


interface TodoCardProps {
  todo: Todo
  onComplete: () => void | Promise<void>
  onDelete: () => void
  onEdit: () => void
  onToggleHidden?: () => Promise<void>
  onJoin?: () => Promise<void>
  onLeave?: () => Promise<void>
  variant?: "default" | "completed"
}

/**
 * TodoCard Component - Displays individual todo item with actions
 */
export function TodoCard({
  todo,
  onComplete,
  onDelete,
  onEdit,
  onToggleHidden,
  onJoin,
  onLeave,
  variant = "default",
}: TodoCardProps) {
  const shouldReduceMotion = useReducedMotion()
  const [optimisticCollapsed, setOptimisticCollapsed] = useState<boolean | null>(null)
  const [isVisibilityPending, setIsVisibilityPending] = useState(false)
  const [completionPhase, setCompletionPhase] = useState<CompletionPhase>(null)
  const [showCompletionCelebration, setShowCompletionCelebration] = useState(false)
  const [isControlHover, setIsControlHover] = useState(false)
  const [isCardHovered, setIsCardHovered] = useState(false)
  const [isDeleteZoneHovered, setIsDeleteZoneHovered] = useState(false)
  const mountedRef = useRef(true)
  const celebrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const viewerId = useAuthStore((s) => s.user?.userId)
  const isCompleted = variant === "completed"
  const isCompleting = completionPhase === "completing"
  const isReopening = completionPhase === "reopening"
  const isCompletionPending = completionPhase !== null
  const CategoryIcon = todo.categoryIcon ? (ICON_MAP[todo.categoryIcon] ?? null) : null

  const priorityKey = String(todo.priority)
  const priorityConfig = PRIORITY_CONFIG[priorityKey] ?? PRIORITY_CONFIG.Medium
  const isUrgent = priorityKey === "5" || priorityKey === "Urgent" || priorityKey === "Critical"
  const isDueOverdue = !isCompleted && todo.dueDate && isPastDate(todo.dueDate)
  const isDueToday = !isCompleted && todo.dueDate
    ? (() => {
        const due = new Date(todo.dueDate)
        const today = new Date()
        due.setHours(0, 0, 0, 0)
        today.setHours(0, 0, 0, 0)
        return due.getTime() === today.getTime()
      })()
    : false
  const fallbackIsShared = todo.isPublic || (todo.sharedWithUserIds?.length ?? 0) > 0
  const fallbackIsVisuallyUrgent = isUrgent || (isDueOverdue ?? false) || isDueToday
  const cardCategoryLabel = todo.categoryName?.trim() ? truncateText(todo.categoryName, 18) : "Без категории"
  const isOwner = isTodoOwner(todo, viewerId)
  const isShared = todo.hasSharedAudience ?? fallbackIsShared
  // Owner uses InProgress status as their personal "working on this" signal;
  // non-owners use the worker-join flag
  // Backend sends "In Progress" (with space) for the InProgress enum value
  const isEffectivelyWorking = isOwner
    ? (todo.status?.toLowerCase().replace(/\s/g, "") === "inprogress")
    : (todo.isWorking ?? false)
  const isWorkingOnThis = isEffectivelyWorking
  const showShareBadge = isShared && !isCompleted
  const publicBadgeLabel = isOwner ? "Public" : (todo.authorName ? formatPublicName(todo.authorName) : "Public")
  const isPublicName = !isOwner && !!todo.authorName
  const canDelete = isOwner

  const allowCollapse = !isCompleted
  const isCollapsed = allowCollapse && (optimisticCollapsed ?? (todo.hidden ?? false))
  const isSparse = !todo.description && (todo.title?.length ?? 0) < 40 && !todo.dueDate && !todo.expectedDate && !todo.delay
  const isInfoDense = !!todo.description && (!!todo.dueDate || !!todo.expectedDate || !!todo.delay)
  const layoutTransition = shouldReduceMotion ? { duration: 0 } : CARD_VISIBILITY_LAYOUT
  const contentTransition = shouldReduceMotion ? { duration: 0 } : CARD_VISIBILITY_CONTENT

  useEffect(() => {
    return () => {
      mountedRef.current = false
      if (celebrationTimerRef.current) {
        clearTimeout(celebrationTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    setOptimisticCollapsed(null)
  }, [todo.id, todo.hidden])

  useEffect(() => {
    setCompletionPhase(null)
    setShowCompletionCelebration(false)
  }, [todo.id, isCompleted])

  const handleVisibilityToggle = async (nextCollapsed: boolean) => {
    if (!onToggleHidden || isVisibilityPending || isCompletionPending) return

    if (nextCollapsed) {
      setOptimisticCollapsed(true)
    }

    setIsVisibilityPending(true)
    try {
      await onToggleHidden()
    } catch {
      setOptimisticCollapsed(null)
    } finally {
      setIsVisibilityPending(false)
    }
  }

  const handleCompletionToggle = async () => {
    if (isCompletionPending || isVisibilityPending) return

    const nextPhase: Exclude<CompletionPhase, null> = isCompleted ? "reopening" : "completing"
    setCompletionPhase(nextPhase)

    if (!isCompleted) {
      setShowCompletionCelebration(true)
      if (celebrationTimerRef.current) {
        clearTimeout(celebrationTimerRef.current)
      }
      celebrationTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setShowCompletionCelebration(false)
      }, 720)
    }

    if (!shouldReduceMotion) {
      await new Promise((resolve) => setTimeout(resolve, isCompleted ? REOPEN_PRE_COMMIT_MS : COMPLETION_PRE_COMMIT_MS))
    }

    try {
      await Promise.resolve(onComplete())
    } finally {
      if (mountedRef.current) {
        setCompletionPhase(null)
      }
    }
  }

  // Determine border color based on priority and sharing
  const isUrgentOrOverdue = todo.isVisuallyUrgent ?? fallbackIsVisuallyUrgent
  const isSharedUrgent = showShareBadge && isUrgentOrOverdue
  const borderColor = (() => {
    if (isWorkingOnThis) return "border-indigo-500"
    if (isSharedUrgent) return "border-blue-400"   // left override via inline style
    if (isUrgentOrOverdue) return "border-red-400"
    if (showShareBadge) return "border-blue-400"
    return "border-gray-300"
  })()
  // When urgent+shared, force red left border via inline style (highest specificity).
  // When also working, set all four sides explicitly so the class shorthand can't win.
  const borderInlineStyle: React.CSSProperties = (() => {
    if (isWorkingOnThis && isSharedUrgent) {
      return {
        borderTopColor: "rgb(99 102 241)",
        borderRightColor: "rgb(99 102 241)",
        borderBottomColor: "rgb(99 102 241)",
        borderLeftColor: "rgb(248 113 113)",
      }
    }
    if (isSharedUrgent) return { borderLeftColor: "rgb(248 113 113)" }
    return {}
  })()
  const categoryShadowColor = todo.categoryColor?.trim()
  const hoverShadowColor = isWorkingOnThis
    ? "#818cf8"
    : categoryShadowColor
      || (showShareBadge ? "#60a5fa" : isUrgentOrOverdue ? "#f87171" : null)
  const hoverShadow = hoverShadowColor ? `${hoverShadowColor}33` : "rgba(0,0,0,0.08)"

  const cardHoverShadow = isCardHovered && !isCompleted
    ? `0 8px 32px -4px ${hoverShadow}, 0 4px 16px -2px ${hoverShadow}`
    : undefined
  const completionOverlayColor = isCompleting
    ? "bg-emerald-500/10"
    : isReopening
      ? "bg-sky-500/10"
      : ""
  const completionButtonAnimate = (() => {
    if (isCompleting) {
      return {
        scale: [1, 0.88, 1.08, 1],
        rotate: [0, -8, 4, 0],
        backgroundColor: "#10b981",
        borderColor: "#059669",
        color: "#ffffff",
      }
    }

    if (isReopening) {
      return {
        scale: [1, 0.94, 1.04, 1],
        rotate: [0, -16, 8, 0],
        backgroundColor: "#f9fafb",
        borderColor: "#9ca3af",
        color: "#374151",
      }
    }

    return isCompleted
      ? {
          scale: 1,
          rotate: 0,
          backgroundColor: "#374151",
          borderColor: "#1f2937",
          color: "#ffffff",
        }
      : {
          scale: 1,
          rotate: 0,
          backgroundColor: "rgba(255,255,255,0)",
          borderColor: "#d1d5db",
          color: "#111827",
        }
  })()

  return (
    <>
      <motion.div
        layout
        initial={VARIANTS_CARD.hidden}
        animate={
          isCompleting
            ? { opacity: 1, y: -2, scale: 0.992 }
            : isReopening
              ? { opacity: 0.82, y: -1, scale: 1.004 }
              : VARIANTS_CARD.visible
        }
        exit={VARIANTS_CARD.exit}
        whileHover={isControlHover || isVisibilityPending || isCompletionPending ? undefined : { y: isCompleted ? 0 : -4, scale: 1.008 }}
        whileTap={isCompletionPending ? undefined : TAP_CARD}
        transition={{
          layout: layoutTransition,
          default: shouldReduceMotion ? { duration: 0 } : SPRING_RESPONSIVE,
        }}
        onHoverStart={() => setIsCardHovered(true)}
        onHoverEnd={() => setIsCardHovered(false)}
        onClick={() => {
          if (isVisibilityPending || isCompletionPending) return
          if (isCollapsed) {
            void handleVisibilityToggle(false)
            return
          }
          onEdit()
        }}
        className={cn(
          "relative group/card",
          isVisibilityPending || isCompletionPending ? "cursor-wait" : "cursor-pointer",
          isCompleted ? "opacity-60 hover:opacity-70" : "z-10"
        )}
      >
      <Card
        style={{
          boxShadow: cardHoverShadow,
          transitionProperty: "box-shadow, background-color, border-color, opacity",
          transitionDuration: "220ms",
          transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
          ...borderInlineStyle,
        }}
        className={cn(
          "group relative overflow-hidden border-2",
          "hover:bg-white/40 hover:backdrop-blur-sm",
          isCompleted
            ? "border-gray-300 opacity-70 hover:opacity-85 hover:bg-white/25"
            : borderColor,
          isSharedUrgent && "task-card--shared-urgent",
          isSparse && "task-card--sparse",
          isInfoDense && "task-card--dense"
        )}
      >
        <CompletionCelebration show={showCompletionCelebration} variant="card" />

        <AnimatePresence>
          {isCompletionPending && (
            <motion.div
              key={completionPhase}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.16, ease: EASE_OUT_EXPO }}
              className={cn("pointer-events-none absolute inset-0 z-20 overflow-hidden", completionOverlayColor)}
            >
              {!shouldReduceMotion && (
                <motion.div
                  initial={{ x: "-45%", opacity: 0 }}
                  animate={{ x: "145%", opacity: [0, 0.42, 0] }}
                  transition={{ duration: isCompleting ? 0.48 : 0.34, ease: EASE_OUT_EXPO }}
                  className={cn(
                    "absolute inset-y-0 w-1/2 -skew-x-12",
                    isCompleting
                      ? "bg-gradient-to-r from-transparent via-emerald-300/80 to-transparent"
                      : "bg-gradient-to-r from-transparent via-sky-200/70 to-transparent"
                  )}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Delete Trigger Area (Desktop - slide from right) */}
        {!isCollapsed && canDelete && (
          <div
            className="absolute top-[-2px] right-[-2px] bottom-[-2px] w-[68px] z-30 hidden md:flex overflow-hidden"
            onMouseEnter={() => { setIsDeleteZoneHovered(true); setIsControlHover(true) }}
            onMouseLeave={() => { setIsDeleteZoneHovered(false); setIsControlHover(false) }}
          >
            <AnimatePresence>
              {isDeleteZoneHovered && (
                <motion.div
                  key="delete-panel"
                  variants={{
                    hidden: { clipPath: "inset(0 0 0 100%)", transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } },
                    visible: { clipPath: "inset(0 0 0 0%)", transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] } },
                  }}
                  initial="hidden"
                  animate="visible"
                  exit="hidden"
                  style={{
                    background: "linear-gradient(to right, rgba(239,68,68,0) 0%, rgba(239,68,68,0.85) 35%, #dc2626 100%)",
                    boxShadow: "-6px 0 20px rgba(239,68,68,0.18)",
                  }}
                  className="h-full w-full flex items-center justify-center text-white cursor-pointer"
                  whileHover={{ filter: "brightness(1.12)" }}
                  onClick={(e) => { e.stopPropagation(); onDelete() }}
                >
                  <motion.div
                    variants={{
                      hidden: { scale: 0.5, opacity: 0, y: 6 },
                      visible: { scale: 1, opacity: 1, y: 0, transition: { delay: 0.07, type: "spring", stiffness: 420, damping: 22 } },
                    }}
                  >
                    <Trash className="h-[18px] w-[18px]" />
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Mobile Delete Button */}
        {!isCollapsed && canDelete && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute top-3 right-3 md:hidden z-30"
          >
            <motion.button
              whileHover={{ scale: 1.15, rotate: 10 }}
              whileTap={{ scale: 0.9 }}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-2.5 rounded-full bg-red-500 text-white shadow-md hover:shadow-lg transition-all active:shadow-none"
            >
              <Trash className="h-5 w-5" />
            </motion.button>
          </motion.div>
        )}

        {/* Subtle category watermark */}
        {!isCompleted && CategoryIcon && !isCollapsed && (
          <div className="absolute -right-7 -bottom-7 pointer-events-none opacity-[0.07] group-hover/card:opacity-[0.12] transition-opacity duration-300">
            <CategoryIcon
              className="h-32 w-32"
              style={{ color: "#000" }}
              strokeWidth={1}
            />
          </div>
        )}

        <CardContent
          className={cn(
            isCollapsed ? "py-2 px-6" : isCompleted ? "pt-3 pb-6 px-6" : isSparse ? "py-3 px-4" : "p-6",
            "relative z-10"
          )}
        >
          {isCollapsed && allowCollapse ? (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={contentTransition}
              onHoverStart={() => setIsControlHover(true)}
              onHoverEnd={() => setIsControlHover(false)}
              className="flex items-center justify-between gap-3 group/collapsed"
            >
              <div className="flex items-center gap-4 min-w-0">
                <motion.div
                  whileHover={{ scale: 1.15 }}
                  className="w-8 flex items-center justify-center"
                >
                  <motion.button
                    type="button"
                    disabled={isVisibilityPending || isCompletionPending}
                    aria-busy={isVisibilityPending || isCompletionPending}
                    whileHover={isVisibilityPending || isCompletionPending ? undefined : { scale: 1.2, rotate: 10 }}
                    whileTap={isVisibilityPending || isCompletionPending ? undefined : { scale: 0.9 }}
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleVisibilityToggle(false)
                    }}
                    className={cn(
                      "h-6 w-6 flex items-center justify-center rounded-full border-1.5 border-gray-400 text-gray-600 hover:text-gray-900 hover:border-gray-600 hover:bg-gray-100 transition-[background-color,border-color,color,opacity,transform] shadow-xs",
                      (isVisibilityPending || isCompletionPending) && "opacity-60 cursor-wait"
                    )}
                    aria-label="Expand task card"
                    aria-expanded={!isCollapsed}
                  >
                    <Eye className="h-4 w-4" />
                  </motion.button>
                </motion.div>
                <motion.span
                  initial={{ x: -10, opacity: 0 }}
                  animate={{
                    x: 0,
                    opacity: isVisibilityPending ? 0.62 : 1,
                  }}
                  transition={contentTransition}
                  className="text-[11px] font-bold px-3 py-1 rounded-lg uppercase tracking-wider bg-gradient-to-r from-gray-100 to-gray-50 text-gray-700 whitespace-nowrap shadow-sm border border-gray-200 blur-[3px] group-hover/collapsed:blur-0 group-hover/card:blur-0 group-focus-within/collapsed:blur-0 group-hover/collapsed:border-gray-300 transition-[filter,border-color,opacity] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] will-change-[filter]"
                >
                  {cardCategoryLabel}
                </motion.span>
              </div>
              {CategoryIcon && (
                <motion.div
                  animate={{
                    rotate: isCardHovered ? [0, 8, -8, 0] : [0, 10, -10, 0],
                    scale: isCardHovered ? 1.15 : 1,
                  }}
                  transition={{
                    rotate: { duration: isCardHovered ? 0.6 : 3, repeat: Infinity },
                    scale: { duration: 0.32 },
                  }}
                >
                  <CategoryIcon
                    className="h-5 w-5 transition-colors duration-300"
                    style={{ color: isCardHovered ? "#6b7280" : "#9ca3af" }}
                    strokeWidth={1.5}
                  />
                </motion.div>
              )}
            </motion.div>
          ) : (
            <>
              <div className="flex items-stretch gap-3">
                {/* Actions: complete button + eye, vertically centered as a group */}
                <div className="w-8 flex-shrink-0 flex flex-col items-center justify-center gap-3">
                  <motion.button
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation()
                      void handleCompletionToggle()
                    }}
                    onMouseEnter={() => setIsControlHover(true)}
                    onMouseLeave={() => setIsControlHover(false)}
                    animate={completionButtonAnimate}
                    transition={isCompletionPending ? COMPLETION_BUTTON_TRANSITION : SPRING_RESPONSIVE}
                    whileHover={!isCompletionPending ? { scale: 1.1 } : undefined}
                    whileTap={!isCompletionPending ? { scale: 0.92 } : undefined}
                    disabled={isCompletionPending}
                    aria-busy={isCompletionPending}
                    className={cn(
                      "h-8 w-8 rounded-full border-2 transition-[box-shadow,opacity] duration-200 flex items-center justify-center shadow-sm",
                      isCompleted
                        ? "bg-gray-700 border-gray-800 text-white hover:shadow-md"
                        : "border-gray-300 hover:border-gray-900 hover:bg-gray-50 hover:shadow-md",
                      isCompleting && "shadow-lg shadow-emerald-500/20 ring-2 ring-emerald-400/30",
                      isReopening && "shadow-md shadow-sky-500/10 ring-2 ring-sky-300/20"
                    )}
                    aria-label={isCompleted ? "Mark as incomplete" : "Mark as complete"}
                  >
                    <AnimatePresence initial={false} mode="wait">
                      {(isCompleted || isCompleting) && !isReopening && (
                        <motion.div
                          key="check"
                          initial={{ scale: 0.78, rotate: -18, opacity: 0 }}
                          animate={{ scale: 1, rotate: 0, opacity: 1 }}
                          exit={{ scale: 0.78, rotate: 16, opacity: 0 }}
                          transition={COMPLETION_BUTTON_TRANSITION}
                        >
                          <Check className="h-5 w-5 stroke-[3]" />
                        </motion.div>
                      )}
                      {isReopening && (
                        <motion.div
                          key="reopening"
                          initial={{ opacity: 0, scale: 0.8, rotate: 0 }}
                          animate={{ opacity: 1, scale: 1, rotate: 360 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          transition={{ duration: 0.42, ease: EASE_OUT_EXPO }}
                          className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent"
                        />
                      )}
                    </AnimatePresence>
                  </motion.button>
                  {allowCollapse && (
                    <motion.button
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onMouseEnter={() => setIsControlHover(true)}
                      onMouseLeave={() => setIsControlHover(false)}
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleVisibilityToggle(true)
                      }}
                      disabled={isVisibilityPending || isCompletionPending}
                      aria-busy={isVisibilityPending || isCompletionPending}
                      whileHover={isVisibilityPending || isCompletionPending ? undefined : { scale: 1.2, rotate: 10 }}
                      whileTap={isVisibilityPending || isCompletionPending ? undefined : { scale: 0.9 }}
                      className={cn(
                        "h-6 w-6 flex items-center justify-center rounded-full border-1.5 border-gray-300 text-gray-600 hover:text-gray-900 hover:border-gray-500 hover:bg-gray-100 transition-[background-color,border-color,color,opacity,transform] shadow-xs",
                        (isVisibilityPending || isCompletionPending) && "opacity-60 cursor-wait"
                      )}
                      aria-label="Collapse task card"
                      aria-expanded={!isCollapsed}
                    >
                      <Eye className="h-4 w-4" />
                    </motion.button>
                  )}
                </div>

                {/* Body: all task content, grows with data */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-col gap-2 mb-3">
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-center gap-2"
                    >
                      <h3
                        className={cn(
                          "font-black tracking-tight leading-snug break-words transition-colors duration-300 ease-out",
                          isCompleting
                            ? "text-lg md:text-xl text-gray-500 line-through decoration-emerald-500/70 decoration-2"
                            : isCompleted
                              ? isReopening
                                ? "text-sm text-gray-700"
                                : "text-sm line-through text-gray-400 group-hover/card:text-gray-700"
                              : "text-lg md:text-xl text-gray-950 group-hover/card:text-black"
                        )}
                      >
                        {truncateText(todo.title, 40)}
                      </h3>
                    </motion.div>
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.05 }}
                      className="flex items-center gap-2 flex-wrap"
                    >
                      {!isCompleted && todo.categoryName && (
                        <span className="text-[10px] font-bold px-2.5 py-1 rounded-lg uppercase tracking-wider bg-gray-100 text-gray-600 whitespace-nowrap shadow-sm border border-gray-200/80 hover:border-gray-300 transition-all">
                          {truncateText(todo.categoryName, 12)}
                        </span>
                      )}
                      {!isCompleted && (
                        <span
                          className="flex items-center gap-1 text-[11px] font-bold tracking-wide"
                          style={{ color: priorityConfig.color }}
                        >
                          <Zap className="h-3 w-3" />
                          {priorityConfig.num}/5
                        </span>
                      )}
                      {showShareBadge && (
                        <motion.span
                          initial={{ scale: 0.9, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          className={cn(
                            "text-[10px] font-bold px-2.5 py-1 rounded-lg uppercase tracking-wider bg-blue-100 text-blue-700 whitespace-nowrap shadow-sm border border-blue-200/80 flex items-center gap-1 hover:shadow-md transition-all",
                            isPublicName && "normal-case tracking-normal"
                          )}
                        >
                          <Share2 className="h-3 w-3" />
                          {!isOwner && publicBadgeLabel}
                        </motion.span>
                      )}
                      {showShareBadge && (() => {
                        const workerTotal = (todo.workerCount ?? 0) + 1
                        const label = todo.requiredWorkers != null
                          ? `${workerTotal}/${todo.requiredWorkers}`
                          : (todo.workerCount ?? 0) > 0 ? `${workerTotal}` : null
                        if (!label) return null
                        return (
                          <motion.span
                            key="workers-badge"
                            initial={{ scale: 0.82, opacity: 0, y: 3 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            transition={{ type: "spring", stiffness: 480, damping: 26, delay: 0.06 }}
                            className={cn(
                              "text-[10px] px-2.5 py-1 rounded-lg whitespace-nowrap shadow-sm border flex items-center gap-1 transition-[background-color,border-color,color,box-shadow] duration-300",
                              isEffectivelyWorking
                                ? "font-bold bg-indigo-100 text-indigo-700 border-indigo-300/70 shadow-indigo-100/60 ring-1 ring-indigo-200/50"
                                : "font-semibold bg-slate-50 text-slate-400 border-slate-200/70"
                            )}
                          >
                            <Users className="h-3 w-3 flex-shrink-0" />
                            <span className="font-black tabular-nums tracking-tight">{label}</span>
                            <AnimatePresence>
                              {isEffectivelyWorking && (
                                <motion.span
                                  key="you"
                                  initial={{ opacity: 0, maxWidth: 0 }}
                                  animate={{ opacity: 1, maxWidth: "2.5rem" }}
                                  exit={{ opacity: 0, maxWidth: 0 }}
                                  transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
                                  className="overflow-hidden text-indigo-500 font-bold"
                                >
                                  &nbsp;· you
                                </motion.span>
                              )}
                            </AnimatePresence>
                          </motion.span>
                        )
                      })()}
                    </motion.div>
                  </div>
                  {!isCompleted && todo.description && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.1 }}
                      className="text-sm md:text-base text-gray-600 line-clamp-2 leading-relaxed font-medium break-words mt-2 group-hover/card:text-gray-800 transition-colors duration-300 ease-out"
                    >
                      {truncateText(todo.description, 80)}
                    </motion.p>
                  )}
                  {(isDueOverdue || (todo.dueDate && !isCompleted)) && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.15 }}
                      className={cn(
                        "flex items-center gap-1.5 text-[11px] font-medium mt-2.5",
                        isDueOverdue ? "text-red-600" : "text-gray-500"
                      )}
                    >
                      <Calendar className="h-3 w-3 flex-shrink-0" />
                      <span>{formatDate(todo.dueDate || "")}</span>
                      {isDueOverdue && (
                        <span className="font-black uppercase text-[9px] tracking-wider ml-0.5">
                          · Overdue
                        </span>
                      )}
                    </motion.div>
                  )}
                  {!isCompleted && (todo.expectedDate || todo.delay) && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.2 }}
                      className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-100/50"
                    >
                      {todo.expectedDate && (
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-500 bg-gray-50 px-2 py-1 rounded-lg border border-gray-200/60">
                          <Clock className="h-3 w-3" />
                          <span>EXP: {formatDate(todo.expectedDate)}</span>
                        </div>
                      )}
                      {todo.delay && (
                        <motion.div
                          animate={{ scale: [1, 1.05, 1] }}
                          transition={{ duration: 2, repeat: Infinity }}
                          className="flex items-center gap-1.5 text-[10px] font-bold text-orange-700 bg-orange-50 px-2 py-1 rounded-lg border border-orange-200/80 shadow-sm"
                        >
                          <AlertTriangle className="h-3 w-3" />
                          <span>{todo.delay} delay</span>
                        </motion.div>
                      )}
                    </motion.div>
                  )}
                </div>

              </div>

              {/* Worker join/leave strip — rendered inside CardContent to avoid overflow-hidden clipping */}
              {onJoin && onLeave && (() => {
                const isFull = !!todo.requiredWorkers && (todo.workerCount ?? 0) >= todo.requiredWorkers - 1
                const show = isOwner || (isShared && (isEffectivelyWorking || !isFull))
                if (!show) return null
                return (
                  <div className={cn(
                    "mt-4",
                    isSparse ? "-mx-4 -mb-3" : "-mx-6 -mb-6"
                  )}>
                    <WorkerJoinButton
                      isOwner={false}
                      isWorking={isEffectivelyWorking}
                      isFull={!!todo.requiredWorkers && (todo.workerCount ?? 0) >= todo.requiredWorkers - 1}
                      onJoin={onJoin}
                      onLeave={onLeave}
                      onControlHoverChange={setIsControlHover}
                    />
                  </div>
                )
              })()}
            </>
          )}
        </CardContent>
      </Card>
      </motion.div>
    </>
  )
}
