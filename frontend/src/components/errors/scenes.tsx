"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { ArrowLeft, Home, LayoutDashboard, ListChecks, LogIn, RotateCw, Search } from "lucide-react"
import { useAuthStore } from "@/store/auth"
import { requestPalette } from "@/components/command-palette"
import {
  ErrorScene,
  GhostCard,
  MissingNumeral,
  OfflineMark,
  PathChip,
  ReferenceChip,
  SnagMark,
  type Destination,
} from "@/components/errors/error-scene"

/** "Go back", when there is somewhere to go back to — decided after mount, never on the server. */
function useBack(): Destination | null {
  const [canGoBack, setCanGoBack] = useState(false)
  useEffect(() => setCanGoBack(window.history.length > 1), [])
  return canGoBack
    ? { label: "Go back", hint: "To the page you came from", icon: ArrowLeft, onSelect: () => window.history.back() }
    : null
}

/** Whether the visitor has a session: which way out is useful depends on it. */
function useSignedIn(): boolean {
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return hasHydrated && isAuthenticated
}

/** An address that matches no page. */
export function NotFoundScene() {
  const router = useRouter()
  const pathname = usePathname() ?? "/"
  const signedIn = useSignedIn()
  const back = useBack()
  const home = signedIn ? "/dashboard" : "/"

  const destinations: Destination[] = [
    ...(back ? [back] : []),
    signedIn
      ? { label: "Dashboard", hint: "Today, the week, and what is still open", icon: LayoutDashboard, href: "/dashboard" }
      : { label: "Planora home", hint: "What Planora is, and how it works", icon: Home, href: "/" },
    signedIn
      ? { label: "Find it", hint: "Search your tasks, people and pages — Ctrl K", icon: Search, onSelect: () => requestPalette() }
      : { label: "Sign in", hint: "Your tasks are one step away", icon: LogIn, href: "/auth/login" },
  ]

  return (
    <ErrorScene
      eyebrow="Error 404"
      title="This page isn't on any list."
      description={
        <p>
          The address may be mistyped, or the page has moved on. Tick the zero to go{" "}
          {signedIn ? "to your dashboard" : "home"}, or pick a way out.
        </p>
      }
      art={<MissingNumeral label={signedIn ? "Go to your dashboard" : "Go to the home page"} onTick={() => router.push(home)} />}
      detail={<PathChip path={pathname} />}
      destinations={destinations}
    />
  )
}

/**
 * A screen that crashed — or could not load because the connection is gone, which looks
 * the same from inside the app and is not the same thing to the person: offline, the way
 * out is to wait, and the page tries again by itself the moment the connection returns.
 */
export function CrashScene({
  error,
  reset,
  variant = "page",
  segmentLabel,
}: {
  error: Error & { digest?: string }
  reset: () => void
  variant?: "page" | "inline"
  /** Inside the app: which screen failed ("tasks"), for the sentence and the report. */
  segmentLabel?: string
}) {
  const signedIn = useSignedIn()
  const back = useBack()
  const [online, setOnline] = useState(true)
  const [reconnected, setReconnected] = useState(false)

  useEffect(() => {
    // The raw message is never shown — it can carry a stack trace or someone else's data —
    // but it is reported, for whatever collects console errors.
    if (segmentLabel) console.error(`[${segmentLabel}] segment-level error`, error)
    else console.error("[app] route-level error", error)
  }, [error, segmentLabel])

  useEffect(() => {
    setOnline(navigator.onLine)
    const goOffline = () => setOnline(false)
    const goOnline = () => {
      setOnline(true)
      setReconnected(true)
    }
    window.addEventListener("offline", goOffline)
    window.addEventListener("online", goOnline)
    return () => {
      window.removeEventListener("offline", goOffline)
      window.removeEventListener("online", goOnline)
    }
  }, [])

  // Back online after being offline here: close the ring, then try again by itself.
  useEffect(() => {
    if (!reconnected) return
    const timer = window.setTimeout(reset, 650)
    return () => window.clearTimeout(timer)
  }, [reconnected, reset])

  const retry: Destination = { label: "Retry", hint: "Load this screen again", icon: RotateCw, onSelect: reset }
  // Inside the app the visitor is signed in by definition: the guard let the page through.
  const dashboard: Destination = signedIn || variant === "inline"
    ? { label: "Back to dashboard", hint: "Everything else is where you left it", icon: LayoutDashboard, href: "/dashboard" }
    : { label: "Planora home", hint: "Start again from the front page", icon: Home, href: "/" }

  if (!online || reconnected) {
    return (
      <ErrorScene
        variant={variant}
        eyebrow="Offline"
        title={online ? "Back online." : "You're offline."}
        description={
          <p>
            {online
              ? "Picking up where you left off…"
              : "This screen needs the connection to load. It will try again by itself the moment you're back."}
          </p>
        }
        art={<OfflineMark online={online} />}
        destinations={[retry, ...(back ? [back] : [])]}
      />
    )
  }

  return (
    <ErrorScene
      variant={variant}
      eyebrow={segmentLabel ? "Error" : "Something broke"}
      title={segmentLabel ? `Something went wrong while loading ${segmentLabel}.` : "This screen hit a snag."}
      description={
        <p>
          An error stopped it from loading. Retrying usually fixes it — nothing you saved is lost.
          If it keeps happening, quote the reference below.
        </p>
      }
      art={<SnagMark />}
      detail={error.digest ? <ReferenceChip id={error.digest} /> : null}
      destinations={[retry, dashboard, ...(back && variant === "page" ? [back] : [])]}
    />
  )
}

/** A task that is not there for this person: deleted, or never shared with them. */
export function MissingTaskScene() {
  const back = useBack()
  return (
    <ErrorScene
      variant="inline"
      eyebrow="Task"
      title="This task isn't here."
      description={
        <p>
          It may have been deleted, or it isn't shared with you. If someone sent you this link, ask
          them to share the task with you.
        </p>
      }
      art={<GhostCard />}
      destinations={[
        { label: "Your tasks", hint: "Everything that is open", icon: ListChecks, href: "/tasks" },
        { label: "Dashboard", hint: "Today and the week", icon: LayoutDashboard, href: "/dashboard" },
        ...(back ? [back] : []),
      ]}
    />
  )
}
