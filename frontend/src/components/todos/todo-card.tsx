"use client"

import { memo, useCallback, useEffect, useRef, useState } from "react"
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
import { DURATION_FAST, DURATION_UI, EASE_EXIT, EASE_OUT_EXPO, SPRING_RESPONSIVE, VARIANTS_CARD, TAP_CARD, TAP_PRESS } from "@/lib/animations"
import { haptic } from "@/lib/haptics"
import { CompletionCelebration } from "@/components/animated/celebration"
import { NotificationBadgeCluster } from "@/components/notifications/notification-badge-cluster"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { PriorityMeter } from "@/components/ui/priority-meter"
import { getBoolPreference, setBoolPreference, SUPPRESS_INCOMPLETE_SUBTASK_WARNING } from "@/lib/ui-preferences"
import { INCOMPLETE_SUBTASK_DIALOG, incompleteSubtaskDescription } from "@/lib/subtask-warning"
import { InkCheck } from "@/components/ui/ink-check"
import { rememberOrigin } from "@/lib/shared-origin"
import { RedactionBadge } from "@/components/ui/redaction-badge"
import type { ListRowProps } from "@/hooks/use-list-navigation"

/** Priority is a magnitude, not a category — see components/ui/priority-meter.tsx. */
/**
 * Every chip on the card — category, audience, workers, expected date, delay — in one
 * shape. There were five: uppercase with a gradient, uppercase with a shadow, sentence
 * case on grey-50, accent with a ring, warn with a shadow.
 */
const CHIP_CLASS =
  "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-sm border border-line bg-paper-sunken px-2 text-caption font-semibold text-ink-muted"

const PRIORITY_CONFIG: Record<string, { num: number }> = {
  "1": { num: 1 },
  "2": { num: 2 },
  "3": { num: 3 },
  "4": { num: 4 },
  "5": { num: 5 },
  VeryLow:  { num: 1 },
  Low:      { num: 2 },
  Medium:   { num: 3 },
  High:     { num: 4 },
  Urgent:   { num: 5 },
  Critical: { num: 5 },
}

const CARD_VISIBILITY_LAYOUT = {
  type: "spring" as const,
  stiffness: 430,
  damping: 40,
  mass: 0.66,
}

const CARD_VISIBILITY_CONTENT = {
  duration: 0.16,
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
  /**
   * Roving tabindex, the ref and the selection flags from `useListNavigation`.
   * Optional: a card outside a navigable list (the dashboard's preview strip)
   * passes nothing and stays an ordinary card.
   */
  rowProps?: ListRowProps
  /**
   * Who is looking. Normally the signed-in user, read from the auth store — this prop
   * exists so a surface with no session can still say who the viewer is. The landing
   * page mounts this card on fixtures for an anonymous visitor, where the store holds
   * no user and every card would otherwise render as somebody else's.
   *
   * Optional and store-backed by default, so no existing call site changes.
   */
  viewerId?: string | null
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
  rowProps,
  viewerId: viewerIdProp,
}: TodoCardProps) {
  const shouldReduceMotion = useReducedMotion()
  const [optimisticCollapsed, setOptimisticCollapsed] = useState<boolean | null>(null)
  const [isVisibilityPending, setIsVisibilityPending] = useState(false)
  const [completionPhase, setCompletionPhase] = useState<CompletionPhase>(null)
  const [showCompletionCelebration, setShowCompletionCelebration] = useState(false)
  const [isControlHover, setIsControlHover] = useState(false)
  const [isDeleteZoneHovered, setIsDeleteZoneHovered] = useState(false)
  const [isButtonHovered, setIsButtonHovered] = useState(false)
  // Whether the "finish a task that still has unfinished subtasks?" confirmation is open.
  const [subtaskWarnOpen, setSubtaskWarnOpen] = useState(false)
  const mountedRef = useRef(true)
  const celebrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const storeViewerId = useAuthStore((s) => s.user?.userId)
  const viewerId = viewerIdProp ?? storeViewerId
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
  const canDelete = isOwner

  const friendCount = todo.sharedWithUserIds?.length ?? 0
  const joinSlots = todo.requiredWorkers != null && todo.requiredWorkers > 1
    ? todo.requiredWorkers - 1
    : friendCount > 0 ? friendCount : null
  const isFull = !isOwner && joinSlots != null && (todo.workerCount ?? 0) >= joinSlots
  const canJoin = !!onJoin && !isCompleted && !isFull

  const allowCollapse = !isCompleted
  const isCollapsed = allowCollapse && (optimisticCollapsed ?? (todo.hidden ?? false))
  // Callback refs rather than an effect: the counterpart toggle mounts only after the
  // outgoing branch has finished its exit, so it is focused the moment it exists.
  const focusAfterToggle = useRef<"expand" | "collapse" | null>(null)
  const expandButtonRef = useCallback((node: HTMLButtonElement | null) => {
    if (node && focusAfterToggle.current === "expand") {
      focusAfterToggle.current = null
      node.focus()
    }
  }, [])
  const collapseButtonRef = useCallback((node: HTMLButtonElement | null) => {
    if (node && focusAfterToggle.current === "collapse") {
      focusAfterToggle.current = null
      node.focus()
    }
  }, [])
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

  const handleVisibilityToggle = async (nextCollapsed: boolean, fromToggle = false) => {
    if (!onToggleHidden || isVisibilityPending || isCompletionPending) return
    // The pressed toggle unmounts when the card changes shape; hand focus to its
    // counterpart once it exists, or it falls to <body> and the next Tab starts over.
    if (fromToggle) focusAfterToggle.current = nextCollapsed ? "expand" : "collapse"

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

  /**
   * The border says exactly one thing: **this needs answering today.**
   *
   * It used to say three. `border-accent` was returned for "in progress", for
   * "shared", and for "shared AND overdue" — so a task somebody had taken into
   * work and a task merely visible to a friend were drawn identically, and the
   * border stopped carrying information at all. The combined case painted three
   * sides `rgb(99 102 241)`, an indigo that exists in no token, no palette and no
   * other file in the product, which the design system's first rule forbids.
   *
   * Both of the other two facts already have their own mark, which is why the
   * border does not need to repeat either:
   *
   * - **Shared** is the redaction arc in the meta row. It is a property of the
   *   task, not a state it is in, and the arc says how wide the audience is —
   *   which a border colour cannot.
   * - **In progress** is the accent chip ("2/3 · you") and the accent ring on the
   *   completion control, both a few pixels away.
   *
   * And `accent` has an owner. The design system spends it on links, the active
   * tab and **selection** — so while a multi-selection is up, an accent border on
   * an unselected card is the one thing on screen most likely to be misread as
   * selected. A border that competes with the selection outline is worse than a
   * border that says less.
   */
  const borderColor = isUrgentOrOverdue ? "border-alert" : "border-line"

  const completionOverlayColor = isJoining
    ? "bg-accent/10"
    : isCompleting
      ? "bg-positive/10"
      : isReopening
        ? "bg-accent/10"
        : ""

  const completionButtonAnimate = (() => {
    if (isJoining) {
      return {
        scale: [1, 0.88, 1.08, 1],
        rotate: [0, 8, -4, 0],
        backgroundColor: "var(--pl-accent)",
        borderColor: "var(--pl-accent)",
        color: "var(--pl-paper)",
      }
    }
    if (isCompleting) {
      return {
        scale: [1, 0.88, 1.08, 1],
        rotate: [0, -8, 4, 0],
        backgroundColor: "var(--pl-positive)",
        borderColor: "var(--pl-positive)",
        color: "var(--pl-paper)",
      }
    }
    if (isReopening) {
      return {
        scale: [1, 0.94, 1.04, 1],
        rotate: [0, -16, 8, 0],
        backgroundColor: "var(--pl-paper-sunken)",
        borderColor: "var(--pl-ink-subtle)",
        color: "var(--pl-ink-muted)",
      }
    }
    if (isCompleted) {
      return { scale: 1, rotate: 0, backgroundColor: "var(--pl-ink-muted)", borderColor: "var(--pl-ink)", color: "var(--pl-paper)" }
    }
    if (isWorkingOnThis) {
      const activeColor = todo.categoryColor || "var(--pl-ink)"
      return {
        scale: 1, rotate: 0,
        backgroundColor: isButtonHovered ? "rgba(16,185,129,0.06)" : `${activeColor}14`,
        borderColor: isButtonHovered ? "var(--pl-positive)" : activeColor,
        color: isButtonHovered ? "var(--pl-positive)" : activeColor,
      }
    }
    return {
      scale: 1, rotate: 0,
      backgroundColor: "rgba(255,255,255,0)",
      borderColor: (canJoin && isButtonHovered) ? "var(--pl-accent)" : "var(--pl-line-strong)",
      color: "var(--pl-ink)",
    }
  })()

  return (
    <>
      <motion.div
        {...rowProps}
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
        whileHover={isControlHover || isVisibilityPending || isCompletionPending || isCompleted ? undefined : { y: -2 }}
        whileTap={isCompletionPending ? undefined : TAP_CARD}
        transition={{
          layout: layoutTransition,
          default: shouldReduceMotion ? { duration: 0 } : SPRING_RESPONSIVE,
        }}
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
          // Hand the editor the rect of this exact card so its surface grows out of the
          // row that was pressed rather than appearing from the middle of the screen.
          // `currentTarget` is the card root, which is what should be measured — a click
          // on the title would otherwise record the title's box. See lib/shared-origin.ts.
          rememberOrigin(e.currentTarget)
          onEdit()
        }}
        className={cn(
          "relative group/card",
          isVisibilityPending || isCompletionPending ? "cursor-wait" : "cursor-pointer",
          !isCompleted && "z-10",
          /*
           * The keyboard cursor. `[&[data-active]]` rather than Tailwind's
           * `data-[active]:` shorthand because the attribute is valueless — the
           * shorthand compiles to `[data-active="active"]` and would match nothing.
           *
           * An outline, not a ring: the card's own rounding varies with its state,
           * and `outline` follows `border-radius` without needing to be told. It is
           * offset outwards so it never sits on top of the card's content, and it is
           * deliberately NOT the focus indicator — focus may legitimately be
           * elsewhere on the page while the list still has a cursor.
           *
           * It only ever appears for the keyboard. The hook sets the attribute
           * while the cursor is shown: Tab into the list or a navigation key
           * shows it, and any pointer press hides it, so clicking a card never
           * draws an outline around it.
           */
          "[&[data-active]]:outline [&[data-active]]:outline-2 [&[data-active]]:outline-offset-2 [&[data-active]]:outline-ink",
          "[&[data-selected]]:outline [&[data-selected]]:outline-2 [&[data-selected]]:outline-offset-2 [&[data-selected]]:outline-accent",
        )}
      >
      {/* Unread notification plate — top-right, above the card surface (the Card clips its own
          overflow). A labeled pill so a glance reads what happened and who/where (people/branch
          motif + human label + count), not just a colored dot. Hidden while the delete affordance
          is active so the two never collide. */}
      <AnimatePresence>
        {unread && unread.count > 0 && !isDeleteZoneHovered && (
          <NotificationBadgeCluster
            key="unread-cluster"
            groups={unread.groups}
            total={unread.count}
            pulse={!isCompleted}
            // Left of the phone's delete button (right-2 top-2) below `md`, where the two sat on top of each other.
            className="pointer-events-none absolute -top-2 right-14 z-40 md:right-2"
          />
        )}
      </AnimatePresence>
      {/*
        An opaque paper surface with a one-pixel border, and a shadow that deepens on
        hover. The card used to be transparent — the page's gradient showed through every
        task — with a 2px border, a coloured glow computed per category on hover, and a
        `backdrop-blur` switched on under the pointer, which re-rasterised the card on
        every hover. The border keeps its one job: alert means "needs answering today".
      */}
      <Card
        data-task-card=""
        className={cn(
          "group relative overflow-hidden bg-paper transition-[box-shadow,border-color,opacity] duration-base ease-emphasized",
          // A finished task steps back by surface, not by opacity: dimming the whole card to
          // 60% took its struck title down to about 2.3:1, below the floor for text.
          isCompleted ? "border-line bg-paper-sunken" : cn(borderColor, "shadow-sm group-hover/card:shadow-lg"),
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
                      ? "bg-gradient-to-r from-transparent via-accent-surface/80 to-transparent"
                      : isCompleting
                        ? "bg-gradient-to-r from-transparent via-positive/80 to-transparent"
                        : "bg-gradient-to-r from-transparent via-accent-surface/70 to-transparent"
                  )}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Delete Trigger Area (Desktop - slide from right) */}
        {!isCollapsed && canDelete && (
          <div
            role="button"
            tabIndex={0}
            aria-label={`Delete task: ${todo.title}`}
            // Ring inside the edge: the card clips its overflow, which would cut an outward one away.
            className="absolute inset-y-0 right-0 z-30 hidden w-16 overflow-hidden focus-visible:-outline-offset-2 md:flex"
            onMouseEnter={() => { setIsDeleteZoneHovered(true); setIsControlHover(true) }}
            onMouseLeave={() => { setIsDeleteZoneHovered(false); setIsControlHover(false) }}
            onFocus={() => setIsDeleteZoneHovered(true)}
            onBlur={() => setIsDeleteZoneHovered(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                e.stopPropagation()
                onDelete()
              }
            }}
          >
            <AnimatePresence>
              {isDeleteZoneHovered && (
                <motion.div
                  key="delete-panel"
                  // Slides in from the card's edge — a transform, not an animated
                  // `clip-path`, which repainted the strip on every frame.
                  variants={{
                    hidden: { x: "100%", transition: { duration: DURATION_FAST, ease: EASE_EXIT } },
                    visible: { x: 0, transition: { duration: DURATION_UI, ease: EASE_OUT_EXPO } },
                  }}
                  initial="hidden"
                  animate="visible"
                  exit="hidden"
                  style={{
                    background:
                      "linear-gradient(to right, color-mix(in srgb, var(--pl-alert) 0%, transparent) 0%, color-mix(in srgb, var(--pl-alert) 85%, transparent) 35%, var(--pl-alert) 100%)",
                  }}
                  className="h-full w-full flex items-center justify-center text-paper cursor-pointer"
                  whileHover={{ opacity: 0.92 }}
                  onClick={(e) => { e.stopPropagation(); onDelete() }}
                >
                  <motion.div
                    variants={{
                      hidden: { scale: 0.5, opacity: 0, y: 6 },
                      visible: { scale: 1, opacity: 1, y: 0, transition: { ...SPRING_RESPONSIVE, delay: 0.06 } },
                    }}
                  >
                    <Trash className="h-5 w-5" aria-hidden="true" />
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Mobile Delete Button */}
        {!isCollapsed && canDelete && (
          <div className="absolute right-2 top-2 z-30 md:hidden">
            <motion.button
              whileTap={TAP_PRESS}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              aria-label={`Delete task: ${todo.title}`}
              /* Neutral until pressed. Eleven saturated circles used to be the
                 loudest thing on a list screen, which gave the one action a user
                 least wants to hit the most visual weight. The product's one
                 saturated colour is reserved for the confirmation that follows. */
              className="flex h-11 w-11 items-center justify-center rounded-full text-ink-muted transition-colors duration-fast active:bg-alert-surface active:text-alert"
            >
              <Trash className="h-4 w-4" aria-hidden="true" />
            </motion.button>
          </div>
        )}

        {/* Subtle category watermark */}
        {!isCompleted && CategoryIcon && !isCollapsed && (
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-6 -right-6 opacity-5 transition-opacity duration-slow group-hover/card:opacity-10">
            <CategoryIcon className="h-28 w-28 text-ink" strokeWidth={1} />
          </div>
        )}

        <CardContent
          className={cn(
            isCollapsed ? "px-5 py-2" : isSparse ? "px-5 py-4" : "p-5",
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
                <div className="flex w-8 items-center justify-center">
                  <motion.button
                    ref={expandButtonRef}
                    type="button"
                    // aria-disabled, not disabled: a disabled button cannot take focus, and this
                    // one is born mid-request when focus is handed to it. The handler already
                    // refuses re-entry while a toggle is in flight.
                    aria-disabled={isVisibilityPending || isCompletionPending}
                    aria-busy={isVisibilityPending || isCompletionPending}
                    whileTap={isVisibilityPending || isCompletionPending ? undefined : TAP_PRESS}
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleVisibilityToggle(false, true)
                    }}
                    className={cn(
                      "touch-target flex h-7 w-7 items-center justify-center rounded-full border border-line-strong text-ink-muted transition-colors duration-fast hover:border-ink hover:text-ink",
                      (isVisibilityPending || isCompletionPending) && "opacity-60 cursor-wait"
                    )}
                    aria-label="Expand task card"
                    aria-expanded={!isCollapsed}
                  >
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  </motion.button>
                </div>
                {/* Redacted: the task is hidden, so even its category is blurred until the
                    pointer (or focus) is on it. Two copies crossfade — the blurred one fades out
                    as the clear one fades in — because animating `filter` itself repaints the
                    chip on every frame; only opacity moves here. */}
                <motion.span
                  initial={{ x: -10, opacity: 0 }}
                  animate={{
                    x: 0,
                    opacity: isVisibilityPending ? 0.62 : 1,
                  }}
                  transition={contentTransition}
                  className="inline-grid"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      CHIP_CLASS,
                      "blur-[3px] transition-opacity duration-base [grid-area:1/1]",
                      "group-hover/card:opacity-0 group-focus-within/collapsed:opacity-0",
                    )}
                  >
                    {cardCategoryLabel}
                  </span>
                  <span
                    className={cn(
                      CHIP_CLASS,
                      "border-line-strong text-ink opacity-0 transition-opacity duration-base [grid-area:1/1]",
                      "group-hover/card:opacity-100 group-focus-within/collapsed:opacity-100",
                    )}
                  >
                    {cardCategoryLabel}
                  </span>
                </motion.span>
              </div>
              {CategoryIcon && (
                <CategoryIcon
                  aria-hidden="true"
                  className="h-5 w-5 flex-shrink-0 text-ink-subtle transition-colors duration-fast group-hover/collapsed:text-ink-muted"
                  strokeWidth={1.5}
                />
              )}
            </motion.div>
          ) : (
            <>
              <div className="flex items-start gap-4">
                {/* The controls sit against the title's first line — the check is what the
                    eye reads with the title, not something centred against the whole card,
                    where it drifted lower the more the card had to say. */}
                {/* The offset centres the 32px check on the title's first line: 22px on phones
                    (text-body, leading-snug), 28px from sm (title-sm).
                    gap-4: each control's `.touch-target` reaches 6-8px past its circle, and at
                    gap-2 the hide toggle's hit area covered the bottom of the check's — a thumb
                    just under the check hid the card instead of completing it. */}
                <div className="-mt-1 flex w-8 flex-shrink-0 flex-col items-center gap-4 sm:-mt-0.5">
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
                    whileHover={!isCompletionPending ? { scale: 1.06 } : undefined}
                    whileTap={!isCompletionPending ? TAP_PRESS : undefined}
                    disabled={isCompletionPending}
                    aria-busy={isCompletionPending}
                    className={cn(
                      "touch-target h-8 w-8 rounded-full border-2 flex items-center justify-center",
                      "transition-[box-shadow,opacity] duration-fast",
                      // Phase rings
                      isJoining && "shadow-lg ring-2 ring-accent/35",
                      isCompleting && "shadow-lg ring-2 ring-positive/30",
                      isReopening && "shadow-md ring-2 ring-accent/20",
                      // Working state rings (not in phase)
                      !isCompletionPending && isWorkingOnThis && !isCompleted && (
                        isButtonHovered
                          ? "ring-2 ring-positive/45 shadow-md"
                          : "ring-2 ring-accent-surface/45 shadow-sm"
                      ),
                      // Idle + joinable: violet ring on hover
                      !isCompletionPending && !isWorkingOnThis && !isCompleted && canJoin && isButtonHovered && "ring-2 ring-accent/50 shadow-md",
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
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ scale: 0.78, rotate: 16, opacity: 0 }}
                          transition={COMPLETION_BUTTON_TRANSITION}
                        >
                          {/* The ink fill and the drawn stroke ARE the animation here —
                              see InkCheck. The wrapper only handles the exit, because a
                              mark being taken away is an undo, not an achievement, and
                              should not be drawn in reverse. */}
                          <InkCheck size={20} />
                        </motion.div>
                      )}

                      {/* REOPENING spinner */}
                      {isReopening && (
                        <motion.div
                          key="reopening"
                          initial={{ opacity: 0, scale: 0.8, rotate: 0 }}
                          animate={{ opacity: 1, scale: 1, rotate: 360 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          transition={{ duration: 0.48, ease: EASE_OUT_EXPO }}
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
                          // A still dot. It used to pulse forever — on every card someone
                          // was working on, for as long as the list was open — and nothing
                          // at rest may animate forever.
                          className="h-2.5 w-2.5 rounded-full bg-current"
                        />
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
                          <Zap className="h-3 w-3" style={{ color: "var(--pl-accent)" }} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.button>

                  {allowCollapse && (
                    <motion.button
                      ref={collapseButtonRef}
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onMouseEnter={() => setIsControlHover(true)}
                      onMouseLeave={() => setIsControlHover(false)}
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleVisibilityToggle(true, true)
                      }}
                      aria-disabled={isVisibilityPending || isCompletionPending}
                      aria-busy={isVisibilityPending || isCompletionPending}
                      whileTap={isVisibilityPending || isCompletionPending ? undefined : TAP_PRESS}
                      className={cn(
                        "touch-target flex h-7 w-7 items-center justify-center rounded-full text-ink-subtle transition-colors duration-fast hover:bg-paper-sunken hover:text-ink",
                        (isVisibilityPending || isCompletionPending) && "opacity-60 cursor-wait"
                      )}
                      aria-label="Collapse task card"
                      aria-expanded={!isCollapsed}
                    >
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    </motion.button>
                  )}
                </div>

                {/* Body: all task content, grows with data */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <h3
                        className={cn(
                          // pr-10 on phones reserves the lane the delete button occupies;
                          // without it the first line ran underneath it. Titles are shown in
                          // full up to three lines — they used to be cut at 40 characters in
                          // JavaScript ("battery for the smok…") whatever the card's width.
                          "line-clamp-3 break-words text-body font-semibold leading-snug tracking-tight transition-colors duration-fast sm:text-title-sm",
                          canDelete && !isCollapsed && "pr-10 md:pr-0",
                          isCompleting
                            ? "text-ink-subtle line-through decoration-positive/70 decoration-2"
                            : isCompleted
                              ? isReopening
                                ? "text-ink-muted"
                                : "text-ink-muted group-hover/card:text-ink"
                              : "text-ink"
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
                              "bg-no-repeat [background-image:linear-gradient(var(--pl-line-strong),var(--pl-line-strong))]",
                              "[background-position:0_53%] [background-size:100%_2px]",
                              "[-webkit-box-decoration-break:clone] [box-decoration-break:clone]",
                              "transition-[background-size] duration-deliberate ease-emphasized",
                              "group-hover/card:[background-size:0%_2px] motion-reduce:transition-none",
                            )}
                          >
                            {todo.title}
                          </span>
                        ) : (
                          todo.title
                        )}
                      </h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {!isCompleted && todo.categoryName && (
                        <span className={cn(CHIP_CLASS, "max-w-40")}>
                          <span className="truncate">{todo.categoryName}</span>
                        </span>
                      )}
                      {!isCompleted && <PriorityMeter value={priorityConfig.num} size="sm" />}
                      {/*
                       * Two different facts, and they were previously one chip.
                       *
                       * For the OWNER the interesting thing about a shared task is *who
                       * can see it*, which is a shape rather than a word — the arc
                       * narrows as the audience does, and the count rolls beside it.
                       * A generic share icon said only "not private", which the owner
                       * already knew when they shared it.
                       *
                       * For a VIEWER the interesting thing is *whose task this is*.
                       * That is attribution, not audience: the viewer cannot change who
                       * else can see it, and the arc would be answering a question they
                       * did not ask. So they keep the name.
                       */}
                      {showShareBadge && isOwner && (
                        <RedactionBadge
                          audience={todo.isPublic ? "public" : "shared"}
                          viewerCount={todo.isPublic ? undefined : friendCount}
                          size="sm"
                        />
                      )}
                      {showShareBadge && !isOwner && (
                        <span className={cn(CHIP_CLASS, "max-w-48")}>
                          <Share2 className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                          <span className="truncate">{publicBadgeLabel}</span>
                        </span>
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
                          <span
                            key="workers-badge"
                            className={cn(
                              CHIP_CLASS,
                              "transition-colors duration-base",
                              isEffectivelyWorking && "border-accent/30 bg-accent-surface text-accent"
                            )}
                          >
                            <Users className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                            <span className="tabular-nums">{label}</span>
                            {/* No width animation: it animated `max-width`, a layout property,
                                and pushed every chip after it sideways frame by frame. */}
                            {isEffectivelyWorking ? <span className="animate-fade-in">· you</span> : null}
                          </span>
                        )
                      })()}
                    </div>
                  </div>
                  {!isCompleted && todo.description && (
                    <p className="mt-3 line-clamp-2 break-words text-body-sm text-ink-muted">{todo.description}</p>
                  )}
                  {(isDueOverdue || (todo.dueDate && !isCompleted)) && (
                    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption font-medium">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-muted">
                        <Calendar className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                        {hasDueRange ? (
                          // hasDueRange guarantees both bounds are set, so the assertions are safe.
                          <span className="tabular-nums text-ink">
                            {formatDate(todo.dueDateStart!)} – {formatDate(todo.dueDate!)}
                          </span>
                        ) : (
                          <span className="tabular-nums text-ink">{formatDate(todo.dueDate || "")}</span>
                        )}
                      </span>
                      {isDueOverdue && <span className="whitespace-nowrap font-semibold text-alert">Overdue</span>}
                    </div>
                  )}
                  {!isCompleted && (todo.expectedDate || todo.delay) && (
                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                      {todo.expectedDate && (
                        <span className={CHIP_CLASS}>
                          <Clock className="h-3 w-3" aria-hidden="true" />
                          <span className="tabular-nums">Expected {formatDate(todo.expectedDate)}</span>
                        </span>
                      )}
                      {todo.delay && (
                        <span className={cn(CHIP_CLASS, "border-warn/30 bg-warn-surface text-warn")}>
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                          <span>{todo.delay} delay</span>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      </motion.div>

      {/* Warn before finishing a task that still has unfinished subtasks. Confirming runs the normal
          completion flow (animation + commit); "Keep working" simply dismisses. */}
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
  /*
   * Callback identity is deliberately ignored — the tasks page re-creates every
   * handler on each render and comparing them would re-render 200 cards for
   * nothing (the handlers read live data through refs; see the page).
   *
   * `rowProps` is the exception that has to be compared field by field. Its object
   * identity changes on every render, so comparing the object would defeat the
   * memo entirely; ignoring it would freeze the keyboard cursor on whichever card
   * happened to hold it first, which is the same defect wearing a different hat.
   * Its `ref` and `onFocus` are cached per id by the hook, so only these four
   * values can actually change. `aria-current` moves with `data-active` today,
   * but it is compared on its own anyway: leaving it to ride along is how a card
   * ends up announcing a cursor it no longer shows the moment the two diverge.
   */
  (prev, next) =>
    prev.todo === next.todo &&
    prev.variant === next.variant &&
    prev.rowProps?.tabIndex === next.rowProps?.tabIndex &&
    prev.rowProps?.["data-active"] === next.rowProps?.["data-active"] &&
    prev.rowProps?.["aria-current"] === next.rowProps?.["aria-current"] &&
    prev.rowProps?.["data-selected"] === next.rowProps?.["data-selected"],
)
