"use client"

import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Loader2, MailCheck, MailQuestion, Unlink } from "lucide-react"
import { api } from "@/lib/api"
import { refreshAccessToken } from "@/lib/auth-public"
import { getLinkRequestMessage, getVerifyErrorKind, NETWORK_MESSAGE } from "@/lib/errors"
import { useAuthStore } from "@/store/auth"
import { Button, buttonVariants } from "@/components/ui/button"
import { AuthBanner, AuthCard, AuthMark } from "@/components/auth/auth-chrome"
import { cn } from "@/lib/utils"

/**
 * Confirming an email address from the link in the verification email.
 *
 * The old page asked people to "paste your verification token" and linked "Back to
 * profile" even for visitors who were signed out. A link in an email is the whole
 * interface: opening it starts the check, and every outcome ends on something to do
 * next — continue into the app, sign in, or (when signed in) send a fresh link.
 *
 * The failure copy covers "already verified" on purpose. The server answers an address
 * that was already confirmed sometimes with success and sometimes with the same refusal
 * as an expired link, depending on whether the old token had been cleared; telling
 * someone their link "didn't work" when their address is in fact confirmed would send
 * them chasing a problem they do not have.
 *
 * Each state is its own card (`key`), not the same card re-filled. Re-filled, the body
 * of the card slid down whenever a longer sentence replaced "This takes a second." —
 * a layout shift on every failed link. A new card has nothing that moves.
 *
 * Which actions a card offers depends on whether the visitor is signed in, and that is
 * not known until the session restore finishes — so the action area reserves its height
 * and fills in once it is.
 */
type State = "verifying" | "verified" | "failed" | "network" | "no-token" | "resent"

const PRIMARY = cn(buttonVariants({ size: "lg" }), "w-full")
const SECONDARY = cn(buttonVariants({ variant: "ghost", size: "lg" }), "w-full")

function VerifyEmailContent() {
  const params = useSearchParams()
  const token = (params.get("token") || params.get("verificationToken") || "").trim()
  const applyRefresh = useAuthStore((s) => s.applyRefresh)
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const hasRestoredSession = useAuthStore((s) => s.hasRestoredSession)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const settled = hasHydrated && hasRestoredSession
  const signedIn = settled && isAuthenticated

  const [state, setState] = useState<State>(token ? "verifying" : "no-token")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const startedFor = useRef<string | null>(null)

  const verify = useCallback(async () => {
    setState("verifying")
    setError(null)
    try {
      await api.get("/auth/api/v1/users/verify-email", { params: { token } })
      try {
        // A signed-in visitor's access token carries the old email_verified claim.
        applyRefresh(await refreshAccessToken())
      } catch {
        // Signed out, or the refresh failed: the address is verified either way.
      }
      setState("verified")
    } catch (err: unknown) {
      setState(getVerifyErrorKind(err) === "network" ? "network" : "failed")
    }
  }, [token, applyRefresh])

  // Once per token, including under StrictMode's double effect in development — a
  // second request would find the token already spent and report a failure.
  useEffect(() => {
    if (!token || startedFor.current === token) return
    startedFor.current = token
    void verify()
  }, [token, verify])

  const resend = async () => {
    setSending(true)
    setError(null)
    try {
      await api.post("/auth/api/v1/users/me/verify-email", {})
      setState("resent")
    } catch (err: unknown) {
      setError(getLinkRequestMessage(err))
    } finally {
      setSending(false)
    }
  }

  /** The way forward from a link that could not be used. */
  const deadEndActions = (
    <div className="space-y-3">
      {!settled ? (
        <div className="h-control-lg rounded-md bg-paper-sunken" aria-hidden="true" />
      ) : signedIn ? (
        <>
          <Button type="button" size="lg" className="w-full" onClick={resend} loading={sending}>
            Send a new link
          </Button>
          <Link href="/profile" className={SECONDARY}>
            Go to your profile
          </Link>
        </>
      ) : (
        <Link href="/auth/login" className={PRIMARY}>
          Sign in
        </Link>
      )}
    </div>
  )

  if (state === "verifying") {
    return (
      <AuthCard key="verifying" mark={<AuthMark icon={MailCheck} />} title="Checking your link" lead="This takes a second.">
        <div role="status" aria-busy="true" className="flex h-control-lg items-center justify-center text-ink-muted">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
          <span className="sr-only">Checking your link</span>
        </div>
      </AuthCard>
    )
  }

  if (state === "verified") {
    return (
      <AuthCard key="verified" mark={<AuthMark icon="check" />} title="Email verified" lead="Thanks. Your address is confirmed.">
        <div>
          {!settled ? (
            <div className="h-control-lg rounded-md bg-paper-sunken" aria-hidden="true" />
          ) : signedIn ? (
            <Link href="/dashboard" className={PRIMARY}>
              Continue to Planora
            </Link>
          ) : (
            <Link href="/auth/login" className={PRIMARY}>
              Sign in
            </Link>
          )}
        </div>
      </AuthCard>
    )
  }

  if (state === "resent") {
    return (
      <AuthCard
        key="resent"
        mark={<AuthMark icon={MailCheck} />}
        title="New link sent"
        lead="Check your inbox for the email from Planora. The link works once, for 24 hours."
      >
        <Link href="/dashboard" className={PRIMARY}>
          Continue to Planora
        </Link>
      </AuthCard>
    )
  }

  if (state === "network") {
    return (
      <AuthCard key="network" mark={<AuthMark icon={Unlink} />} title="We couldn't check your link" lead={NETWORK_MESSAGE}>
        <Button type="button" size="lg" className="w-full" onClick={() => void verify()}>
          Try again
        </Button>
      </AuthCard>
    )
  }

  if (state === "no-token") {
    return (
      <AuthCard
        key="no-token"
        mark={<AuthMark icon={MailQuestion} />}
        title="Open the link from your email"
        lead="The verification email from Planora has a button that brings you here."
      >
        <div className="space-y-4">
          <AuthBanner message={error} />
          {deadEndActions}
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      key="failed"
      mark={<AuthMark icon={Unlink} />}
      title="This link didn't work"
      lead="Verification links work once and last 24 hours. If you've already verified this address, you're all set."
    >
      <div className="space-y-4">
        <AuthBanner message={error} />
        {deadEndActions}
      </div>
    </AuthCard>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" aria-busy="true" />}>
      <VerifyEmailContent />
    </Suspense>
  )
}
