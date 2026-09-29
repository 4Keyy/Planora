"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { LogOut, Menu, Search, User, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Avatar } from "@/components/ui/avatar"
import { Wordmark } from "@/components/ui/wordmark"
import { ICON_BUTTON, MENU_ITEM, POPOVER_SURFACE } from "@/components/ui/surfaces"
import { useIsApplePlatform } from "@/components/ui/shortcuts-overlay"
import { NotificationBell } from "@/components/notifications/notification-bell"
import { OPEN_PALETTE_EVENT } from "@/components/command-palette"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"
import { api } from "@/lib/api"
import { clearCsrfToken } from "@/lib/csrf"
import { DURATION_FAST, EASE_EXIT, EASE_OUT_EXPO, SPRING_STANDARD, TWEEN_FAST } from "@/lib/animations"

/**
 * The app's one bar.
 *
 * It used to be a floating pill that showed the wordmark, the bell and the avatar, and
 * revealed the navigation only while the pointer hovered over it — so on a desktop the
 * three places you can go were invisible until you went looking, a keyboard user who
 * tabbed onto the wordmark never saw them at all, and every hover re-laid-out the pill
 * with a spring. It also carried a second task-creation field whose placeholder
 * promised "try 'tomorrow at 5pm #work'", which it never parsed.
 *
 * Now it is a plain sticky bar, the same one the landing page and the auth screens
 * use: the `Wordmark` on the left, the three destinations always visible with an
 * underline that slides between them, and on the right search (the ⌘K palette, which
 * also creates tasks), notifications and the account menu. Creating a task lives where
 * the tasks are — the capture control and the "New task" panel.
 *
 * On phones the destinations move into a sheet under the bar. The sheet and its
 * backdrop are siblings of the `<header>`, not children: the header blurs what is
 * behind it, and `backdrop-filter` makes an element the containing block of its
 * `position: fixed` descendants — a backdrop inside it would cover the bar and nothing
 * else.
 */

const NAV_TABS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Tasks", href: "/tasks" },
  { label: "Categories", href: "/categories" },
] as const

export function Navbar() {
  const router = useRouter()
  const pathname = usePathname() ?? ""
  const user = useAuthStore((s) => s.user)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const addToast = useToastStore((s) => s.addToast)
  const isApple = useIsApplePlatform()
  const reduce = useReducedMotion() ?? false

  /*
   * One popover at a time. The account menu, the notifications and the phone sheet each
   * used to own their state, so on a phone the bell could open under a sheet that was
   * already covering the same strip of screen — the panel reported itself open while the
   * sheet hid its first three rows. Opening any of them now closes the others.
   */
  const [open, setOpen] = useState<"menu" | "sheet" | "bell" | null>(null)
  const menuOpen = open === "menu"
  const sheetOpen = open === "sheet"
  const [mounted, setMounted] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const sheetToggleRef = useRef<HTMLButtonElement>(null)

  useEffect(() => setMounted(true), [])

  // A route change closes whatever was open: the sheet's links navigate, and the
  // sheet must not still be covering the page they lead to.
  useEffect(() => {
    setOpen(null)
  }, [pathname])

  // Outside click and Escape close the account menu; Escape returns focus to its
  // trigger, or the next Tab would restart from the top of the document.
  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      setOpen(null)
      menuTriggerRef.current?.focus()
    }
    document.addEventListener("mousedown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [menuOpen])

  // Escape closes the phone sheet and puts focus back on its toggle — the focused link
  // inside the sheet unmounts with it, and focus would otherwise fall to <body>.
  useEffect(() => {
    if (!sheetOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      setOpen(null)
      sheetToggleRef.current?.focus()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [sheetOpen])

  const displayName =
    mounted && user?.firstName
      ? `${user.firstName}${user.lastName ? " " + user.lastName : ""}`
      : mounted && user?.email
        ? user.email.split("@")[0]
        : "User"

  const isActive = useCallback(
    (href: string) => pathname === href || pathname.startsWith(`${href}/`),
    [pathname],
  )

  const goToProfile = () => {
    setOpen(null)
    router.push("/profile")
  }

  const handleLogout = async () => {
    setOpen(null)
    try {
      await api.post("/auth/api/v1/auth/logout")
    } catch {
      // The local session ends either way.
    } finally {
      clearAuth()
      clearCsrfToken()
      addToast({ type: "success", title: "Signed out" })
      router.push("/auth/login")
    }
  }

  const openPalette = () => window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT))

  const popIn = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, y: -4, scale: 0.98 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: -4, scale: 0.98, transition: { duration: DURATION_FAST, ease: EASE_EXIT } },
      }

  return (
    <div className="sticky top-0 z-sticky">
      <AnimatePresence>
        {sheetOpen ? (
          <motion.div
            key="backdrop"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={TWEEN_FAST}
            onClick={() => setOpen(null)}
            className="fixed inset-0 bg-ink/20 sm:hidden"
          />
        ) : null}
      </AnimatePresence>

      <header className="relative border-b border-line bg-paper/85 pt-safe backdrop-blur-md">
        <div className="container-app flex h-14 items-center gap-2 sm:h-16 sm:gap-6">
          <Link
            href="/dashboard"
            aria-label="Planora, go to dashboard"
            className="-ml-2 inline-flex min-h-control flex-shrink-0 items-center rounded-md px-2"
          >
            <Wordmark />
          </Link>

          <nav aria-label="Main" data-testid="navbar-desktop" className="hidden h-full items-stretch sm:flex">
            {NAV_TABS.map((tab) => {
              const active = isActive(tab.href)
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex items-center px-3 text-body-sm font-semibold transition-colors duration-fast",
                    active ? "text-ink" : "text-ink-muted hover:text-ink",
                  )}
                >
                  {tab.label}
                  {active ? (
                    <motion.span
                      layoutId="nav-underline"
                      aria-hidden="true"
                      className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-ink"
                      transition={reduce ? { duration: 0 } : SPRING_STANDARD}
                    />
                  ) : null}
                </Link>
              )
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={openPalette}
              className={cn(
                "touch-target hidden h-10 items-center gap-2 rounded-md border border-line bg-paper pl-3 pr-2 text-body-sm font-medium text-ink-muted md:inline-flex",
                "transition-colors duration-fast hover:border-line-strong hover:text-ink",
              )}
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              <span className="pr-6">Search</span>
              <kbd
                suppressHydrationWarning
                className="rounded-sm border border-line bg-paper-sunken px-1.5 font-sans text-caption font-semibold text-ink-muted"
              >
                {isApple ? "⌘K" : "Ctrl K"}
              </kbd>
            </button>
            <button type="button" onClick={openPalette} aria-label="Search" className={cn(ICON_BUTTON, "md:hidden")}>
              <Search className="h-5 w-5" aria-hidden="true" />
            </button>

            <NotificationBell open={open === "bell"} onOpenChange={(next) => setOpen(next ? "bell" : null)} />

            {/* Account menu — sm and up. On phones the sheet carries the same actions.
                A disclosure, not an ARIA `menu`: two plain buttons behind a toggle. `menu`
                promises arrow-key navigation and focus moving into the list, which screen
                readers switch modes to expect, and which a two-item popover does not need. */}
            <div ref={menuRef} className="relative hidden sm:block">
              <button
                ref={menuTriggerRef}
                type="button"
                onClick={() => setOpen(menuOpen ? null : "menu")}
                aria-label={`User menu for ${displayName}`}
                aria-expanded={menuOpen}
                aria-controls="navbar-account"
                className="touch-target flex h-10 w-10 items-center justify-center rounded-full transition-opacity duration-fast hover:opacity-80"
              >
                <Avatar
                  src={user?.profilePictureUrl}
                  firstName={user?.firstName}
                  lastName={user?.lastName}
                  email={user?.email}
                  size={32}
                  priority
                />
              </button>

              <AnimatePresence>
                {menuOpen ? (
                  <motion.div
                    {...popIn}
                    transition={{ duration: DURATION_FAST, ease: EASE_OUT_EXPO }}
                    id="navbar-account"
                    aria-label="Account"
                    className={cn(POPOVER_SURFACE, "absolute right-0 top-full z-dropdown mt-2 w-60 origin-top-right p-1.5")}
                  >
                    <div className="px-3 pb-2 pt-1.5">
                      <p className="truncate text-body-sm font-semibold text-ink">{displayName}</p>
                      <p className="mt-0.5 truncate text-caption text-ink-muted">{user?.email}</p>
                    </div>
                    <div className="my-1 h-px bg-line" aria-hidden="true" />
                    <button type="button" onClick={goToProfile} className={MENU_ITEM}>
                      <User className="h-4 w-4" aria-hidden="true" />
                      Profile
                    </button>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className={MENU_ITEM}
                    >
                      <LogOut className="h-4 w-4" aria-hidden="true" />
                      Sign out
                    </button>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            <button
              ref={sheetToggleRef}
              type="button"
              onClick={() => setOpen(sheetOpen ? null : "sheet")}
              aria-label={sheetOpen ? "Close menu" : "Open menu"}
              aria-expanded={sheetOpen}
              aria-controls="navbar-sheet"
              className={cn(ICON_BUTTON, "-mr-2 sm:hidden")}
            >
              {sheetOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {sheetOpen ? (
          <motion.div
            key="sheet"
            id="navbar-sheet"
            data-testid="navbar-mobile"
            {...popIn}
            transition={{ duration: DURATION_FAST, ease: EASE_OUT_EXPO }}
            className={cn(POPOVER_SURFACE, "absolute inset-x-3 top-full mt-2 origin-top p-2 sm:hidden")}
          >
            <nav aria-label="Main" className="space-y-1">
              {NAV_TABS.map((tab) => {
                const active = isActive(tab.href)
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    onClick={() => setOpen(null)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-12 items-center justify-between rounded-md px-4 text-body font-semibold transition-colors duration-fast",
                      active ? "bg-ink text-paper" : "text-ink-muted hover:bg-paper-sunken hover:text-ink",
                    )}
                  >
                    {tab.label}
                    {active ? <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-paper" /> : null}
                  </Link>
                )
              })}
            </nav>

            <div className="mt-2 border-t border-line pt-2">
              <div className="flex items-center gap-3 px-4 py-2">
                <Avatar
                  src={user?.profilePictureUrl}
                  firstName={user?.firstName}
                  lastName={user?.lastName}
                  email={user?.email}
                  size={32}
                />
                <div className="min-w-0">
                  <p className="truncate text-body-sm font-semibold text-ink">{displayName}</p>
                  {user?.email ? <p className="truncate text-caption text-ink-muted">{user.email}</p> : null}
                </div>
              </div>
              <button type="button" onClick={goToProfile} className={cn(MENU_ITEM, "h-12 px-4")}>
                <User className="h-4 w-4" aria-hidden="true" />
                Profile
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className={cn(MENU_ITEM, "h-12 px-4")}
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Sign out
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
