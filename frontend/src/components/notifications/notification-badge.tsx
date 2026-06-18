"use client"

import { memo } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { Check, GitBranch, MessageCircle, Users, type LucideIcon } from "lucide-react"
import { getNotificationKind, type NotificationMotif } from "@/lib/notifications/types"
import { cn } from "@/lib/utils"

interface NotificationBadgeProps {
  /** The notification type (latest for a task) — drives the glyph, tint, label and motif. */
  type: string
  /** Unread count for the count bubble / pill counter. */
  count?: number
  /** Render the numeric counter (branch badge / pill) vs. icon-only (compact mark). */
  showCount?: boolean
  /**
   * "mark" — the compact tinted disc (branch composer, dense spots).
   * "pill" — a larger, self-explaining plate: icon + people/branch motif + human label + count.
   *          This is what a task card shows so a glance reads *what happened and who/where*,
   *          not just a colored dot.
   */
  variant?: "mark" | "pill"
  /** Diameter in px for the icon disc (mark) / icon chip (pill). */
  size?: number
  /** Animate a soft recurring ping ring (draws the eye to a fresh unread). */
  pulse?: boolean
  className?: string
}

/** Secondary "what is this about" glyph. Reinforces the people/branch analogy at a glance. */
const MOTIF_ICON: Record<NotificationMotif, LucideIcon> = {
  people: Users,
  branch: GitBranch,
  chat: MessageCircle,
}

/**
 * A notification cue rendered in one of two shapes:
 *
 *  - **mark** — the small circular glyph (unread disc on a dense surface / the branch composer).
 *    Picks icon + accent from the type, springs in, optionally pings.
 *  - **pill** — a larger, legible plate used on task cards: a tinted icon chip carrying a tiny
 *    people/branch motif disc, the human label ("Ready for review", "New message"), and the unread
 *    count. It answers *what happened* and *who/where* without opening the card.
 *
 * The "all collaborators done" kind renders the dedicated people-and-check composite. Fully
 * reduced-motion aware; color is never the only signal (icon + motif + label always accompany it).
 */
export const NotificationBadge = memo(function NotificationBadge({
  type,
  count = 0,
  showCount = false,
  variant = "mark",
  size = 20,
  pulse = true,
  className,
}: NotificationBadgeProps) {
  const reduce = useReducedMotion()
  const kind = getNotificationKind(type)
  const Icon = kind.icon
  const tint = kind.tint

  if (variant === "pill") {
    return (
      <PillBadge
        kindIcon={Icon}
        composite={kind.composite}
        motif={kind.motif}
        tint={tint}
        label={kind.label}
        count={count}
        pulse={pulse}
        reduce={!!reduce}
        chip={size}
        className={className}
      />
    )
  }

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

/** The labeled plate: tinted icon chip (+ motif disc) · human label · unread count. */
function PillBadge({
  kindIcon: Icon,
  composite,
  motif,
  tint,
  label,
  count,
  pulse,
  reduce,
  chip,
  className,
}: {
  kindIcon: LucideIcon
  composite?: "people-check"
  motif: NotificationMotif
  tint: string
  label: string
  count: number
  pulse: boolean
  reduce: boolean
  chip: number
  className?: string
}) {
  const iconSize = Math.round(chip * 0.56)
  const hasCount = count > 1
  const countLabel = count > 99 ? "99+" : String(count)

  return (
    <motion.span
      initial={reduce ? { opacity: 0 } : { scale: 0.8, opacity: 0, y: -2 }}
      animate={reduce ? { opacity: 1 } : { scale: 1, opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { scale: 0.8, opacity: 0, y: -2 }}
      transition={{ type: "spring", stiffness: 480, damping: 26, mass: 0.7 }}
      className={cn(
        "relative inline-flex max-w-[176px] items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5",
        "border backdrop-blur-sm",
        className,
      )}
      style={{
        background: `${tint}1a`,
        borderColor: `${tint}59`,
        boxShadow: `0 2px 10px -3px ${tint}80`,
      }}
      role="status"
      aria-label={hasCount ? `${count} unread · ${label}` : label}
    >
      {/* Tinted icon chip with the people/branch motif disc — the "analogy" at a glance. */}
      <span
        className="relative inline-flex flex-shrink-0 items-center justify-center rounded-full"
        style={{ width: chip, height: chip, background: tint, color: "#fff" }}
      >
        {pulse && !reduce && (
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full"
            style={{ border: `1.5px solid ${tint}` }}
            initial={{ scale: 1, opacity: 0.5 }}
            animate={{ scale: 1.85, opacity: 0 }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
          />
        )}
        {composite === "people-check" ? (
          <PeopleCheck size={iconSize} tint="#fff" onTint />
        ) : (
          <Icon style={{ width: iconSize, height: iconSize }} strokeWidth={2.5} />
        )}
        {/* Motif disc — only when it adds meaning (chat kinds already show a chat glyph). */}
        {composite !== "people-check" && motif !== "chat" && (
          <MotifDisc motif={motif} chip={chip} tint={tint} />
        )}
      </span>

      <span
        className="min-w-0 truncate text-[11.5px] font-extrabold leading-none tracking-tight"
        style={{ color: "#1f2937" }}
      >
        {label}
      </span>

      {hasCount && (
        <motion.span
          key={count}
          initial={reduce ? false : { scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 620, damping: 24 }}
          className="flex flex-shrink-0 items-center justify-center rounded-full px-1.5 font-black tabular-nums text-white"
          style={{ minWidth: 17, height: 16, fontSize: 10, background: tint }}
          aria-hidden
        >
          {countLabel}
        </motion.span>
      )}
    </motion.span>
  )
}

/** A small disc pinned to the icon chip's corner carrying the people/branch motif glyph. */
function MotifDisc({ motif, chip, tint }: { motif: NotificationMotif; chip: number; tint: string }) {
  const MotifIcon = MOTIF_ICON[motif]
  const disc = Math.round(chip * 0.58)
  return (
    <span
      className="absolute flex items-center justify-center rounded-full text-white"
      style={{
        width: disc,
        height: disc,
        right: -disc * 0.3,
        bottom: -disc * 0.28,
        background: tint,
        border: "1.5px solid #fff",
        boxShadow: `0 1px 3px -1px ${tint}aa`,
      }}
    >
      <MotifIcon style={{ width: disc * 0.58, height: disc * 0.58 }} strokeWidth={2.6} />
    </span>
  )
}

/** "Little people + checkmark" — Users with a small tinted check disc at the lower-right. */
function PeopleCheck({ size, tint, onTint = false }: { size: number; tint: string; onTint?: boolean }) {
  const Users = getNotificationKind("task.participants_done").icon
  const disc = Math.round(size * 0.62)
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <Users style={{ width: size, height: size }} strokeWidth={2.2} />
      <span
        className="absolute flex items-center justify-center rounded-full"
        style={{
          width: disc,
          height: disc,
          right: -disc * 0.35,
          bottom: -disc * 0.3,
          background: onTint ? "#fff" : tint,
          color: onTint ? tint : "#fff",
          border: onTint ? "1.5px solid currentColor" : "1.5px solid white",
        }}
      >
        <Check style={{ width: disc * 0.6, height: disc * 0.6 }} strokeWidth={4} />
      </span>
    </span>
  )
}
