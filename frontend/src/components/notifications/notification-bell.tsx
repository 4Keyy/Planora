"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { Bell, CheckCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { EASE_OUT_EXPO } from "@/lib/animations"
import { getNotificationKind } from "@/lib/notifications/types"
import { ensurePermission } from "@/lib/notifications/web-notifications"
import { useNotificationStore, type AppNotification } from "@/store/notifications"

const EMPTY_GUID = "00000000-0000-0000-0000-000000000000"
const ICON_SPRING = { type: "spring" as const, stiffness: 420, damping: 24 }

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
  return new Date(iso).toLocaleDateString()
}

/**
 * The global notification center: a bell with the total-unread badge that opens a dropdown of the
 * user's recent notifications. Lazily loads the list on open, supports "mark all read", and routes
 * to a notification's branch (marking it read) on click. State is shared with the card dots and
 * branch badges, so everything reconciles together.
 */
export function NotificationBell({ className }: { className?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
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
    <div ref={ref} className={cn("relative", className)}>
      <motion.button
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.94 }}
        transition={ICON_SPRING}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={totalUnread > 0 ? `Notifications, ${totalUnread} unread` : "Notifications"}
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800"
      >
        <Bell className="h-[18px] w-[18px]" strokeWidth={2.1} />
        <AnimatePresence>
          {totalUnread > 0 && (
            <motion.span
              key="count"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 620, damping: 24 }}
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full border-[1.5px] border-white bg-indigo-500 px-1 text-[9px] font-black tabular-nums text-white shadow-sm"
            >
              {badge}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.16, ease: EASE_OUT_EXPO }}
            className="absolute right-0 top-full z-[1100] mt-3 w-[min(92vw,360px)] overflow-hidden rounded-2xl border border-gray-100 bg-white/97 shadow-[0_8px_32px_rgba(0,0,0,0.10)] backdrop-blur-xl"
            role="menu"
            aria-label="Notifications"
          >
            <div className="flex items-center justify-between border-b border-gray-50 px-4 py-3">
              <p className="text-sm font-bold text-gray-900">Notifications</p>
              {totalUnread > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="flex items-center gap-1 text-xs font-semibold text-indigo-500 transition-colors hover:text-indigo-600"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-[60vh] overflow-y-auto overscroll-contain">
              {items.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-gray-400">You&apos;re all caught up ✨</p>
              ) : (
                items.map((n) => {
                  const kind = getNotificationKind(n.type)
                  const Icon = kind.icon
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => openItem(n)}
                      role="menuitem"
                      className={cn(
                        "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50",
                        !n.isRead && "bg-indigo-50/40",
                      )}
                    >
                      <span
                        className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
                        style={{ background: `${kind.tint}1f`, color: kind.tint }}
                      >
                        <Icon className="h-[15px] w-[15px]" strokeWidth={2.3} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-semibold text-gray-900">{n.title}</span>
                          <span className="flex-shrink-0 text-[10px] text-gray-400">{formatRelative(n.occurredOn)}</span>
                        </span>
                        <span className="mt-0.5 block text-xs text-gray-500 line-clamp-2">{n.message}</span>
                      </span>
                      {!n.isRead && (
                        <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full" style={{ background: kind.tint }} />
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
