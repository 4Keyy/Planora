"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState, type FocusEvent } from "react"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { useReducedMotion } from "framer-motion"
import { useAuthStore } from "@/store/auth"
import { Button } from "@/components/ui/button"
import { Wordmark } from "@/components/ui/wordmark"
import { DropletFrame, isKeyboardFocus, useDropletScroll, useIsPhone } from "@/components/layout/droplet"
import { isDemoSession } from "@/lib/demo/flag"

/**
 * The nav, and the one primary action — drawn as the same droplet as the app's bar, so the
 * page a visitor meets first and the product they sign into share one piece of chrome.
 *
 * The droplet is `fixed` and takes no room, so this component also renders the room the
 * old in-flow bar took (the safe-area inset plus 56/64px). The hero therefore starts
 * exactly where it did, which keeps the `h1` — the LCP element — on the same pixel.
 *
 * It sits OUTSIDE every animated wrapper on this page: a transform on an ancestor creates a
 * containing block and would re-anchor the fixed capsule to it.
 *
 * The signed-in check waits for `hasRestoredSession`, the way `/auth/login` does. Without
 * that wait a returning visitor reads "Start for free" while the silent refresh is still in
 * flight, and a click during that window sends them to `/auth/login`, which immediately
 * bounces them to `/dashboard` — two redirects to reach the page they were already entitled
 * to.
 */
export function LandingNav() {
  const router = useRouter()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const hasRestoredSession = useAuthStore((s) => s.hasRestoredSession)
  const [mounted, setMounted] = useState(false)
  const [focused, setFocused] = useState(false)
  const reduce = useReducedMotion() ?? false
  const phone = useIsPhone()
  const scroll = useDropletScroll()

  useEffect(() => setMounted(true), [])

  const settled = mounted && hasHydrated && hasRestoredSession
  /**
   * The demo sandbox seeds a session so the palette and the list work further down the
   * page, and that session must not reach this button. Without the check the nav reads
   * "Open Planora" to a visitor who has no account, and following it lands them on a
   * guarded route the real API cannot serve — the sandbox answering for the landing page
   * only, not for the app.
   *
   * Read during render rather than through state on purpose: this is the render that the
   * seeding triggers, and by the time it runs the flag is already set.
   */
  const signedIn = settled && isAuthenticated && !isDemoSession()

  const go = () => {
    if (signedIn && useAuthStore.getState().isTokenValid()) router.push("/dashboard")
    else router.push("/auth/register")
  }

  return (
    <>
      <DropletFrame
        as="nav"
        label="Main"
        // On a phone the droplet slides away while you read down the page and comes back
        // the moment you scroll up — or the moment focus lands in it.
        hidden={!reduce && phone && scroll.hidden && !focused}
        onFocus={(e) => {
          if (isKeyboardFocus(e.target)) setFocused(true)
        }}
        onBlur={(e: FocusEvent<HTMLElement>) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
        }}
      >
        {/* The name from 400px: below that, the mark, the sign-in link and the primary action
            need the whole width of a 360px capsule, and the name was pushing "Sign in" onto
            two lines. The mark still names the product, and the page's h1 is right below. */}
        <span className="relative flex h-11 items-center gap-2 px-3">
          <Wordmark showName={false} />
          <span className="hidden text-body font-bold tracking-tight text-ink min-[400px]:inline">Planora</span>
        </span>

        <span className="relative ml-auto flex items-center gap-1 sm:ml-2">
          <Link
            href="/auth/login"
            className="inline-flex h-11 items-center whitespace-nowrap rounded-full px-4 text-body-sm font-semibold text-ink-muted transition-colors duration-fast hover:bg-ink/5 hover:text-ink"
          >
            Sign in
          </Link>
          <Button onClick={go} suppressHydrationWarning className="h-11 whitespace-nowrap rounded-full px-4 sm:px-5">
            {signedIn ? "Open Planora" : "Start for free"}
            <ArrowRight className="ml-1 hidden h-4 w-4 sm:block" aria-hidden="true" />
          </Button>
        </span>
      </DropletFrame>

      {/* The room the droplet floats in: the height the in-flow bar used to take. */}
      <div aria-hidden="true" className="pt-safe">
        <div className="h-14 sm:h-16" />
      </div>
    </>
  )
}
