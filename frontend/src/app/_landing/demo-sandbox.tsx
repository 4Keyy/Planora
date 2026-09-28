"use client"

import { useEffect, useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import { useAuthStore } from "@/store/auth"
import { disableDemo, enableDemo } from "@/lib/demo/enable"
import { isDemoSession } from "@/lib/demo/flag"
import { StatusPanel } from "@/components/ui/status-panel"

/**
 * Installs the demo sandbox for the landing route, and says so on screen.
 *
 * The disclosure is not a legal footnote, it is the thing that makes the sandbox honest.
 * A page that seeds a session and answers its own API without telling anyone would be
 * exactly the deception this work exists to remove; a page that says "this is a sandbox,
 * these people are made up, nothing you do leaves this tab" and then behaves like the real
 * product is the most truthful demo available short of handing out accounts.
 *
 * ## Three states, decided only after the real session restore
 *
 * - **waiting** — until the auth store has hydrated AND `restoreSession()` has finished.
 *   Installing earlier raced the restore: an anonymous visitor's failed refresh wiped the
 *   seeded session and broadcast a logout to other tabs, and a seeded token that was
 *   already in the store got POSTed to the real server for validation (see
 *   `lib/demo/enable.ts`). The placeholder reserves the console's footprint, so the swap
 *   that follows moves nothing.
 * - **signed-in** — a visitor with a real session keeps it, untouched. The sandbox would
 *   have to replace their token to run, and they already have the real thing one click
 *   away, so this block points there instead.
 * - **demo** — everyone else: the transport is swapped and a session is seeded.
 */
type Mode = "waiting" | "signed-in" | "demo"

export function DemoSandbox({
  children,
  placeholder,
}: {
  children: ReactNode
  /** Rendered while waiting. Must occupy the children's footprint. */
  placeholder: ReactNode
}) {
  const pathname = usePathname()
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const hasRestoredSession = useAuthStore((s) => s.hasRestoredSession)
  const [mode, setMode] = useState<Mode>("waiting")

  useEffect(() => {
    if (pathname !== "/" || !hasHydrated || !hasRestoredSession) return
    const { isAuthenticated } = useAuthStore.getState()
    if (isAuthenticated && !isDemoSession()) {
      setMode("signed-in")
      return
    }
    enableDemo(pathname)
    setMode("demo")
    return () => {
      disableDemo()
      setMode("waiting")
    }
  }, [pathname, hasHydrated, hasRestoredSession])

  if (mode === "waiting") return <>{placeholder}</>
  if (mode === "signed-in") {
    return (
      <StatusPanel
        title="You're signed in"
        description="These keys work in your own list, on your own tasks."
        action={{ label: "Open my tasks", href: "/tasks" }}
        size="compact"
        as="p"
      />
    )
  }
  return <>{children}</>
}

/**
 * The standing disclosure. Rendered once, near the demos, and deliberately plain: an
 * accent colour or an icon would make it read as a feature callout rather than a fact.
 *
 * "Nothing you do here leaves this tab" is checked, not hoped: every call the console,
 * the palette and the task editor make goes through `api`, whose transport is the
 * in-memory adapter; realtime never starts in a demo session; the CSRF cookie is seeded
 * so `lib/csrf.ts` never fetches one; and the session restore — the one path that used to
 * reach the server with the seeded token — has already finished before the seed exists.
 */
export function SandboxNotice() {
  return (
    <p className="text-caption text-ink-muted">
      A sandbox in your browser: made-up people and tasks, the app&rsquo;s own code. Nothing
      you do here leaves this tab.
    </p>
  )
}
