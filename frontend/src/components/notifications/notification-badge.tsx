"use client"

import { memo } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { Check } from "lucide-react"
import { getNotificationKind } from "@/lib/notifications/types"
import { cn } from "@/lib/utils"

interface NotificationBadgeProps {
  /** The notification type (latest for a task) — drives the glyph and tint. */
  type: string
  /** Unread count for the count bubble (branch badge). */
  count?: number
  /** Render the numeric count bubble (branch) vs. icon-only (card dot). */
  showCount?: boolean
  /** Diameter in px. */
  size?: number
  /** Animate a soft recurring ping ring (draws the eye to a fresh unread). */
  pulse?: boolean
  className?: string
}

/**
 * A small circular notification glyph — the unread mark on a task card and the unread badge by the
 * branch composer. It picks its icon + accent from the notification type, springs in on mount, and
 * (optionally) emits a soft ping ring. The "all collaborators done" kind renders the dedicated
 * people-and-check composite. Fully reduced-motion aware.
 */
export const NotificationBadge = memo(function NotificationBadge({
  type,
  count = 0,
  showCount = false,
  size = 20,
  pulse = true,
  className,
}: NotificationBadgeProps) {
  const reduce = useReducedMotion()
  const kind = getNotificationKind(type)
  const Icon = kind.icon
  const tint = kind.tint
  const iconSize = Math.round(size * 0.56)

  return (
    <motion.span
      initial={reduce ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
      animate={reduce ? { opacity: 1 } : { scale: 1, opacity: 1 }}
      exit={reduce ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
      transition={{ type: "spring", stiffness: 540, damping: 26, mass: 0.7 }}
      className={cn("relative inline-flex items-center justify-center rounded-full shadow-sm", className)}
      style={{
        width: size,
        height: size,
        background: `${tint}1f`,
        border: `1.5px solid ${tint}66`,
        color: tint,
        boxShadow: `0 2px 8px -2px ${tint}55`,
      }}
      role="status"
      aria-label={showCount && count > 0 ? `${count} unread · ${kind.label}` : kind.label}
    >
      {pulse && !reduce && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{ border: `1.5px solid ${tint}` }}
          initial={{ scale: 1, opacity: 0.45 }}
          animate={{ scale: 1.9, opacity: 0 }}
          transition={{ duration: 1.9, repeat: Infinity, ease: "easeOut" }}
        />
      )}

      {kind.composite === "people-check" ? (
        <PeopleCheck size={iconSize} tint={tint} />
      ) : (
        <Icon style={{ width: iconSize, height: iconSize }} strokeWidth={2.4} />
      )}

      {showCount && count > 1 && (
        <motion.span
          key={count}
          initial={reduce ? false : { scale: 0.5, y: -2, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 620, damping: 24 }}
          className="absolute -top-1.5 -right-1.5 flex items-center justify-center rounded-full px-1 font-black tabular-nums text-white"
          style={{
            minWidth: 15,
            height: 15,
            fontSize: 9.5,
            background: tint,
            boxShadow: `0 1px 4px -1px ${tint}aa`,
            border: "1.5px solid white",
          }}
        >
          {count > 99 ? "99+" : count}
        </motion.span>
      )}
    </motion.span>
  )
})

/** "Little people + checkmark" — Users with a small tinted check disc at the lower-right. */
function PeopleCheck({ size, tint }: { size: number; tint: string }) {
  const Users = getNotificationKind("task.participants_done").icon
  const disc = Math.round(size * 0.62)
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <Users style={{ width: size, height: size }} strokeWidth={2.2} />
      <span
        className="absolute flex items-center justify-center rounded-full text-white"
        style={{
          width: disc,
          height: disc,
          right: -disc * 0.35,
          bottom: -disc * 0.3,
          background: tint,
          border: "1.5px solid white",
        }}
      >
        <Check style={{ width: disc * 0.6, height: disc * 0.6 }} strokeWidth={4} />
      </span>
    </span>
  )
}
