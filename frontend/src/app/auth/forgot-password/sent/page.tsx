"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Clock, Inbox, MailCheck } from "lucide-react"
import { api } from "@/lib/api"
import { getLinkRequestMessage } from "@/lib/errors"
import {
  RESET_EMAIL_KEY,
  RESET_SENT_AT_KEY,
  cooldownLeft,
  formatCountdown,
  maskEmail,
} from "@/lib/auth-flow"
import { Button, buttonVariants } from "@/components/ui/button"
import { AUTH_LINK_CLASS, AuthBanner, AuthCard, AuthMark } from "@/components/auth/auth-chrome"
import { cn } from "@/lib/utils"

/**
 * Step 2 of 4: "Check your inbox".
 *
 * This screen did not exist. The request form ended on a toast, and the next thing a
 * person needed — which address it went to, how long the link lasts, what to do when it
 * does not arrive — was nowhere. Now it is a real step between asking and resetting.
 *
 * The wording is careful in one place on purpose: the server answers the request the
 * same way whether or not the address has an account (so nobody can use this form to
 * find out who has one), and the screen must not claim otherwise. Hence "If … has an
 * account".
 *
 * "Send it again" waits out a cooldown counted from the last send, because the endpoint
 * is rate-limited and a live button invites the second press that trips the limit. The
 * countdown sits in a fixed-width span, so the button never changes size while it ticks,
 * and the interval runs only while there is something to count.
 */
export default function ResetLinkSentPage() {
  // Read after mount: sessionStorage does not exist on the server.
  const [email, setEmail] = useState<string | null>(null)
  const [sentAt, setSentAt] = useState<number | null>(null)
  const [left, setLeft] = useState(0)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      setEmail(sessionStorage.getItem(RESET_EMAIL_KEY))
      const at = Number(sessionStorage.getItem(RESET_SENT_AT_KEY))
      setSentAt(Number.isFinite(at) && at > 0 ? at : null)
    } catch {
      // Storage blocked: the screen uses the wording that does not need the address.
    }
  }, [])

  useEffect(() => {
    const tick = () => setLeft(cooldownLeft(sentAt, Date.now()))
    tick()
    if (cooldownLeft(sentAt, Date.now()) === 0) return
    const timer = window.setInterval(() => {
      const next = cooldownLeft(sentAt, Date.now())
      setLeft(next)
      if (next === 0) window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [sentAt])

  const resend = async () => {
    if (!email) return
    setSending(true)
    setNotice(null)
    setError(null)
    try {
      await api.post("/auth/api/v1/auth/request-password-reset", { email })
      const now = Date.now()
      try {
        sessionStorage.setItem(RESET_SENT_AT_KEY, String(now))
      } catch {
        // The cooldown still runs for this page; it just will not survive a reload.
      }
      setSentAt(now)
      setNotice("Sent again. It can take a minute to arrive.")
    } catch (err: unknown) {
      setError(getLinkRequestMessage(err))
    } finally {
      setSending(false)
    }
  }

  const coolingDown = left > 0

  return (
    <AuthCard
      mark={<AuthMark icon={MailCheck} />}
      title="Check your inbox"
      lead={
        <>
          If{" "}
          {email ? <span className="font-semibold text-ink">{maskEmail(email)}</span> : "that address"} has an
          account, a reset link is on its way.
        </>
      }
      footer={
        <>
          Back to{" "}
          <Link href="/auth/login" className={AUTH_LINK_CLASS}>
            Sign in
          </Link>
        </>
      }
    >
      <ul className="space-y-3 text-pretty rounded-lg border border-line bg-paper-sunken p-4 text-body-sm text-ink-muted">
        <li className="flex items-start gap-3">
          <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink" aria-hidden="true" />
          The link works once and expires within the hour.
        </li>
        <li className="flex items-start gap-3">
          <Inbox className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink" aria-hidden="true" />
          Can&apos;t find it? Check spam and promotions.
        </li>
      </ul>

      <div className="mt-6 space-y-3">
        <AuthBanner message={error} />
        <AuthBanner message={notice} tone="info" />
        {email ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full"
            onClick={resend}
            loading={sending}
            disabled={coolingDown}
          >
            {coolingDown ? (
              <>
                Send again in{" "}
                <span className="inline-block w-[4ch] text-left tabular-nums">{formatCountdown(left)}</span>
              </>
            ) : (
              "Send it again"
            )}
          </Button>
        ) : null}
        <Link
          href="/auth/forgot-password"
          className={cn(buttonVariants({ variant: email ? "ghost" : "default", size: "lg" }), "w-full")}
        >
          {email ? "Use a different email" : "Enter your email"}
        </Link>
      </div>
    </AuthCard>
  )
}
