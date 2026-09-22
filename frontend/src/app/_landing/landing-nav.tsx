"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { ArrowRight } from "lucide-react"
import { useAuthStore } from "@/store/auth"
import { Button } from "@/components/ui/button"
import { isDemoSession } from "@/lib/demo/flag"

/**
 * The nav, and the one primary action.
 *
 * It sits OUTSIDE every animated wrapper on this page. A transform on an ancestor
 * creates a containing block and breaks `position: sticky` — the trap that forced the
 * profile route's root to carry no entrance transform at all.
 *
 * The signed-in check waits for `hasRestoredSession`, the way `/auth/login` does.
 * Without that wait a returning visitor reads "Start for free" while the silent refresh
 * is still in flight, and a click during that window sends them to `/auth/login`, which
 * immediately bounces them to `/dashboard` — two redirects to reach the page they were
 * already entitled to.
 */
export function LandingNav() {
  const router = useRouter()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const hasRestoredSession = useAuthStore((s) => s.hasRestoredSession)
  const [mounted, setMounted] = useState(false)

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
    <nav
      aria-label="Main"
      className="sticky top-0 z-sticky border-b border-line bg-paper/90 backdrop-blur-sm"
    >
      <div className="container-app flex items-center justify-between gap-4 py-3 pt-safe">
        <span className="text-body font-bold tracking-tight text-ink">Planora</span>

        <div className="flex items-center gap-2">
          <Link
            href="/auth/login"
            className="touch-target inline-flex min-h-control items-center rounded-md px-4 text-body-sm font-semibold text-ink-muted transition-colors duration-fast hover:text-ink"
          >
            Sign in
          </Link>
          <Button onClick={go} suppressHydrationWarning>
            {signedIn ? "Open Planora" : "Start for free"}
            <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </nav>
  )
}
