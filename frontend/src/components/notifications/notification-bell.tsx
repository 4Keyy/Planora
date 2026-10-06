"use client"

import { useEffect, useId, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { Bell, CheckCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { SPRING_RESPONSIVE } from "@/lib/animations"
import { ICON_BUTTON, POPOVER_SURFACE } from "@/components/ui/surfaces"
import { useExitPresence } from "@/hooks/use-exit-presence"
import { getNotificationKind } from "@/lib/notifications/types"
import { ensurePermission } from "@/lib/notifications/web-notifications"
import { useNotificationStore, type AppNotification } from "@/store/notifications"
import { formatDate } from "@/lib/datetime"

const EMPTY_GUID = "00000000-0000-0000-0000-000000000000"

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return ""
  const m = Math.floor(diff / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return formatDate(iso)
}

/**
 * The global notification center: a bell with the total-unread badge that opens a dropdown of the
 * user's recent notifications. Lazily loads the list on open, supports "mark all read", and routes
 * to a notification's branch (marking it read) on click. State is shared with the card dots and
 * branch badges, so everything reconciles together.
 */
export function NotificationBell({
  className,
  triggerClassName,
  open: openProp,
  onOpenChange,
}: {
  className?: string
  /** Extra classes for the bell button itself — the app's droplet bar rounds it fully. */
  triggerClassName?: string
  /**
   * Controlled by the app bar, which keeps one popover open at a time. Without these the
   * bell owns its own state, as it does in isolation (tests, any other host).
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const router = useRouter()
  const [ownOpen, setOwnOpen] = useState(false)
  const open = openProp ?? ownOpen
  const panel = useExitPresence(open)
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next)
    else setOwnOpen(next)
  }
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const headingId = useId()
  // The listeners below are attached once per opening; they read the latest setter
  // through this ref instead of re-subscribing on every render.
  const setOpenRef = useRef(setOpen)
  useEffect(() => {
    setOpenRef.current = setOpen
  })

  const totalUnread = useNotificationStore((s) => s.totalUnread)
  const items = useNotificationStore((s) => s.items)
  const loadList = useNotificationStore((s) => s.loadList)
  const markAllRead = useNotificationStore((s) => s.markAllRead)
  const markRead = useNotificationStore((s) => s.markRead)

  useEffect(() => {
    if (!open) return
    void loadList()
    // Opening the bell is a user gesture — the moment to (politely) ask for OS-notification
    // permission so future high-signal events can surface natively while the tab is backgrounded.
    void ensurePermission()
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenRef.current(false)
    }
    // Escape puts focus back on the bell: the focused row unmounts with the panel, and
    // focus would otherwise fall to <body>.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      setOpenRef.current(false)
      triggerRef.current?.focus()
    }
    document.addEventListener("mousedown", handle)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", handle)
      document.removeEventListener("keydown", onKey)
    }
  }, [open, loadList])

  const openItem = (n: AppNotification) => {
    setOpen(false)
    if (!n.isRead) void markRead([n.id])
    if (n.taskId && n.taskId !== EMPTY_GUID) router.push(`/branch/${n.taskId}`)
  }

  const badge = totalUnread > 99 ? "99+" : String(totalUnread)

  return (
    // Positioned only from `sm` up. On a phone the panel resolves against the app bar
    // instead, so it spans the bar's width rather than hanging off the bell.
    <div ref={ref} className={cn("sm:relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={totalUnread > 0 ? `Notifications, ${totalUnread} unread` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(ICON_BUTTON, triggerClassName)}
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        <AnimatePresence>
          {totalUnread > 0 && (
            <motion.span
              key="count"
              aria-hidden="true"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={SPRING_RESPONSIVE}
              className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-caption font-bold leading-none tabular-nums text-paper ring-2 ring-paper"
            >
              {badge}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      {panel.mounted && (
        <div
          {...panel.presenceProps}
          className={cn(
            POPOVER_SURFACE,
            // 8px under the droplet's edge at every width: the phone panel hangs from the droplet
            // itself, the desktop one from this 44px button, 6px inside the 56px capsule.
            "dropdown-surface absolute inset-x-0 top-full z-dropdown mt-2 origin-top overflow-hidden sm:inset-x-auto sm:right-0 sm:mt-3.5 sm:w-96 sm:origin-top-right",
          )}
          // A dialog, not an ARIA menu: it holds a heading, an action and a list of rows —
          // a menu may contain only menu items, and an empty one is an empty menu.
          role="dialog"
          aria-labelledby={headingId}
        >
          <div className="flex h-12 items-center justify-between border-b border-line pl-4 pr-2">
            <h2 id={headingId} className="text-body-sm font-bold text-ink">Notifications</h2>
            {totalUnread > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="touch-target inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-caption font-semibold text-ink-muted transition-colors duration-fast hover:bg-paper-sunken hover:text-ink"
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Mark all read
              </button>
            )}
          </div>

          <div data-cascade className="max-h-96 overflow-y-auto overscroll-contain">
            {items.length === 0 ? (
              <p className="px-4 py-12 text-center text-body-sm text-ink-muted">You&apos;re all caught up</p>
            ) : (
              items.map((n) => {
                const kind = getNotificationKind(n.type)
                const Icon = kind.icon
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => openItem(n)}
                    className={cn(
                      "flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left transition-colors duration-fast last:border-b-0 hover:bg-paper-sunken",
                      !n.isRead && "bg-paper-sunken",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
                      style={{ background: `${kind.tint}1f`, color: kind.tint }}
                    >
                      <Icon className="h-4 w-4" strokeWidth={2.25} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-caption font-semibold text-ink">{n.title}</span>
                        <span className="flex-shrink-0 text-caption tabular-nums text-ink-muted">{formatRelative(n.occurredOn)}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-caption text-ink-muted">{n.message}</span>
                    </span>
                    {!n.isRead && (
                      <span aria-hidden="true" className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full" style={{ background: kind.tint }} />
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
