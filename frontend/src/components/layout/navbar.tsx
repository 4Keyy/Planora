"use client"

import { useCallback, useEffect, useRef, useState, type FocusEvent } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion"
import { ChevronDown, LogOut, Search, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { Avatar } from "@/components/ui/avatar"
import { Wordmark } from "@/components/ui/wordmark"
import { MENU_ITEM, POPOVER_SURFACE } from "@/components/ui/surfaces"
import { useIsApplePlatform } from "@/components/ui/shortcuts-overlay"
import { NotificationBell } from "@/components/notifications/notification-bell"
import { OPEN_PALETTE_EVENT } from "@/components/command-palette"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"
import { api } from "@/lib/api"
import { clearCsrfToken } from "@/lib/csrf"
import { DropletFrame, isKeyboardFocus, useDropletScroll, useIsPhone } from "@/components/layout/droplet"
import {
  DURATION_FAST,
  EASE_EXIT,
  EASE_OUT_EXPO,
  SPRING_GENTLE,
  SPRING_LAYOUT,
  SPRING_STANDARD,
  TAP_PRESS,
  TWEEN_FAST,
} from "@/lib/animations"

/**
 * The app's bar: a droplet.
 *
 * A capsule that floats over the top of the page instead of a strip nailed across it. It
 * carries the mark, the three places you can go, search, notifications and your account,
 * and it behaves like something liquid:
 *
 * - **The current page is an ink drop** that flows from tab to tab when you navigate
 *   (`layoutId`), and a lighter drop follows the pointer across the tabs before you press.
 * - **It breathes with the scroll.** Scrolling down into a list, it condenses on a desktop to
 *   the mark, the page you are on and the buttons — the capsule's own width springs — and on
 *   a phone it slides up out of the way. Scrolling up, returning to the top, pointing at it
 *   or moving focus into it makes it whole again at once (`lib/droplet.ts`).
 * - **The phone menu drips out of it**: a panel that grows down from the droplet, the page
 *   dimmed and blurred behind it.
 *
 * The droplet this replaced (and the one before the plain bar) showed its tabs only while
 * the pointer hovered over it — invisible on a desktop until you went looking, never shown
 * to a keyboard user, useless on touch. Here the tabs are always there when it is whole,
 * whole is the resting state at the top of every page, and focus inside it always expands
 * it, so nothing is ever reachable only by hover.
 *
 * Structure that is load-bearing:
 *
 * - The glass (fill, border, shadow, blur) is its own layer inside the capsule, not the
 *   capsule itself. `backdrop-filter` makes an element the containing block of its
 *   `position: fixed` descendants, and the menus must not be trapped in a blurred box.
 * - The dimmed backdrop behind the phone menu is a sibling of the droplet, outside every
 *   transformed ancestor, so it covers the page and not just the capsule.
 * - The droplet is `fixed`, so it takes no space; `AppShell` holds the room it floats in,
 *   and `--bar-clearance` (globals.css) is what sticky things below it offset by.
 * - Everything moves by transform and opacity: the capsule's width change is framer-motion's
 *   `layout` (a scale, corrected for the radius and the children), the drops are shared
 *   layouts, the phone slide is a CSS translate of the droplet's frame (`droplet.tsx`). The
 *   capsule's content changes in one commit — tabs go `sr-only`, the name pops out of the
 *   flow — so the width morphs once. Under reduced motion it never condenses or hides, and
 *   every change is instant.
 */

/** How long the pointer rests on the mark or the tabs before a condensed droplet opens. */
const HOVER_DWELL_MS = 160

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
  const phone = useIsPhone()

  /*
   * One popover at a time. The account menu, the notifications and the phone menu each
   * used to own their state, so on a phone the bell could open under a menu that was
   * already covering the same strip of screen. Opening any of them closes the others.
   */
  const [open, setOpen] = useState<"menu" | "sheet" | "bell" | null>(null)
  const menuOpen = open === "menu"
  const sheetOpen = open === "sheet"
  const [mounted, setMounted] = useState(false)
  const scroll = useDropletScroll()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [hoverTab, setHoverTab] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const sheetToggleRef = useRef<HTMLButtonElement>(null)
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Hover expands only after a short dwell, so a pointer crossing the bar on its way to the
  // page does not set it springing.
  const clearDwell = useCallback(() => {
    if (dwell.current) clearTimeout(dwell.current)
    dwell.current = null
  }, [])
  const startDwell = useCallback(() => {
    clearDwell()
    dwell.current = setTimeout(() => setHovered(true), HOVER_DWELL_MS)
  }, [clearDwell])
  useEffect(() => clearDwell, [clearDwell])

  useEffect(() => setMounted(true), [])

  // A route change closes whatever was open — the menu's links navigate, and the menu must
  // not still be covering the page they lead to — and forgets any focus a click left behind.
  useEffect(() => {
    setOpen(null)
    setFocused(false)
  }, [pathname])

  // Outside click and Escape close the account menu; Escape returns focus to its trigger,
  // or the next Tab would restart from the top of the document.
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

  // Escape closes the phone menu and puts focus back on its toggle — the focused link inside
  // the menu unmounts with it, and focus would otherwise fall to <body>.
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

  // Whole unless the reader is scrolling down into the page and not reaching for the bar.
  const condensed = !reduce && !phone && scroll.condensed && !hovered && !focused && open === null
  const hidden = !reduce && phone && scroll.hidden && open === null && !focused
  const morph = reduce ? { duration: 0 } : SPRING_STANDARD

  const onBlur = (e: FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
  }

  const onTab = NAV_TABS.some((tab) => isActive(tab.href))

  const popIn = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, y: -6, scale: 0.97 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: -6, scale: 0.97, transition: { duration: DURATION_FAST, ease: EASE_EXIT } },
      }

  // The phone menu drips: it grows down out of the droplet, narrow and short first.
  const drip = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, y: -12, scaleX: 0.86, scaleY: 0.6 },
        animate: { opacity: 1, y: 0, scaleX: 1, scaleY: 1 },
        exit: { opacity: 0, y: -8, scaleX: 0.92, scaleY: 0.8, transition: { duration: DURATION_FAST, ease: EASE_EXIT } },
      }

  return (
    <>
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
            className="fixed inset-0 z-sticky bg-ink/20 backdrop-blur-sm sm:hidden"
          />
        ) : null}
      </AnimatePresence>

      <DropletFrame
        hidden={hidden}
        onPointerLeave={() => {
          clearDwell()
          setHovered(false)
          setHoverTab(null)
        }}
        // Keyboard focus only. A click focuses the link or button in most desktop browsers,
        // and the bar outlives the navigation it starts, so pointer focus used to pin the
        // droplet whole on every page after the first click.
        onFocus={(e) => {
          if (isKeyboardFocus(e.target)) setFocused(true)
        }}
        onBlur={onBlur}
      >
        {/* The part that grows. Pointing at it for a moment makes a condensed droplet whole;
            the buttons on the right never do, so the thing the pointer is aiming at is never
            the thing that moves away. */}
        <motion.div
          layout="position"
          transition={{ layout: morph }}
          // `relative` is load-bearing: it is the offset parent the leaving name is pinned to.
          className="relative flex items-center gap-1"
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse") startDwell()
          }}
          onPointerLeave={clearDwell}
        >
          <Link
            href="/dashboard"
            aria-label="Planora, go to dashboard"
            className="flex h-11 items-center gap-2 rounded-full px-3 transition-colors duration-fast hover:bg-ink/5"
          >
            <Wordmark showName={false} />
            {/* The name leaves in the same commit the tabs tuck away: `popLayout` pins the
                leaving word `position: absolute` where it stood (the `relative` group above is
                its offset parent), so the capsule changes width once and framer measures it.
                Without it the word held its room for the whole exit and AnimatePresence then
                removed it alone — no `layout` component re-rendered, nothing was measured, and
                the capsule snapped ~70px narrower at the end of its spring. Opacity only, on
                the front-loaded curve, so the word is gone before the current tab's ink slides
                over the place it held. */}
            <AnimatePresence initial={false} mode="popLayout">
              {!condensed && (
                <motion.span
                  key="name"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: TWEEN_FAST }}
                  transition={TWEEN_FAST}
                  className="text-body font-bold tracking-tight text-ink"
                >
                  Planora
                </motion.span>
              )}
            </AnimatePresence>
          </Link>

          <span aria-hidden="true" className="mx-1 hidden h-5 w-px bg-line sm:block" />

          {/* The tabs. All three are always mounted — in the tab order and in the
              accessibility tree — and a condensed droplet only tucks the ones you are not on
              out of sight (`sr-only`). They used to be unmounted, which emptied the "Main"
              landmark for a screen reader browsing the page; focusing a tucked one expands
              the droplet. */}
          <LayoutGroup id="droplet-tabs">
            <nav
              aria-label="Main"
              data-testid="navbar-desktop"
              className="relative hidden items-center gap-0.5 sm:flex"
              onPointerLeave={() => setHoverTab(null)}
            >
              {NAV_TABS.map((tab) => {
                const active = isActive(tab.href)
                const tucked = condensed && !active
                return (
                  <motion.div
                    key={tab.href}
                    layout="position"
                    animate={{ opacity: tucked ? 0 : 1 }}
                    transition={{ layout: morph, default: TWEEN_FAST }}
                    className={tucked ? "sr-only" : undefined}
                  >
                    <Link
                      href={tab.href}
                      aria-current={active ? "page" : undefined}
                      onPointerEnter={() => setHoverTab(tab.href)}
                      className={cn(
                        "relative flex h-11 items-center rounded-full px-4 text-body-sm font-semibold transition-colors duration-fast",
                        active ? "text-paper" : "text-ink-muted hover:text-ink",
                      )}
                    >
                      {hoverTab === tab.href && !active ? (
                        <motion.span
                          layoutId="droplet-hover"
                          aria-hidden="true"
                          className="absolute inset-0 rounded-full bg-ink/5"
                          transition={morph}
                        />
                      ) : null}
                      {active ? (
                        <motion.span
                          layoutId="droplet-active"
                          aria-hidden="true"
                          className="absolute inset-0 rounded-full bg-ink shadow-sm"
                          transition={morph}
                        />
                      ) : null}
                      <span className="relative">{tab.label}</span>
                    </Link>
                  </motion.div>
                )
              })}
            </nav>
          </LayoutGroup>
        </motion.div>

        {/* A second hairline only when a tab is showing: on a page that is not a tab
            (profile, a branch) the condensed droplet would otherwise read "mark | | ...". */}
        {!condensed || onTab ? (
          <motion.span
            layout="position"
            transition={{ layout: morph }}
            aria-hidden="true"
            className="relative mx-1 hidden h-5 w-px bg-line sm:block"
          />
        ) : null}

          <motion.div
            layout="position"
            transition={{ layout: morph }}
            // Not positioned: on a phone the bell's panel spans the droplet, not this group.
            className="ml-auto flex items-center gap-0.5 sm:ml-0"
          >
            {/* Search: the ⌘K palette, which also creates tasks. Labelled from lg while whole. */}
            <motion.button
              type="button"
              onClick={openPalette}
              whileTap={reduce ? undefined : TAP_PRESS}
              aria-label="Search"
              aria-keyshortcuts={isApple ? "Meta+K" : "Control+K"}
              className="relative inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-full px-3 text-ink-muted transition-colors duration-fast hover:bg-ink/5 hover:text-ink"
            >
              <Search className="h-5 w-5" aria-hidden="true" />
              {!condensed ? (
                <kbd
                  suppressHydrationWarning
                  aria-hidden="true"
                  className="hidden rounded-sm border border-line bg-paper-sunken px-1.5 font-sans text-caption font-semibold text-ink-muted lg:inline"
                >
                  {isApple ? "⌘K" : "Ctrl K"}
                </kbd>
              ) : null}
            </motion.button>

            <NotificationBell
              open={open === "bell"}
              onOpenChange={(next) => setOpen(next ? "bell" : null)}
              triggerClassName="h-11 w-11 rounded-full"
            />

            {/* Account — sm and up. A disclosure, not an ARIA `menu`: two plain buttons behind
                a toggle need no arrow-key contract. On phones the menu carries the same actions. */}
            <div ref={menuRef} className="relative hidden sm:block">
              <motion.button
                ref={menuTriggerRef}
                type="button"
                onClick={() => setOpen(menuOpen ? null : "menu")}
                whileTap={reduce ? undefined : TAP_PRESS}
                aria-label={`User menu for ${displayName}`}
                aria-expanded={menuOpen}
                aria-controls="navbar-account"
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-full ring-offset-2 ring-offset-paper transition-shadow duration-fast",
                  menuOpen ? "ring-2 ring-ink" : "hover:ring-2 hover:ring-line-strong",
                )}
              >
                <Avatar
                  src={user?.profilePictureUrl}
                  firstName={user?.firstName}
                  lastName={user?.lastName}
                  email={user?.email}
                  size={36}
                  priority
                />
              </motion.button>

              <AnimatePresence>
                {menuOpen ? (
                  <motion.div
                    {...popIn}
                    transition={{ duration: DURATION_FAST, ease: EASE_OUT_EXPO }}
                    id="navbar-account"
                    aria-label="Account"
                    className={cn(POPOVER_SURFACE, "absolute right-0 top-full z-dropdown mt-3.5 w-64 origin-top-right rounded-xl p-1.5")}
                  >
                    <div className="flex items-center gap-3 px-3 pb-2.5 pt-2">
                      <Avatar
                        src={user?.profilePictureUrl}
                        firstName={user?.firstName}
                        lastName={user?.lastName}
                        email={user?.email}
                        size={36}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-body-sm font-semibold text-ink">{displayName}</p>
                        <p className="mt-0.5 truncate text-caption text-ink-muted">{user?.email}</p>
                      </div>
                    </div>
                    <div className="my-1 h-px bg-line" aria-hidden="true" />
                    <button type="button" onClick={goToProfile} className={MENU_ITEM}>
                      <User className="h-4 w-4" aria-hidden="true" />
                      Profile
                    </button>
                    <button type="button" onClick={handleLogout} className={MENU_ITEM}>
                      <LogOut className="h-4 w-4" aria-hidden="true" />
                      Sign out
                    </button>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            {/* The phone menu's toggle: your face and a chevron that turns. */}
            <motion.button
              ref={sheetToggleRef}
              type="button"
              onClick={() => setOpen(sheetOpen ? null : "sheet")}
              whileTap={reduce ? undefined : TAP_PRESS}
              aria-label={sheetOpen ? "Close menu" : "Open menu"}
              aria-expanded={sheetOpen}
              aria-controls="navbar-sheet"
              className="flex h-11 items-center gap-1 rounded-full pl-1 pr-2 transition-colors duration-fast hover:bg-ink/5 sm:hidden"
            >
              <Avatar
                src={user?.profilePictureUrl}
                firstName={user?.firstName}
                lastName={user?.lastName}
                email={user?.email}
                size={36}
                priority
              />
              <motion.span
                aria-hidden="true"
                className="flex text-ink-muted"
                animate={{ rotate: sheetOpen ? 180 : 0 }}
                transition={reduce ? { duration: 0 } : SPRING_GENTLE}
              >
                <ChevronDown className="h-4 w-4" />
              </motion.span>
            </motion.button>
          </motion.div>

          <AnimatePresence>
            {sheetOpen ? (
              <motion.div
                key="sheet"
                id="navbar-sheet"
                data-testid="navbar-mobile"
                {...drip}
                transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                className={cn(POPOVER_SURFACE, "absolute inset-x-0 top-full mt-2 origin-top rounded-xl p-2 sm:hidden")}
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
                          "flex h-12 items-center justify-between rounded-xl px-4 text-body font-semibold transition-colors duration-fast",
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
                      size={36}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-body-sm font-semibold text-ink">{displayName}</p>
                      {user?.email ? <p className="truncate text-caption text-ink-muted">{user.email}</p> : null}
                    </div>
                  </div>
                  <button type="button" onClick={goToProfile} className={cn(MENU_ITEM, "h-12 rounded-xl px-4")}>
                    <User className="h-4 w-4" aria-hidden="true" />
                    Profile
                  </button>
                  <button type="button" onClick={handleLogout} className={cn(MENU_ITEM, "h-12 rounded-xl px-4")}>
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    Sign out
                  </button>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
      </DropletFrame>
    </>
  )
}
