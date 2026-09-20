"use client"

import type { ReactNode } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { DURATION_UI, EASE_OUT_EXPO } from "@/lib/animations"

/**
 * The furniture shared by the sign-in and create-account screens.
 *
 * Both screens carried their own copy of every piece below — the same panel, the same
 * lockup, the same banner, differing by a token here and there for no reason anybody
 * chose. Extracting them also pulls them under the 85% coverage gate, which
 * `src/app/**` is excluded from.
 */

/**
 * The dark panel.
 *
 * It is a SURFACE, not a theme: the product ships one light palette, and the reverse
 * ramp (`paper-muted` / `paper-subtle` on `ink`) exists precisely so text on a dark
 * surface keeps its contrast without a `dark:` utility.
 *
 * Three decisions, none of them cosmetic:
 *
 *   - It is `aria-hidden`. It carries no action and no information the form lacks, and
 *     without this a screen-reader user on a desktop walks the entire marketing column
 *     before reaching the email field. The wordmark moved into the form column so
 *     hiding this costs no orientation.
 *   - It is 2/5 of the viewport, not half. The one job of this screen is the form, and
 *     the form should not be the smaller half of its own page.
 *   - It holds ONE sentence. A person on the sign-in page has already chosen the
 *     product; every additional claim here is a tax on the one control that matters,
 *     and six of them is what makes a sign-in page read as a second landing page.
 */
export function AuthPanel({ children }: { children: ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className="relative hidden flex-col justify-between overflow-hidden bg-ink p-12 lg:flex lg:w-2/5"
    >
      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, var(--pl-paper) 1px, transparent 0)",
          backgroundSize: "40px 40px",
        }}
      />
      <div className="relative z-10">
        <span className="text-title-sm font-bold tracking-tight text-paper">Planora</span>
      </div>
      <div className="relative z-10">{children}</div>
      <div className="relative z-10">
        <p className="text-caption text-paper-subtle">Private coordination for people you trust.</p>
      </div>
    </div>
  )
}

/**
 * The wordmark, in the form column, at every breakpoint.
 *
 * It used to be `lg:hidden` — present only on phones, because the desktop got it from
 * the panel. Now that the panel is `aria-hidden`, that arrangement would leave a
 * screen-reader user on a desktop with nothing at all saying where they are.
 */
export function AuthBrand({ tagline }: { tagline: string }) {
  return (
    <div className="mb-7 flex flex-col items-center gap-2 text-center">
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-ink" />
        <span className="text-title-sm font-bold tracking-tight text-ink">Planora</span>
      </span>
      <p className="text-caption font-medium text-ink-subtle">{tagline}</p>
    </div>
  )
}

/**
 * The submit-time failure.
 *
 * It carries `role="alert"` so it is actually announced. Before this the banner was a
 * bare `motion.div` and the message reached a screen reader only through the toast that
 * fired alongside it — so a sighted user read the same sentence twice while a blind
 * user heard it once and had nothing left beside the field to return to. The toast on
 * this path is gone; the message lives where the mistake is.
 *
 * It arrives from BELOW. The previous version came in at `y: -4`, travelling the
 * vocabulary's "dismissed, withdrawn" vector backwards — and 4 is not one of the
 * system's distances.
 */
export function AuthBanner({ message }: { message: string | null }) {
  const reduce = useReducedMotion() ?? false
  if (!message) return null

  return (
    <motion.p
      role="alert"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO }}
      className="rounded-md border border-alert/25 bg-alert-surface px-4 py-3 text-body-sm text-alert"
    >
      {message}
    </motion.p>
  )
}
