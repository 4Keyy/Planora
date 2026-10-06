"use client"

import { memo } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { getNotificationKind } from "@/lib/notifications/types"
import { NotificationBadge, PING_TRANSITION } from "./notification-badge"
import { SPRING_RESPONSIVE } from "@/lib/animations"
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
  /** Ping the front disc once on arrival (suppressed on completed cards). */
  pulse?: boolean
  className?: string
}

// Visual constants tuned so discs overlap like stacked rings without ever clipping the card or
// growing past the badge slot. Capped at four visible discs + a "+N" pip so a noisy task stays tidy.
const DISC = 22
const OVERLAP = 9
const MAX_DISCS = 4
/** The discs fan out 50ms apart — inside the system's 40–50ms list rhythm, four steps at most. */
const DISC_STAGGER_S = 0.05

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
            transition={{ ...SPRING_RESPONSIVE, delay: reduce ? 0 : i * DISC_STAGGER_S }}
            className="relative inline-flex items-center justify-center rounded-full shadow-sm"
            style={{
              width: DISC,
              height: DISC,
              marginLeft: i === 0 ? 0 : -OVERLAP,
              // Newest (left-most) sits on top; later discs tuck under it.
              zIndex: visible.length - i,
              // The white ring separates overlapping discs (stacked-avatar effect).
              background: "var(--pl-paper)",
            }}
            aria-hidden
          >
            {/* Front disc pings once to pull the eye to the freshest event, then rests. It used
                to repeat forever, then three times over six seconds, on every card with unread
                activity; a list at rest does not move (see PING_TRANSITION). */}
            {pulse && !reduce && i === 0 && (
              <motion.span
                aria-hidden
                className="absolute inset-0 rounded-full"
                style={{ border: `1.5px solid ${tint}` }}
                initial={{ scale: 1, opacity: 0.45 }}
                animate={{ scale: 1.9, opacity: 0 }}
                transition={PING_TRANSITION}
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
                transition={SPRING_RESPONSIVE}
                className="absolute -top-1.5 -right-1.5 z-10 flex items-center justify-center rounded-full px-1 font-bold tabular-nums text-paper shadow-sm"
                style={{
                  minWidth: 15,
                  height: 15,
                  fontSize: 12,
                  background: frontTint,
                  border: "1.5px solid var(--pl-paper)",
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
          transition={{ ...SPRING_RESPONSIVE, delay: reduce ? 0 : visible.length * DISC_STAGGER_S }}
          className="ml-1 inline-flex h-4 items-center justify-center rounded-full border border-line bg-gray-100 px-1.5 text-caption font-bold leading-none tabular-nums text-ink-muted"
          aria-hidden
        >
          +{overflow}
        </motion.span>
      )}
    </div>
  )
})
