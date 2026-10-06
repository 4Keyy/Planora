"use client"

import type { ReactNode } from "react"
import { motion, useReducedMotion } from "framer-motion"
import type { LucideIcon } from "lucide-react"
import { InkCheck } from "@/components/ui/ink-check"
import { DURATION_UI, EASE_OUT_EXPO } from "@/lib/animations"
import { cn } from "@/lib/utils"

/**
 * The furniture every auth screen is built from: one card, one mark, one banner.
 *
 * Five screens used to carry their own copies — two of them a split screen with a dark
 * marketing panel, three of them a glass card with a colour-literal shadow and grey
 * buttons — differing by a token here and there for no reason anybody chose. Living in
 * `components/` also pulls them under the 85% coverage gate, which `src/app/**` is
 * excluded from.
 */

/**
 * The card a screen's one task happens in.
 *
 * The header (mark, title, lead) is centred and the form below it is left-aligned:
 * a centred heading tells you which room you are in, and left-aligned labels are what
 * an eye scanning down a form can follow. The title is the page's `h1` — every auth
 * screen has exactly one.
 */
export function AuthCard({
  mark,
  title,
  lead,
  children,
  footer,
  className,
}: {
  mark?: ReactNode
  title: string
  lead?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn("rounded-xl border border-line bg-paper px-6 py-8 shadow-lg sm:px-10 sm:py-10", className)}
    >
      <div className="flex flex-col items-center text-center">
        {mark}
        {/* Balanced wrapping: a centred two-line heading that ends on one word ("email",
            "its way.") reads as a mistake, and these strings are short enough for the
            browser to even out. */}
        <h1
          className={cn(
            "text-balance text-title font-bold tracking-tight text-ink sm:text-display-sm",
            mark ? "mt-5" : null,
          )}
        >
          {title}
        </h1>
        {lead ? <p className="mt-2 max-w-sm text-balance text-body text-ink-muted">{lead}</p> : null}
      </div>
      {children ? <div className="mt-8">{children}</div> : null}
      {footer ? (
        <div className="mt-8 border-t border-line pt-6 text-center text-body-sm text-ink-muted">{footer}</div>
      ) : null}
    </section>
  )
}

/**
 * The symbol at the top of a card: a lucide icon in a quiet disc, or — for a finished
 * task — the product's drawn check, which is the one "you did this" gesture it has.
 *
 * Arrives by CSS rather than by framer-motion: a CSS animation runs from the first
 * paint, where a motion component would sit invisible in the server HTML until the
 * page hydrated and then pop in late.
 */
export function AuthMark({ icon }: { icon: LucideIcon | "check" }) {
  if (icon === "check") {
    return (
      <span
        aria-hidden="true"
        className="flex h-14 w-14 animate-scale-in items-center justify-center rounded-full border border-line bg-paper-sunken"
      >
        <InkCheck size={24} />
      </span>
    )
  }
  const Icon = icon
  return (
    <span
      aria-hidden="true"
      className="flex h-14 w-14 animate-scale-in items-center justify-center rounded-full border border-line bg-paper-sunken text-ink"
    >
      <Icon className="h-6 w-6" strokeWidth={1.75} />
    </span>
  )
}

/**
 * A form-level message.
 *
 * `tone="alert"` — the submit was refused and the reason belongs to no single field. It
 * carries `role="alert"` so it is actually announced: before this the refusal reached a
 * screen reader only through a toast that then disappeared, leaving nothing beside the
 * form to come back to.
 *
 * `tone="info"` — something the person asked for happened ("Sent again."), announced
 * politely.
 *
 * It arrives from BELOW, the vocabulary's "new thing arriving" vector.
 */
export function AuthBanner({ message, tone = "alert" }: { message: string | null; tone?: "alert" | "info" }) {
  const reduce = useReducedMotion() ?? false
  if (!message) return null

  return (
    <motion.p
      role={tone === "alert" ? "alert" : "status"}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO }}
      className={cn(
        "rounded-md border px-4 py-3 text-body-sm",
        tone === "alert" ? "border-alert/25 bg-alert-surface text-alert" : "border-line bg-paper-sunken text-ink-muted",
      )}
    >
      {message}
    </motion.p>
  )
}

/**
 * An inline link inside a card's footer sentence. `.touch-target` paints a 44px hit area
 * around the 18px line of text without moving anything: the footer holds one link on its
 * own line, so the enlarged area cannot overlap a neighbour's.
 */
export const AUTH_LINK_CLASS =
  "touch-target rounded-sm font-semibold text-ink underline decoration-line-strong underline-offset-4 transition-colors duration-fast hover:decoration-ink"
