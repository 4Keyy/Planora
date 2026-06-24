"use client"

import { memo } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { getNotificationKind } from "@/lib/notifications/types"
import { NotificationBadge } from "./notification-badge"
import { cn } from "@/lib/utils"

/** One unread type-group feeding a disc in the cluster (newest type first). */
export interface BadgeClusterGroup {
  type: string
  count: number
}

interface NotificationBadgeClusterProps {
  /** Per-type unread groups, already ordered newest-first. */
  groups: BadgeClusterGroup[]
  /** Total unread across all groups — shown on the front disc. */
  total: number
  /** Animate the soft ping ring on the front disc (suppressed on completed cards). */
  pulse?: boolean
  className?: string
}

// Visual constants tuned so discs overlap like stacked rings without ever clipping the card or
// growing past the badge slot. Capped at four visible discs + a "+N" pip so a noisy task stays tidy.
const DISC = 22
const OVERLAP = 9
const MAX_DISCS = 4

/**
 * The card's notification badge **cluster**. A single unread type keeps the rich labeled pill (icon +
 * people/branch motif + human label + count) so a glance reads *what happened*. Two or more types
 * fan out as overlapping tinted discs — newest at the front-left (highest z-index), each successive
 * disc nudged left and scaled/faded down for depth ("Audi rings"). The total sits on the front disc;
 * a "+N" pip covers overflow. Fully reduced-motion aware; color is never the only signal (each disc
 * carries its type's glyph).
 */
export const NotificationBadgeCluster = memo(function NotificationBadgeCluster({
  groups,
  total,
  pulse = true,
  className,
}: NotificationBadgeClusterProps) {
  const reduce = useReducedMotion()

  if (!groups || groups.length === 0 || total <= 0) return null

  // One type → the self-explaining pill (unchanged from before the cluster existed).
  if (groups.length === 1) {
    return (
      <NotificationBadge
        type={groups[0].type}
        variant="pill"
        count={total}
        showCount
        size={DISC}
        pulse={pulse}
        className={className}
      />
    )
  }

  const visible = groups.slice(0, MAX_DISCS)
  const overflow = groups.length - visible.length
  const frontTint = getNotificationKind(visible[0].type).tint
  const totalLabel = total > 99 ? "99+" : String(total)
  const typeLabels = groups.map((g) => getNotificationKind(g.type).label).join(", ")

  return (
    <div
      className={cn("inline-flex items-center", className)}
      role="status"
      aria-label={`${total} unread across ${groups.length} types: ${typeLabels}`}
    >
      {visible.map((g, i) => {
        const kind = getNotificationKind(g.type)
        const Icon = kind.icon
        const tint = kind.tint
        const iconSize = Math.round(DISC * 0.5)
        const scale = 1 - i * 0.07 // 1 → 0.93 → 0.86 → 0.79
        const opacity = 1 - i * 0.12 // depth fall-off

        return (
          <motion.span
            key={g.type}
            initial={reduce ? { opacity: 0 } : { scale: 0.4, opacity: 0, x: -4 }}
            animate={reduce ? { opacity } : { scale, opacity, x: 0 }}
            transition={{
              type: "spring",
              stiffness: 520,
              damping: 26,
              mass: 0.7,
              delay: reduce ? 0 : i * 0.05,
            }}
            className="relative inline-flex items-center justify-center rounded-full"
            style={{
              width: DISC,
              height: DISC,
              marginLeft: i === 0 ? 0 : -OVERLAP,
              // Newest (left-most) sits on top; later discs tuck under it.
              zIndex: visible.length - i,
              // The white ring separates overlapping discs (stacked-avatar effect).
              background: "#fff",
              boxShadow: `0 2px 8px -2px ${tint}66`,
            }}
            aria-hidden
          >
            {/* Front disc draws a soft recurring ping to pull the eye to the freshest event. */}
            {pulse && !reduce && i === 0 && (
              <motion.span
                aria-hidden
                className="absolute inset-0 rounded-full"
                style={{ border: `1.5px solid ${tint}` }}
                initial={{ scale: 1, opacity: 0.45 }}
                animate={{ scale: 1.9, opacity: 0 }}
                transition={{ duration: 1.9, repeat: Infinity, ease: "easeOut" }}
              />
            )}

            <span
              className="inline-flex items-center justify-center rounded-full"
              style={{
                width: DISC - 3,
                height: DISC - 3,
                background: `${tint}1f`,
                border: `1.5px solid ${tint}80`,
                color: tint,
              }}
            >
              <Icon style={{ width: iconSize, height: iconSize }} strokeWidth={2.4} />
            </span>

            {/* The total unread count rides the front disc. */}
            {i === 0 && total > 1 && (
              <motion.span
                key={total}
                initial={reduce ? false : { scale: 0.5, y: -2, opacity: 0 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                transition={{ type: "spring", stiffness: 620, damping: 24 }}
                className="absolute -top-1.5 -right-1.5 z-10 flex items-center justify-center rounded-full px-1 font-black tabular-nums text-white"
                style={{
                  minWidth: 15,
                  height: 15,
                  fontSize: 9.5,
                  background: frontTint,
                  boxShadow: `0 1px 4px -1px ${frontTint}aa`,
                  border: "1.5px solid white",
                }}
              >
                {totalLabel}
              </motion.span>
            )}
          </motion.span>
        )
      })}

      {overflow > 0 && (
        <motion.span
          initial={reduce ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 0.85 }}
          transition={{ type: "spring", stiffness: 520, damping: 26, delay: reduce ? 0 : visible.length * 0.05 }}
          className="ml-1 inline-flex items-center justify-center rounded-full bg-gray-100 px-1.5 font-bold tabular-nums text-gray-500"
          style={{ height: 16, fontSize: 9.5, border: "1px solid rgba(0,0,0,0.06)" }}
          aria-hidden
        >
          +{overflow}
        </motion.span>
      )}
    </div>
  )
})
