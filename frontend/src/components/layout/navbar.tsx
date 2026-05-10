"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import { motion, AnimatePresence, LayoutGroup } from "framer-motion"
import { Plus, X, Sparkles, LogOut, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"
import { api } from "@/lib/api"
import { clearCsrfToken } from "@/lib/csrf"
import { EASE_OUT_EXPO } from "@/lib/animations"
import { TASK_CREATED_EVENT } from "@/lib/events"

// ─── Navigation items ─────────────────────────────────────────────────────────

const NAV_TABS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Todos",     href: "/todos"     },
  { label: "Categories", href: "/categories" },
] as const

// ─── Spring configs ────────────────────────────────────────────────────────────

const PILL_SPRING    = { type: "spring" as const, stiffness: 550, damping: 42, mass: 0.55 }
const CONTENT_SPRING = { type: "spring" as const, stiffness: 550, damping: 42, mass: 0.55 }
const ICON_SPRING    = { type: "spring" as const, stiffness: 420, damping: 24 }

// ─── Component ────────────────────────────────────────────────────────────────

export function Navbar() {
  const router    = useRouter()
  const pathname  = usePathname()
  const user      = useAuthStore(s => s.user)
  const clearAuth = useAuthStore(s => s.clearAuth)
  const addToast  = useToastStore(s => s.addToast)

  const [expanded,   setExpanded]   = useState(false)
  const [createMode, setCreateMode] = useState(false)
  const [taskTitle,  setTaskTitle]  = useState("")
  const [creating,   setCreating]   = useState(false)
  const [dropOpen,   setDropOpen]   = useState(false)
  const [mounted,    setMounted]    = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const dropRef  = useRef<HTMLDivElement>(null)
  const pillRef  = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  // Focus task input when create mode opens
  useEffect(() => {
    if (createMode) {
      const t = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
  }, [createMode])

  // Close dropdown on outside click; also collapse pill when clicking outside
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setDropOpen(false)
        if (pillRef.current && !pillRef.current.contains(e.target as Node)) {
          setExpanded(false)
        }
      }
    }
    if (dropOpen) document.addEventListener("mousedown", handle)
    return () => document.removeEventListener("mousedown", handle)
  }, [dropOpen])

  // Keep pill expanded while create mode or dropdown is active
  const handleMouseLeave = useCallback(() => {
    if (!createMode && !dropOpen) setExpanded(false)
  }, [createMode, dropOpen])

  // Derived user info
  const initials = mounted && user?.firstName
    ? `${user.firstName[0]}${user.lastName?.[0] ?? ""}`.toUpperCase()
    : mounted && user?.email ? user.email.substring(0, 2).toUpperCase() : "U"

  const displayName = mounted && user?.firstName
    ? `${user.firstName}${user.lastName ? " " + user.lastName : ""}`
    : mounted && user?.email ? user.email.split("@")[0] : "User"

  const handleLogout = async () => {
    setDropOpen(false)
    try { await api.post("/auth/api/v1/auth/logout") } catch { /* ignore */ }
    finally {
      clearAuth()
      clearCsrfToken()
      addToast({ type: "success", title: "Logged out" })
      router.push("/auth/login")
    }
  }

  const handleCreate = async () => {
    const title = taskTitle.trim()
    if (!title || creating) return
    setCreating(true)
    try {
      await api.post("/todos/api/v1/todos", {
        title,
        isPublic:    false,
        description: null,
        categoryId:  null,
        dueDate:     null,
      })
      addToast({ type: "success", title: "Task created!" })
      setTaskTitle("")
      setCreateMode(false)
      // Signal dashboard (and any other page) to refresh the task list
      window.dispatchEvent(new CustomEvent(TASK_CREATED_EVENT))
    } catch {
      addToast({ type: "error", title: "Failed to create task" })
    } finally {
      setCreating(false)
    }
  }

  const exitCreate = useCallback(() => {
    setCreateMode(false)
    setTaskTitle("")
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter")  handleCreate()
    if (e.key === "Escape") exitCreate()
  }

  const isActive = (href: string) =>
    href === "/dashboard"
      ? pathname === "/dashboard" || pathname.startsWith("/dashboard/")
      : pathname.startsWith(href)

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed top-4 inset-x-0 z-[1000] flex justify-center pointer-events-none">
      {/* Mount animation */}
      <motion.div
        initial={{ opacity: 0, y: -14, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: EASE_OUT_EXPO }}
        className="pointer-events-none"
      >
        {/*
          Pill uses Framer Motion `layout` so it smoothly springs to fit
          whatever content is currently rendered inside.
          `style={{ borderRadius: 9999 }}` lets Framer Motion interpolate
          border-radius correctly during the FLIP animation.
        */}
        <LayoutGroup id="navbar-pill">
          <motion.div
            ref={pillRef}
            layout
            transition={PILL_SPRING}
            style={{ borderRadius: 9999 }}
            className={cn(
              "pointer-events-auto relative flex items-center h-12",
              "bg-white/96 backdrop-blur-xl",
              "border border-gray-200/90",
              "shadow-[0_4px_28px_rgba(0,0,0,0.07),0_1px_6px_rgba(0,0,0,0.04)]",
            )}
            onMouseEnter={() => setExpanded(true)}
            onMouseLeave={handleMouseLeave}
          >
            {/* ── Logo (always visible) ──────────────────────────────── */}
            <motion.div layout transition={CONTENT_SPRING}>
              <Link
                href="/dashboard"
                className="flex items-center gap-1.5 pl-4 pr-3 h-12 hover:bg-gray-50/70 transition-colors duration-150"
                style={{ borderRadius: "9999px 0 0 9999px" }}
              >
                <span className="h-[6px] w-[6px] rounded-full bg-gray-900 flex-shrink-0" />
                <span className="text-sm font-black tracking-tight text-gray-900 select-none whitespace-nowrap">
                  Planora
                </span>
              </Link>
            </motion.div>

            {/*
              Expanding section — mounted when expanded is true.
              Because the parent uses `layout`, adding/removing this element
              causes the pill to spring to its new size automatically.
              The content itself only animates opacity (not position) so the
              FLIP parent handles all the width animation.
            */}
            <AnimatePresence initial={false}>
              {expanded && (
                <motion.div
                  key="nav-expand"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { delay: 0.07, duration: 0.16 } }}
                  exit={{ opacity: 0, transition: { duration: 0.08 } }}
                  className="flex items-center pr-1 overflow-hidden"
                  style={{ minWidth: 0 }}
                >
                  {/* Divider */}
                  <div className="h-4 w-px bg-gray-200 mx-2 flex-shrink-0" />

                  {/* Tabs ↔ Create input */}
                  <AnimatePresence mode="wait" initial={false}>
                    {!createMode ? (
                      <motion.div
                        key="tabs"
                        initial={{ opacity: 0, x: -4 }}
                        animate={{ opacity: 1, x: 0, transition: { duration: 0.14, ease: EASE_OUT_EXPO } }}
                        exit={{ opacity: 0, x: -4, transition: { duration: 0.09 } }}
                        className="flex items-center gap-0.5"
                      >
                        {NAV_TABS.map(tab => (
                          <Link
                            key={tab.href}
                            href={tab.href}
                            className={cn(
                              "relative px-3.5 py-1.5 text-sm font-semibold rounded-full whitespace-nowrap transition-colors duration-150",
                              isActive(tab.href) ? "text-gray-900" : "text-gray-500 hover:text-gray-700",
                            )}
                          >
                            {isActive(tab.href) && (
                              <motion.span
                                layoutId="nav-active-bg"
                                className="absolute inset-0 rounded-full bg-gray-100"
                                transition={PILL_SPRING}
                              />
                            )}
                            <span className="relative z-10">{tab.label}</span>
                          </Link>
                        ))}

                        {/* + create button */}
                        <div className="ml-2 mr-0.5">
                          <motion.button
                            whileHover={{ scale: 1.08 }}
                            whileTap={{ scale: 0.90 }}
                            transition={ICON_SPRING}
                            type="button"
                            onClick={() => setCreateMode(true)}
                            aria-label="Create task"
                            className="h-8 w-8 rounded-full bg-gray-900 text-white flex items-center justify-center"
                          >
                            <motion.span
                              animate={{ rotate: 0 }}
                              transition={ICON_SPRING}
                              className="flex"
                            >
                              <Plus className="h-4 w-4" strokeWidth={2.5} />
                            </motion.span>
                          </motion.button>
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="create"
                        initial={{ opacity: 0, x: 6 }}
                        animate={{ opacity: 1, x: 0, transition: { duration: 0.16, ease: EASE_OUT_EXPO } }}
                        exit={{ opacity: 0, x: 6, transition: { duration: 0.09 } }}
                        className="flex items-center gap-2.5"
                      >
                        <Sparkles
                          className="h-3.5 w-3.5 flex-shrink-0"
                          style={{ color: "rgba(99,102,241,0.7)" }}
                        />
                        <input
                          ref={inputRef}
                          value={taskTitle}
                          onChange={e => setTaskTitle(e.target.value)}
                          onKeyDown={handleKeyDown}
                          placeholder="Add task…  try 'tomorrow at 5pm #work'"
                          disabled={creating}
                          className={cn(
                            "w-56 sm:w-80 text-sm text-gray-900 placeholder:text-gray-400",
                            "bg-transparent outline-none",
                            creating && "opacity-50",
                          )}
                        />
                        <button
                          type="button"
                          onClick={exitCreate}
                          aria-label="Cancel create task"
                          className="h-6 w-6 flex-shrink-0 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-150"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Avatar + dropdown (always visible) ────────────────── */}
            <motion.div layout transition={CONTENT_SPRING} className="relative flex-shrink-0 px-1.5" ref={dropRef}>
              <motion.button
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.94 }}
                transition={ICON_SPRING}
                type="button"
                onClick={() => setDropOpen(v => !v)}
                aria-label={`User menu for ${displayName}`}
                aria-haspopup="menu"
                aria-expanded={dropOpen}
                className="h-8 w-8 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center"
              >
                {initials}
              </motion.button>

              <AnimatePresence>
                {dropOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.96 }}
                    transition={{ duration: 0.16, ease: EASE_OUT_EXPO }}
                    className="absolute right-0 top-full mt-3 w-52 rounded-2xl border border-gray-100 bg-white/96 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.10)] overflow-hidden"
                    role="menu"
                  >
                    <div className="px-4 py-3 border-b border-gray-50">
                      <p className="text-sm font-semibold text-gray-900 truncate">{displayName}</p>
                      <p className="text-xs text-gray-400 truncate mt-0.5">{user?.email}</p>
                    </div>
                    <div className="p-1.5 space-y-0.5">
                      <button
                        type="button"
                        onClick={() => { setDropOpen(false); router.push("/profile") }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 rounded-xl hover:bg-gray-50 transition-colors duration-150"
                        role="menuitem"
                      >
                        <User className="h-4 w-4 text-gray-400" />
                        Profile
                      </button>
                      <div className="h-px bg-gray-100 mx-2" />
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-500 rounded-xl hover:bg-red-50 transition-colors duration-150"
                        role="menuitem"
                      >
                        <LogOut className="h-4 w-4" />
                        Sign out
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        </LayoutGroup>
      </motion.div>
    </div>
  )
}
