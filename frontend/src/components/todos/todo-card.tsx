"use client"

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { AnimatePresence, useReducedMotion } from "framer-motion"
import { motion } from "@/components/ui/motion"
import {
  Trash, Check, Calendar, AlertTriangle, Share2, Eye, Clock, Zap, Users,
} from "lucide-react"
import { ICON_MAP } from "@/lib/icon-map"
import { Card, CardContent } from "@/components/ui/card"
import { isTodoOwner, type Todo } from "@/types/todo"
import { formatDate, isPastDate, truncateText, formatPublicName, cn } from "@/lib/utils"
import { useAuthStore } from "@/store/auth"
import { useNotificationStore, useTaskUnread } from "@/store/notifications"
import {
  DURATION_FAST,
  DURATION_SLOW,
  EASE_OUT_EXPO,
  HOVER_LIFT,
  SPRING_RESPONSIVE,
  SPRING_LAYOUT,
  TAP_CARD,
  TAP_PRESS,
  TWEEN_EXIT,
  TWEEN_FAST,
  TWEEN_UI,
  VARIANTS_CARD,
} from "@/lib/animations"
import { haptic } from "@/lib/haptics"
import { CompletionCelebration } from "@/components/animated/celebration"
import { useArrivalHandled } from "@/components/animated/entrance"
import { NotificationBadgeCluster } from "@/components/notifications/notification-badge-cluster"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { PriorityMeter } from "@/components/ui/priority-meter"
import { getBoolPreference, setBoolPreference, SUPPRESS_INCOMPLETE_SUBTASK_WARNING } from "@/lib/ui-preferences"
import { INCOMPLETE_SUBTASK_DIALOG, incompleteSubtaskDescription } from "@/lib/subtask-warning"
import { InkCheck } from "@/components/ui/ink-check"
import { rememberOrigin } from "@/lib/shared-origin"
import { RedactionBadge } from "@/components/ui/redaction-badge"
import type { ListRowProps } from "@/hooks/use-list-navigation"
import { springEasing, useHeightTransition } from "@/hooks/use-height-transition"

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

const COMPLETION_PRE_COMMIT_MS = 360
const REOPEN_PRE_COMMIT_MS = 260
const JOIN_PRE_COMMIT_MS = 280

/**
 * The sweep across the card and the reopen turn. Both answer a press, so both finish
 * on `slow` — the ceiling for a response — rather than running past the pre-commit
 * window they decorate.
 */
const PHASE_TWEEN = { duration: DURATION_SLOW, ease: EASE_OUT_EXPO } as const

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

/**
 * Where the hide toggle (the eye) goes depends on how much the card holds.
 *
 * The completion circle sits on the card's vertical centre at every height, and on a card
 * with room the eye sits in the bottom-left corner under it, 22px from both edges. That
 * corner needs a body at least this tall: the eye's row — its 16px margin, the 28px toggle
 * and its 1px inset — is mirrored above the 32px circle, 45 + 32 + 45. Below it the two
 * controls would be on top of each other, and holding the card open to this height was what
 * made every sparse task as tall as a full one: a title and a priority, 188px.
 *
 * So a card with less to say keeps its natural height, and the eye opens its chip row
 * instead — out of the circle's way, the same 44px target, under the first letter of the
 * title on every such card. Measured, not guessed: a title's wrap depends on the column.
 */
const EYE_CORNER_MIN_BODY = 122
/**
 * In the chip row the eye takes a chip's room, so it can push the last chip onto a second
 * line — a body up to this much taller than it would be with the eye in the corner. A card
 * goes back to the corner only past that, or the move would undo itself: back in the corner
 * the line it caused is gone, and the body is short again.
 */
const EYE_ROW_GROWTH = 24 + 8

/**
 * A card changing shape — hidden down to its one row, or opened back out — glides to its
 * new height, and everything below it in the column, the grid and the page follows on the
 * same curve (`useHeightTransition`). The curve is `SPRING_LAYOUT`, the one a card already
 * glides up its column on: critically damped, so it gathers speed from rest instead of
 * lurching — a front-loaded curve moved a short card's neighbours 25px in its first frame —
 * and lands without passing its height. Settled in about 0.4s; the content cross-fades
 * inside it on `fast`.
 */
let resize: { duration: number; easing: string } | null = null
const resizeTransition = () => (resize ??= springEasing(SPRING_LAYOUT))
const CONTENT_IN = { duration: DURATION_FAST + 0.06, ease: EASE_OUT_EXPO, delay: 0.05 } as const

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
  // Inside a page's grid the grid rises the card in; rising here as well would stack two rises.
  const arrivalHandled = useArrivalHandled()
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
  // A viewer sees whose task it is; without a name it is simply shared with them — never "Public".
  const publicBadgeLabel = todo.authorName ? formatPublicName(todo.authorName) : "Shared"
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

  // The eye's place (see EYE_CORNER_MIN_BODY): the body is measured before the first paint,
  // and again whenever its size changes. It starts in the corner, so the first measurement
  // is of the body without the eye in it.
  const cardRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [eyeInRow, setEyeInRow] = useState(false)
  const isInfoDense = !!todo.description && (!!todo.dueDate || !!todo.expectedDate || !!todo.delay)
  // Critically damped: a card closing a gap or moving up its column lands without overshoot.
  const layoutTransition = shouldReduceMotion ? { duration: 0 } : SPRING_LAYOUT
  const contentTransition = shouldReduceMotion ? { duration: 0 } : TWEEN_FAST

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

  useIsomorphicLayoutEffect(() => {
    if (!allowCollapse || isCollapsed) return
    const body = bodyRef.current
    if (!body) return
    const place = () => {
      const height = body.offsetHeight
      setEyeInRow((inRow) => (inRow ? height < EYE_CORNER_MIN_BODY + EYE_ROW_GROWTH : height < EYE_CORNER_MIN_BODY))
    }
    place()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(place)
    observer.observe(body)
    return () => observer.disconnect()
  }, [allowCollapse, isCollapsed])

  // Hiding, opening, or the eye changing places: the card glides to its new height.
  useHeightTransition(cardRef, isCollapsed ? "collapsed" : eyeInRow ? "open-row" : "open-corner", {
    ...resizeTransition(),
    disabled: !!shouldReduceMotion,
  })

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

    // The burst is nothing but travel, and MotionConfig strips travel under reduced
    // motion — what would be left is eighteen pieces blinking on one spot.
    if (!isCompleted && !shouldReduceMotion) {
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
   * The frame says who a task concerns, in one of two colours.
   *
   * - **`alert`: this needs answering today.** Urgent, due today or overdue. It outranks
   *   everything else, because it is the one fact that asks for action now.
   * - **`accent`: other people can see this.** Any task shared with a friend, or with all
   *   of them, is framed in the product's blue, so a list reads at a glance as "mine" and
   *   "ours". The ring beside the title says how many; the frame says that it is shared at
   *   all, from across the room.
   * - **`line`** for a private task.
   *
   * The frame used to be alert-or-nothing: shared tasks and private ones were drawn
   * identically, and the difference that is the whole point of the product lived only in a
   * 14px mark. Before that it had gone too far the other way — accent for "in progress" and
   * for "shared" alike, and an indigo no token defined for both — so this keeps exactly one
   * meaning per colour: work in progress is the check and the workers chip, never the frame.
   * The keyboard cursor and a selection are outlines offset outside the card, so they never
   * sit on the frame itself.
   */
  const borderColor = isUrgentOrOverdue ? "border-alert" : isShared ? "border-accent" : "border-line"

  /**
   * The hover shadow takes the task's colour: the category's when it has one, the accent
   * while you are working on it, alert when it is urgent — and a plain grey otherwise. It
   * is the category colour at 20%, in the two-layer shadow the card always used, carried by
   * a custom property so the hover itself stays a class and CSS owns the transition.
   */
  const glowColor = isWorkingOnThis
    ? "var(--pl-accent)"
    : todo.categoryColor?.trim() || (isUrgentOrOverdue ? "var(--pl-alert)" : null)
  const glowStyle = glowColor
    ? ({ "--card-glow": `color-mix(in srgb, ${glowColor} 20%, transparent)` } as CSSProperties)
    : undefined

  const completionOverlayColor = isJoining
    ? "bg-accent/10"
    : isCompleting
      ? "bg-positive/10"
      : isReopening
        ? "bg-accent/10"
        : ""

  /**
   * The completion control's colour, per phase. CSS owns it (`transition-colors`), not
   * framer-motion: a colour is not composited, and it used to ride the button's spring,
   * repainting the control on every frame of the settle. The same spring was also handed
   * four-step `scale`/`rotate` keyframes, which a spring cannot play — it springs from the
   * first value to the last, both of them 1 — so the wiggle they described never ran.
   * What the control does on a press is `TAP_PRESS`; the phase is said by the colour, the
   * sweep across the card and the icon swap below.
   */
  const workingTint = todo.categoryColor || null
  const completionButtonTone = isJoining
    ? "border-accent bg-accent text-paper"
    : isCompleting
      ? "border-positive bg-positive text-paper"
      : isReopening
        ? "border-ink-subtle bg-paper-sunken text-ink-muted"
        : isCompleted
          ? "border-ink bg-ink-muted text-paper"
          : isWorkingOnThis
            ? isButtonHovered
              ? "border-positive bg-positive/5 text-positive"
              // The category's own colour is the user's data, so it arrives inline below.
              : workingTint ? null : "border-ink bg-ink/5 text-ink"
            : cn("bg-transparent text-ink", canJoin && isButtonHovered ? "border-accent" : "border-line-strong")
  const completionButtonTint =
    isWorkingOnThis && !isCompletionPending && !isCompleted && !isButtonHovered && workingTint
      ? { backgroundColor: `${workingTint}14`, borderColor: workingTint, color: workingTint }
      : undefined

  return (
    <>
      <motion.div
        {...rowProps}
        // Position only. A size `layout` animated hiding a card (166px -> 56px) as a scaleY
        // on this root, and nothing inside the Card is a layout node to correct it: the
        // collapsed row arrived stretched three times its height and settled. The Card's
        // real height glides instead (`useHeightTransition` below), so its neighbours, the
        // grid and the pager under it follow in the flow on the same curve.
        layout="position"
        initial={arrivalHandled ? false : VARIANTS_CARD.hidden}
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
        whileHover={isControlHover || isVisibilityPending || isCompletionPending || isCompleted ? undefined : HOVER_LIFT}
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
        An opaque paper surface with a one-pixel frame, and a shadow that deepens on hover
        in the task's own colour. The card used to be transparent — the page's gradient
        showed through every task — with a `backdrop-blur` switched on under the pointer,
        which re-rasterised the card on every hover; the glow was computed in JavaScript from
        a hover state. Now it is a class and a custom property, and CSS runs the transition.
      */}
      <Card
        ref={cardRef}
        data-task-card=""
        style={isCompleted ? undefined : glowStyle}
        className={cn(
          "group relative overflow-hidden bg-paper transition-[box-shadow,border-color,opacity] duration-base ease-emphasized",
          // A finished task steps back by surface, not by opacity: dimming the whole card to
          // 60% took its struck title down to about 2.3:1, below the floor for text.
          isCompleted
            ? "border-line bg-paper-sunken"
            : cn(
                borderColor,
                "shadow-sm",
                glowStyle
                  ? "group-hover/card:shadow-[0_8px_32px_-4px_var(--card-glow),0_4px_16px_-2px_var(--card-glow)]"
                  : "group-hover/card:shadow-lg"
              ),
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
              transition={shouldReduceMotion ? { duration: 0 } : TWEEN_FAST}
              className={cn("pointer-events-none absolute inset-0 z-20 overflow-hidden", completionOverlayColor)}
            >
              {!shouldReduceMotion && (
                <motion.div
                  initial={{ x: "-45%", opacity: 0 }}
                  animate={{ x: "145%", opacity: [0, 0.42, 0] }}
                  transition={PHASE_TWEEN}
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
                    hidden: { x: "100%", transition: TWEEN_EXIT },
                    visible: { x: 0, transition: TWEEN_UI },
                  }}
                  initial="hidden"
                  animate="visible"
                  exit="hidden"
                  className="flex h-full w-full cursor-pointer items-center justify-center bg-gradient-to-r from-alert/0 via-alert/85 via-35% to-alert text-paper"
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
            // The rail uses symmetric 20px padding. Its eye's 1px margins plus this padding
            // and the Card's 1px border make both visible border-box insets exactly 22px.
            isCollapsed ? "px-5 py-2" : "p-5",
            "relative z-10"
          )}
        >
          {/* The two shapes cross-fade while the card glides between their heights: the one
              leaving is lifted out of the flow where it stood (`popLayout`) and fades under the
              card's edge, so the height the card glides to is the arriving shape's alone. */}
          <AnimatePresence initial={false} mode="popLayout">
          {isCollapsed && allowCollapse ? (
            <motion.div
              key="collapsed"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, pointerEvents: "none", transition: shouldReduceMotion ? { duration: 0 } : TWEEN_EXIT }}
              transition={shouldReduceMotion ? { duration: 0 } : CONTENT_IN}
              onHoverStart={() => setIsControlHover(true)}
              onHoverEnd={() => setIsControlHover(false)}
              className="relative flex items-center justify-between gap-3 group/collapsed"
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
            <motion.div
              key="open"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, pointerEvents: "none", transition: shouldReduceMotion ? { duration: 0 } : TWEEN_EXIT }}
              transition={shouldReduceMotion ? { duration: 0 } : CONTENT_IN}
              className="relative"
            >
              <div className="flex items-center gap-4">
                {/* Equal 1fr tracks centre the circle in the symmetric card border-box,
                    including fractional/odd heights. The eye's 1px bottom/left margins add to
                    20px padding + 1px card border: its visible border-box is inset by 22px.

                    The rail has no height of its own any more: it stretches to the body. The
                    eye is here only when the body is tall enough for the corner (see
                    EYE_CORNER_MIN_BODY), where its 44px target clears the circle's; otherwise
                    it ends the chip row. The visible circle springs inside its fixed hit
                    target, so spring overshoot cannot move or scale the semantic target. */}
                <div className="grid w-8 flex-shrink-0 grid-rows-[1fr_auto_1fr] justify-items-center self-stretch">
                  {/* 3-state completion / join button */}
                  <motion.button
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation()
                      handleButtonClick()
                    }}
                    onMouseEnter={() => { setIsControlHover(true); setIsButtonHovered(true) }}
                    onMouseLeave={() => { setIsControlHover(false); setIsButtonHovered(false) }}
                    animate="rest"
                    whileHover={!isCompletionPending ? "hover" : undefined}
                    whileTap={!isCompletionPending ? "pressed" : undefined}
                    disabled={isCompletionPending}
                    aria-busy={isCompletionPending}
                    className={cn(
                      "touch-target row-start-2 flex h-8 w-8 items-center justify-center rounded-full",
                      isCompletionPending ? "cursor-wait" : "cursor-pointer",
                    )}
                    aria-label={
                      isCompleted ? "Mark as incomplete"
                      : isWorkingOnThis ? "Mark as complete"
                      : canJoin ? "Take it – start working"
                      : "Mark as complete"
                    }
                  >
                    <motion.span
                      data-completion-circle=""
                      aria-hidden="true"
                      variants={{ rest: { scale: 1 }, hover: { scale: 1.06 }, pressed: TAP_PRESS }}
                      transition={SPRING_RESPONSIVE}
                      style={completionButtonTint}
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-full border-2",
                        "transition-[color,background-color,border-color,box-shadow,opacity] duration-fast",
                        completionButtonTone,
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
                        // Idle + joinable: an accent ring on hover
                        !isCompletionPending && !isWorkingOnThis && !isCompleted && canJoin && isButtonHovered && "ring-2 ring-accent/50 shadow-md",
                      )}
                    >
                      <AnimatePresence initial={false} mode="wait">
                        {/* JOINING phase */}
                        {isJoining && (
                          <motion.div
                            key="joining"
                            initial={{ scale: 0.6, opacity: 0, rotate: -20 }}
                            animate={{ scale: 1, opacity: 1, rotate: 0 }}
                            exit={{ scale: 0.6, opacity: 0 }}
                            transition={SPRING_RESPONSIVE}
                          >
                            <Zap className="h-4 w-4 stroke-[2.5]" aria-hidden="true" />
                          </motion.div>
                        )}

                        {/* COMPLETED or COMPLETING (not joining, not reopening) */}
                        {!isJoining && (isCompleted || isCompleting) && !isReopening && (
                          <motion.div
                            key="check"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ scale: 0.78, rotate: 16, opacity: 0 }}
                            transition={SPRING_RESPONSIVE}
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
                            transition={PHASE_TWEEN}
                            className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent"
                          />
                        )}

                        {/* WORKING – hover shows the checkmark, at rest a still dot */}
                        {isWorkingOnThis && !isCompleted && !isCompletionPending && isButtonHovered && (
                          <motion.div
                            key="work-check"
                            initial={{ scale: 0, opacity: 0, rotate: -12 }}
                            animate={{ scale: 1, opacity: 1, rotate: 0 }}
                            exit={{ scale: 0, opacity: 0 }}
                            transition={SPRING_RESPONSIVE}
                          >
                            <Check className="h-4 w-4 stroke-[3]" aria-hidden="true" />
                          </motion.div>
                        )}
                        {isWorkingOnThis && !isCompleted && !isCompletionPending && !isButtonHovered && (
                          <motion.div
                            key="working-dot"
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.8, opacity: 0 }}
                            transition={SPRING_RESPONSIVE}
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
                            transition={SPRING_RESPONSIVE}
                          >
                            <Zap className="h-3 w-3 text-accent" aria-hidden="true" />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.span>
                  </motion.button>

                  {allowCollapse && !eyeInRow && (
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
                        "touch-target row-start-3 mb-px ml-px mt-4 flex h-7 w-7 justify-self-start items-center justify-center self-end rounded-full text-ink-subtle transition-colors duration-fast hover:bg-paper-sunken hover:text-ink",
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
                <div ref={bodyRef} className="flex-1 min-w-0">
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
                    {/* Every chip below is for an open task. On a completed card the row used to
                        render empty and still take the column's 12px gap, which put the title
                        6px above the centred check. */}
                    {!isCompleted && (
                      <div className="flex flex-wrap items-center gap-2">
                        {allowCollapse && eyeInRow && (
                          // The eye opening the chips, on a card too short for its corner: chip
                          // height, so the row is no taller for it, and first, so it can never be
                          // left alone on a line or end up under the desktop delete strip.
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
                              "touch-target flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-ink-subtle transition-colors duration-fast hover:bg-paper-sunken hover:text-ink",
                              (isVisibilityPending || isCompletionPending) && "opacity-60 cursor-wait"
                            )}
                            aria-label="Collapse task card"
                            aria-expanded={!isCollapsed}
                          >
                            <Eye className="h-4 w-4" aria-hidden="true" />
                          </motion.button>
                        )}
                        {todo.categoryName && (
                          <span className={cn(CHIP_CLASS, "max-w-40")}>
                            <span className="truncate">{todo.categoryName}</span>
                          </span>
                        )}
                        <PriorityMeter value={priorityConfig.num} size="sm" />
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
                          const slots = todo.isPublic ? null : todo.requiredWorkers != null
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
                    )}
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
            </motion.div>
          )}
          </AnimatePresence>
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
