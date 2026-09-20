"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { FIELD_LABEL_CLASS } from "@/components/ui/field"

type ProbeResult = {
  readable: string[]
  refreshTokenReadable: boolean
}

/**
 * Block 7 — the httpOnly guarantee, failing in front of the visitor.
 *
 * Every other security claim on a landing page asks to be believed. This one does not:
 * `document.cookie` cannot see a cookie carrying the `HttpOnly` flag, so the page asks
 * the browser for every cookie JavaScript can read on this origin and prints what came
 * back. `refresh_token` is not in that list, and cannot be, and the visitor watches
 * that happen in their own browser with no network request involved.
 *
 * Names only, never values. A page whose argument is restraint about data does not get
 * to print cookie values on screen, even the visitor's own.
 */
export function SessionProbe() {
  const [result, setResult] = useState<ProbeResult | null>(null)

  const probe = () => {
    let names: string[] = []
    try {
      names = document.cookie
        .split(";")
        .map((pair) => pair.split("=")[0]?.trim() ?? "")
        .filter(Boolean)
    } catch {
      names = []
    }
    setResult({
      readable: names,
      refreshTokenReadable: names.includes("refresh_token"),
    })
  }

  return (
    <div className="rounded-lg border border-line bg-paper-raised p-6 shadow-sm sm:p-7">
      <p className={FIELD_LABEL_CLASS}>Check it yourself</p>

      <p className="mt-3 text-body-sm text-ink-muted">
        This asks your browser for every cookie JavaScript can read on this page, and prints the
        names it finds. Never the values.
      </p>

      <div className="mt-5">
        <Button variant="outline" onClick={probe}>
          Read every cookie this page can
        </Button>
      </div>

      {/* Reserved height: the result must not push the section below it down. */}
      <div className="mt-5 min-h-24 rounded-md border border-line bg-paper-sunken p-4" aria-live="polite">
        {result === null ? (
          <p className="text-body-sm text-ink-subtle">Nothing read yet.</p>
        ) : (
          <>
            <p className="text-body-sm text-ink-muted">
              {result.readable.length === 0
                ? "JavaScript can read no cookies at all here — you are signed out and nothing has been set yet."
                : `JavaScript can read ${result.readable.length}: ${result.readable.join(", ")}.`}
            </p>
            <p className="mt-2 text-body-sm font-semibold text-ink">
              {result.refreshTokenReadable
                ? "refresh_token was readable — that would be a bug, and we would want to hear about it."
                : result.readable.length === 0
                  ? "Sign in and press this again: the CSRF cookie will appear in that list and refresh_token still will not."
                  : "refresh_token is not among them, because it never can be."}
            </p>
          </>
        )}
      </div>

      <p className="mt-4 text-caption text-ink-subtle">
        The flag that does it is <code>HttpOnly</code>, set by the server when you sign in.
      </p>
    </div>
  )
}
