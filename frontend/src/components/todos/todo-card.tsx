"use client"

import { memo, useEffect, useRef, useState } from "react"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import {
  Trash, Check, Calendar, AlertTriangle, Share2, Eye, Clock, Zap, Users,
} from "lucide-react"
import { ICON_MAP } from "@/lib/icon-map"
import { Card, CardContent } from "@/components/ui/card"
import { isTodoOwner, type Todo } from "@/types/todo"
import { formatDate, isPastDate, truncateText, formatPublicName, cn } from "@/lib/utils"
import { useAuthStore } from "@/store/auth"
import { useNotificationStore, useTaskUnread } from "@/store/notifications"
import { EASE_OUT_EXPO, SPRING_RESPONSIVE, VARIANTS_CARD, TAP_CARD } from "@/lib/animations"
import { haptic } from "@/lib/haptics"
import { CompletionCelebration } from "@/components/animated/celebration"
import { NotificationBadge } from "@/components/notifications/notification-badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { getBoolPreference, setBoolPreference, SUPPRESS_INCOMPLETE_SUBTASK_WARNING } from "@/lib/ui-preferences"
import { INCOMPLETE_SUBTASK_DIALOG, incompleteSubtaskDescription } from "@/lib/subtask-warning"

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
const JOIN_PRE_COMMIT_MS = 280

const COMPLETION_BUTTON_TRANSITION = {
  type: "spring" as const,
  stiffness: 520,
  damping: 28,
  mass: 0.72,
}

type CompletionPhase = "completing" | "reopening" | "joining" | null

interface TodoCardProps {
  todo: Todo
  onComplete: () => void | Promise<void>
  onDelete: () => void
  onEdit: () => void
  onToggleHidden?: () => Promise<void>
  onJoin?: () => Promise<void>
  variant?: "default" | "completed"
}

/**
 * TodoCard Component - Displays individual todo item with actions
 */
function TodoCardComponent({
  todo,
  onComplete,
  onDelete,
  onEdit,
  onToggleHidden,
  onJoin,
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
  const [isButtonHovered, setIsButtonHovered] = useState(false)
  // Whether the "finish a task that still has unfinished subtasks?" confirmation is open.
  const [subtaskWarnOpen, setSubtaskWarnOpen] = useState(false)
  const mountedRef = useRef(true)
  const celebrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const viewerId = useAuthStore((s) => s.user?.userId)
  // Live unread roll-up for this task — drives the top-right notification mark. Subscribing here
  // (not via props) keeps the card's memo intact while still updating the badge in real time.
  const unread = useTaskUnread(todo.id)
  const markTaskRead = useNotificationStore((s) => s.markTaskRead)
  const isCompleted = variant === "completed"
  const isCompleting = completionPhase === "completing"
  const isReopening = completionPhase === "reopening"
  const isJoining = completionPhase === "joining"
  const isCompletionPending = completionPhase !== null
  const CategoryIcon = todo.categoryIcon ? (ICON_MAP[todo.categoryIcon] ?? null) : null

  const priorityKey = String(todo.priority)
  const priorityConfig = PRIORITY_CONFIG[priorityKey] ?? PRIORITY_CONFIG.Medium
  const isUrgent = priorityKey === "5" || priorityKey === "Urgent" || priorityKey === "Critical"
  // An estimated-completion interval (start ≠ end) renders as a "start → deadline" range; a single
  // date renders alone. Overdue is judged on the deadline (dueDate / the later bound) either way.
  const hasDueRange = !!todo.dueDateStart && !!todo.dueDate && todo.dueDateStart !== todo.dueDate
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
  const cardCategoryLabel = todo.categoryName?.trim() ? truncateText(todo.categoryName, 18) : "No category"
  const isOwner = isTodoOwner(todo, viewerId)
  const isShared = todo.hasSharedAudience ?? fallbackIsShared
  const isEffectivelyWorking = isOwner
    ? (todo.status?.toLowerCase().replace(/\s/g, "") === "inprogress")
    : (todo.isWorking ?? false)
  const isWorkingOnThis = isEffectivelyWorking
  const showShareBadge = isShared && !isCompleted
  const publicBadgeLabel = isOwner ? "Public" : (todo.authorName ? formatPublicName(todo.authorName) : "Public")
  const isPublicName = !isOwner && !!todo.authorName
  const canDelete = isOwner

  const friendCount = todo.sharedWithUserIds?.length ?? 0
  const joinSlots = todo.requiredWorkers != null && todo.requiredWorkers > 1
    ? todo.requiredWorkers - 1
    : friendCount > 0 ? friendCount : null
  const isFull = !isOwner && joinSlots != null && (todo.workerCount ?? 0) >= joinSlots
  const canJoin = !!onJoin && !isCompleted && !isFull

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
  }, [todo.id, isCompleted, todo.status, isWorkingOnThis])

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

  // Whether finishing this task should first warn about still-open subtasks. Only on completion
  // (never reopening), only when the task actually has open subtasks, and only if the viewer hasn't
  // opted out of the warning. Checked BEFORE any completion animation so a "keep working" choice
  // never leaves the card mid-animation.
  const shouldWarnBeforeComplete = () =>
    !isCompleted &&
    (todo.openSubtaskCount ?? 0) > 0 &&
    !getBoolPreference(SUPPRESS_INCOMPLETE_SUBTASK_WARNING)

  const handleCompletionToggle = async () => {
    if (isCompletionPending || isVisibilityPending) return

    // Gate completion behind the unfinished-subtask warning before the animation commits.
    if (shouldWarnBeforeComplete()) {
      setSubtaskWarnOpen(true)
      return
    }

    await runCompletionToggle()
  }

  const runCompletionToggle = async () => {
    if (isCompletionPending || isVisibilityPending) return

    // A non-owner may reopen THEIR OWN completion — but NOT once the author has completed the whole
    // task globally. In that closed-for-everyone case, skip the reopen animation and just invoke
    // onComplete so the parent's "author already completed" toast fires instantly. When the reopen is
    // allowed (author not done), fall through to the normal animated reopen below.
    if (isCompleted && !isOwner && todo.ownerCompleted === true) {
      await Promise.resolve(onComplete())
      return
    }

    const nextPhase: Exclude<CompletionPhase, null> = isCompleted ? "reopening" : "completing"
    setCompletionPhase(nextPhase)
    haptic(isCompleted ? "tap" : "success")

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

  const handleJoin = async () => {
    if (!onJoin || isCompletionPending || isVisibilityPending) return
    setCompletionPhase("joining")
    haptic("tap")
    if (!shouldReduceMotion) {
      await new Promise((r) => setTimeout(r, JOIN_PRE_COMMIT_MS))
    }
    try {
      await Promise.resolve(onJoin())
    } finally {
      if (mountedRef.current) setCompletionPhase(null)
    }
  }

  const handleButtonClick = () => {
    if (isCompletionPending || isVisibilityPending) return
    if (!isCompleted && !isWorkingOnThis && canJoin) {
      void handleJoin()
    } else {
      void handleCompletionToggle()
    }
  }

  // Determine border color based on priority and sharing
  const isUrgentOrOverdue = todo.isVisuallyUrgent ?? fallbackIsVisuallyUrgent
  const isSharedUrgent = showShareBadge && isUrgentOrOverdue
  const borderColor = (() => {
    if (isWorkingOnThis) return "border-indigo-500"
    if (isSharedUrgent) return "border-blue-400"
    if (isUrgentOrOverdue) return "border-red-400"
    if (showShareBadge) return "border-blue-400"
    return "border-gray-100" // Lighter default border for active tasks
  })()
  const borderInlineStyle: React.CSSProperties = (() => {
    if (isCompleted) return {}
    if (isWorkingOnThis && isUrgentOrOverdue) {
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

  const completionOverlayColor = isJoining
    ? "bg-indigo-500/10"
    : isCompleting
      ? "bg-emerald-500/10"
      : isReopening
        ? "bg-sky-500/10"
        : ""

  const completionButtonAnimate = (() => {
    if (isJoining) {
      return {
        scale: [1, 0.88, 1.08, 1],
        rotate: [0, 8, -4, 0],
        backgroundColor: "#6366f1",
        borderColor: "#4f46e5",
        color: "#ffffff",
      }
    }
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
    if (isCompleted) {
      return { scale: 1, rotate: 0, backgroundColor: "#374151", borderColor: "#1f2937", color: "#ffffff" }
    }
    if (isWorkingOnThis) {
      const activeColor = todo.categoryColor || "#000000"
      return {
        scale: 1, rotate: 0,
        backgroundColor: isButtonHovered ? "rgba(16,185,129,0.06)" : `${activeColor}14`,
        borderColor: isButtonHovered ? "#34d399" : activeColor,
        color: isButtonHovered ? "#059669" : activeColor,
      }
    }
    return {
      scale: 1, rotate: 0,
      backgroundColor: "rgba(255,255,255,0)",
      borderColor: (canJoin && isButtonHovered) ? "#a78bfa" : "#d1d5db",
      color: "#111827",
    }
  })()

  return (
    <>
      <motion.div
        layout
        initial={VARIANTS_CARD.hidden}
        animate={
          isJoining
            ? { opacity: 1, y: -1, scale: 1.002 }
            : isCompleting
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
        onClick={(e) => {
          if (isVisibilityPending || isCompletionPending) return
          if (isCollapsed) {
            void handleVisibilityToggle(false)
            return
          }
          // Opening the branch is "seeing the events", so its unread notifications go inactive.
          void markTaskRead(todo.id)
          // Ctrl/Cmd-click (or middle-click handled by the browser) opens the task's branch on its
          // own page in a new tab instead of the in-place modal.
          if (e.metaKey || e.ctrlKey) {
            window.open(`/branch/${todo.id}`, "_blank", "noopener,noreferrer")
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
      {/* Unread notification plate — top-right, above the card surface (the Card clips its own
          overflow). A labeled pill so a glance reads what happened and who/where (people/branch
          motif + human label + count), not just a colored dot. Hidden while the delete affordance
          is active so the two never collide. */}
      <AnimatePresence>
        {unread && unread.count > 0 && !isDeleteZoneHovered && (
          <NotificationBadge
            key="unread-mark"
            type={unread.latestType}
            variant="pill"
            count={unread.count}
            showCount
            size={22}
            pulse={!isCompleted}
            className="absolute -top-2 right-2 z-40 pointer-events-none"
          />
        )}
      </AnimatePresence>
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
            ? "border-gray-300 opacity-60 hover:opacity-80 hover:bg-white/10"
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
                  transition={{ duration: isCompleting ? 0.48 : isJoining ? 0.38 : 0.34, ease: EASE_OUT_EXPO }}
                  className={cn(
                    "absolute inset-y-0 w-1/2 -skew-x-12",
                    isJoining
                      ? "bg-gradient-to-r from-transparent via-indigo-300/80 to-transparent"
                      : isCompleting
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
                <motion.div whileHover={{ scale: 1.15 }} className="w-8 flex items-center justify-center">
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
                  className="text-[11px] font-bold px-3 py-1 rounded-lg uppercase tracking-wider bg-gradient-to-r from-gray-100 to-gray-50 text-gray-700 whitespace-nowrap shadow-sm border border-gray-200 blur-[3px] group-hover/collapsed:blur-0 group-hover/card:blur-0 group-focus-within/collapsed:blur-0 group-hover/collapsed:border-gray-300 transition-[filter,border-color,opacity] duration-500 ease-snappy will-change-[filter]"
                >
                  {cardCategoryLabel}
                </motion.span>
              </div>
              {CategoryIcon && (
                <motion.div
                  // PERF: only run the rotation loop while hovered. Idle collapsed
                  // cards previously animated forever (repeat: Infinity), keeping the
                  // compositor busy every frame for every card on screen.
                  animate={
                    shouldReduceMotion
                      ? { rotate: 0, scale: 1 }
                      : isCardHovered
                        ? { rotate: [0, 8, -8, 0], scale: 1.15 }
                        : { rotate: 0, scale: 1 }
                  }
                  transition={{
                    rotate: isCardHovered ? { duration: 0.6, repeat: Infinity } : { duration: 0.32 },
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
                  {/* 3-state completion / join button */}
                  <motion.button
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation()
                      handleButtonClick()
                    }}
                    onMouseEnter={() => { setIsControlHover(true); setIsButtonHovered(true) }}
                    onMouseLeave={() => { setIsControlHover(false); setIsButtonHovered(false) }}
                    animate={completionButtonAnimate}
                    transition={isCompletionPending ? COMPLETION_BUTTON_TRANSITION : SPRING_RESPONSIVE}
                    whileHover={!isCompletionPending ? { scale: 1.12 } : undefined}
                    whileTap={!isCompletionPending ? { scale: 0.9 } : undefined}
                    disabled={isCompletionPending}
                    aria-busy={isCompletionPending}
                    className={cn(
                      "h-8 w-8 rounded-full border-2 flex items-center justify-center",
                      "transition-[box-shadow,ring,opacity] duration-150",
                      // Phase rings
                      isJoining && "shadow-lg shadow-indigo-500/25 ring-2 ring-indigo-400/35",
                      isCompleting && "shadow-lg shadow-emerald-500/20 ring-2 ring-emerald-400/30",
                      isReopening && "shadow-md shadow-sky-500/10 ring-2 ring-sky-300/20",
                      // Working state rings (not in phase)
                      !isCompletionPending && isWorkingOnThis && !isCompleted && (
                        isButtonHovered
                          ? "ring-2 ring-emerald-400/45 shadow-md shadow-emerald-100/50"
                          : "ring-2 ring-indigo-300/45 shadow-sm shadow-indigo-100/40"
                      ),
                      // Idle + joinable: violet ring on hover
                      !isCompletionPending && !isWorkingOnThis && !isCompleted && canJoin && isButtonHovered && "ring-2 ring-violet-400/50 shadow-md shadow-violet-100/40",
                      // Cursor
                      isCompletionPending ? "cursor-wait" : "cursor-pointer",
                    )}
                    aria-label={
                      isCompleted ? "Mark as incomplete"
                      : isWorkingOnThis ? "Mark as complete"
                      : canJoin ? "Take it – start working"
                      : "Mark as complete"
                    }
                  >
                    <AnimatePresence initial={false} mode="wait">
                      {/* JOINING phase */}
                      {isJoining && (
                        <motion.div
                          key="joining"
                          initial={{ scale: 0.6, opacity: 0, rotate: -20 }}
                          animate={{ scale: 1, opacity: 1, rotate: 0 }}
                          exit={{ scale: 0.6, opacity: 0 }}
                          transition={COMPLETION_BUTTON_TRANSITION}
                        >
                          <Zap className="h-4 w-4 stroke-[2.5]" />
                        </motion.div>
                      )}

                      {/* COMPLETED or COMPLETING (not joining, not reopening) */}
                      {!isJoining && (isCompleted || isCompleting) && !isReopening && (
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

                      {/* REOPENING spinner */}
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

                      {/* WORKING – hover shows checkmark, idle shows pulsing dot */}
                      {isWorkingOnThis && !isCompleted && !isCompletionPending && isButtonHovered && (
                        <motion.div
                          key="work-check"
                          initial={{ scale: 0, opacity: 0, rotate: -12 }}
                          animate={{ scale: 1, opacity: 1, rotate: 0 }}
                          exit={{ scale: 0, opacity: 0 }}
                          transition={{ type: "spring", stiffness: 580, damping: 26 }}
                        >
                          <Check className="h-4 w-4 stroke-[3]" />
                        </motion.div>
                      )}
                      {isWorkingOnThis && !isCompleted && !isCompletionPending && !isButtonHovered && (
                        <motion.div
                          key="working-dot"
                          initial={{ scale: 0.8, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.8, opacity: 0 }}
                          transition={{ type: "spring", stiffness: 520, damping: 28 }}
                          className="relative flex h-2.5 w-2.5 items-center justify-center"
                        >
                          <motion.span
                            animate={{
                              scale: [1, 1.8, 1],
                              opacity: [0.35, 0.1, 0.35],
                            }}
                            transition={{
                              duration: 2,
                              repeat: Infinity,
                              ease: "easeInOut",
                            }}
                            className="absolute inset-0 rounded-full bg-current"
                          />
                          <span className="relative h-2.5 w-2.5 rounded-full bg-current" />
                        </motion.div>
                      )}

                      {/* IDLE + joinable + hovered: faint bolt hint */}
                      {!isWorkingOnThis && !isCompleted && !isCompletionPending && canJoin && isButtonHovered && (
                        <motion.div
                          key="idle-hint"
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 0.55 }}
                          exit={{ scale: 0, opacity: 0 }}
                          transition={{ type: "spring", stiffness: 580, damping: 26 }}
                        >
                          <Zap className="h-3 w-3" style={{ color: "#7c3aed" }} />
                        </motion.div>
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
                                ? "text-base md:text-lg text-gray-700"
                                : "text-base md:text-lg text-gray-400 group-hover/card:text-gray-700"
                              : "text-lg md:text-xl text-gray-950 group-hover/card:text-black"
                        )}
                      >
                        {isCompleted && !isCompleting && !isReopening ? (
                          // Resting completed title. The strike is painted as a gradient "line" on the
                          // text itself (box-decoration-break: clone, so it follows every wrapped line)
                          // and animated by shrinking its background-size width: on card hover the line
                          // wipes away left→right while the title brightens to fully readable; leaving
                          // the card draws it back the same way. Smoother and more deliberate than
                          // fading text-decoration-color, and it survives multi-line titles.
                          <span
                            className={cn(
                              "bg-no-repeat [background-image:linear-gradient(#d1d5db,#d1d5db)]",
                              "[background-position:0_53%] [background-size:100%_2px]",
                              "[-webkit-box-decoration-break:clone] [box-decoration-break:clone]",
                              "transition-[background-size] duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
                              "group-hover/card:[background-size:0%_2px] motion-reduce:transition-none",
                            )}
                          >
                            {truncateText(todo.title, 40)}
                          </span>
                        ) : (
                          truncateText(todo.title, 40)
                        )}
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
                      {(todo.isPublic || (todo.sharedWithUserIds?.length ?? 0) > 0) && !isCompleted && (() => {
                        const fc = todo.sharedWithUserIds?.length ?? 0
                        const statusNorm = todo.status?.toLowerCase().replace(/\s/g, '') ?? ''
                        const ownerSlotTaken = statusNorm === 'inprogress' ? 1 : 0
                        const joined = (todo.workerCount ?? 0) + ownerSlotTaken
                        const slots = todo.requiredWorkers != null
                          ? todo.requiredWorkers
                          : fc > 0 ? fc + 1 : null
                        const label = slots != null ? `${joined}/${slots}` : `${joined}`
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
                      className="flex items-center gap-1.5 text-[11px] font-medium mt-2.5"
                    >
                      <Calendar className="h-3 w-3 flex-shrink-0 text-gray-400" />
                      {hasDueRange ? (
                        // hasDueRange guarantees both bounds are set, so the assertions are safe.
                        <span className="flex items-center gap-1 text-gray-950">
                          <span>{formatDate(todo.dueDateStart!)}</span>
                          <span className="text-gray-400">→</span>
                          <span>{formatDate(todo.dueDate!)}</span>
                        </span>
                      ) : (
                        <span className="text-gray-950">{formatDate(todo.dueDate || "")}</span>
                      )}
                      {isDueOverdue && (
                        <span className="font-black uppercase text-[9px] tracking-wider ml-1 text-red-600 self-center leading-none">
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
                        <div
                          className="flex items-center gap-1.5 text-[10px] font-bold text-orange-700 bg-orange-50 px-2 py-1 rounded-lg border border-orange-200/80 shadow-sm"
                        >
                          <AlertTriangle className="h-3 w-3" />
                          <span>{todo.delay} delay</span>
                        </div>
                      )}
                    </motion.div>
                  )}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      </motion.div>

      {/* Warn before finishing a task that still has unfinished subtasks. Confirming runs the normal
          completion flow (animation + commit); "Продолжить работу" simply dismisses. */}
      <ConfirmDialog
        isOpen={subtaskWarnOpen}
        onClose={() => setSubtaskWarnOpen(false)}
        onConfirm={(dontAskAgain) => {
          if (dontAskAgain) setBoolPreference(SUPPRESS_INCOMPLETE_SUBTASK_WARNING, true)
          void runCompletionToggle()
        }}
        variant="warning"
        title={INCOMPLETE_SUBTASK_DIALOG.title}
        description={incompleteSubtaskDescription(todo.openSubtaskCount ?? 0)}
        confirmText={INCOMPLETE_SUBTASK_DIALOG.confirmText}
        cancelText={INCOMPLETE_SUBTASK_DIALOG.cancelText}
        dontAskAgainLabel={INCOMPLETE_SUBTASK_DIALOG.dontAskAgainLabel}
      />
    </>
  )
}

/**
 * PERF: TodoCard is an expensive render (dozens of motion nodes, several
 * AnimatePresence trees). Lists can mount many of them, and a parent state
 * change (hover, an optimistic setTodos elsewhere) would otherwise re-render
 * every card. We memoize on the todo identity + variant: a card only re-renders
 * when its own todo object reference changes (parents update todos immutably).
 *
 * Function props are intentionally excluded from the comparison. Callers pass
 * handlers that read the latest list state through refs, so a card holding an
 * older closure still operates on current data — the closure identity is
 * irrelevant to correctness, and including it would defeat the memo entirely.
 */
export const TodoCard = memo(
  TodoCardComponent,
  (prev, next) => prev.todo === next.todo && prev.variant === next.variant,
)
