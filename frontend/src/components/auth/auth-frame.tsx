"use client"

import { createContext, useCallback, useContext, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion, useReducedMotion } from "framer-motion"
import { Check } from "lucide-react"
import { Wordmark } from "@/components/ui/wordmark"
import { DURATION_SLOW, EASE_STANDARD, SPRING_STANDARD } from "@/lib/animations"
import { RECOVERY_STEPS, recoveryStepFor, type RecoveryStep } from "@/lib/auth-flow"
import { cn } from "@/lib/utils"

/**
 * The one room every `/auth/*` screen happens in.
 *
 * Sign-in and create-account used to be a split screen with a dark marketing panel;
 * the three recovery and verification screens were a glass card with their own
 * shadow, their own grey buttons and their own copy of the logo. Two visual systems for
 * one task, and nothing on any of them led back to the product's home page.
 *
 * Now there is one layout for phone and desktop: a top bar whose wordmark goes home and
 * one centred column. There is no footer: it held a tagline and a second link home, and
 * as the one element below the card it was also the one thing that moved whenever the
 * card grew — a "checking your link" card becoming a taller "this link didn't work" one
 * measured as a layout shift. It is rendered by `app/auth/layout.tsx`, which the
 * router does NOT remount between auth routes — so moving from "forgot password" to
 * "check your inbox" changes the card and leaves the frame, and the recovery step scale
 * in it, standing still. That is what lets the scale's marker slide from one step to
 * the next instead of two scales mounting in turn.
 *
 * The column is top-aligned, not vertically centred. A centred column moves every time
 * the card changes height — a banner appearing, a two-step code replacing the password
 * field, the reset form becoming its success card — and each of those moves is a layout
 * shift under the pointer. Top-aligned, a taller card only grows downward.
 */

const RecoveryDoneContext = createContext<(done: boolean) => void>(() => {})

/**
 * Lets the reset page move the step scale to "Done" once the new password saved. The
 * flag belongs to the route it was set on, so it resets itself on the next navigation.
 */
export function useRecoveryDone(): (done: boolean) => void {
  return useContext(RecoveryDoneContext)
}

export function AuthFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? ""
  const [doneOn, setDoneOn] = useState<string | null>(null)
  const markDone = useCallback((done: boolean) => setDoneOn(done ? pathname : null), [pathname])

  const routeStep = recoveryStepFor(pathname)
  const step: RecoveryStep | null = routeStep === 3 && doneOn === pathname ? 4 : routeStep

  return (
    <RecoveryDoneContext.Provider value={markDone}>
      <div className="flex min-h-screen flex-col">
        {/* The safe-area inset sits on the outer element and the spacing on the inner one:
            `.pt-safe` is plain CSS, so on the same element it would REPLACE the padding
            rather than add to it — zero on every screen without a notch. */}
        <header className="pt-safe">
          {/* The same 56/64px row as the landing page's bar and the app bar, so the wordmark
              does not move when you arrive here from either. */}
          <div className="container-app flex h-14 items-center sm:h-16">
            <Link
              href="/"
              aria-label="Planora home"
              className="-ml-2 inline-flex min-h-control items-center rounded-md px-2"
            >
              <Wordmark />
            </Link>
          </div>
        </header>

        <main id="main" className="flex flex-1 justify-center px-4 pb-16 pt-4 sm:pt-12 lg:pt-16">
          <div className="w-full max-w-md">
            {step !== null ? <RecoverySteps step={step} className="mb-6" /> : null}
            {children}
          </div>
        </main>
      </div>
    </RecoveryDoneContext.Provider>
  )
}

/**
 * Where you are in resetting a password: Email → Inbox → New password → Done.
 *
 * Recovery used to be four dead ends that did not know about each other. The scale
 * turns them into one path a person can see the end of, and the soft halo behind the
 * current step slides to the next one when the route changes — one object moving, which
 * is what says "same process, next step" rather than "new page".
 *
 * Completed steps carry a check and an sr-only "(done)"; the current one is
 * `aria-current="step"`. The connecting line fills with `scaleX`, never `width`.
 */
export function RecoverySteps({ step, className }: { step: RecoveryStep; className?: string }) {
  const reduce = useReducedMotion() ?? false

  return (
    <nav aria-label="Password reset" className={className}>
      <ol className="relative grid grid-cols-4">
        {/* The track runs between the first and last circle centres: each column is a
            quarter, so the centres sit at 12.5% and 87.5%. */}
        <span aria-hidden="true" className="absolute inset-x-[12.5%] top-3 h-0.5 -translate-y-1/2 bg-line" />
        <motion.span
          aria-hidden="true"
          className="absolute inset-x-[12.5%] top-3 h-0.5 origin-left -translate-y-1/2 bg-ink"
          initial={false}
          animate={{ scaleX: (step - 1) / (RECOVERY_STEPS.length - 1) }}
          transition={reduce ? { duration: 0 } : { duration: DURATION_SLOW, ease: EASE_STANDARD }}
        />

        {RECOVERY_STEPS.map((item) => {
          const current = item.step === step
          const done = item.step < step || (current && item.step === 4)
          const reached = item.step <= step

          return (
            <li
              key={item.step}
              aria-current={current ? "step" : undefined}
              className="relative flex flex-col items-center gap-2"
            >
              <span className="relative flex h-6 w-6 items-center justify-center">
                {current ? (
                  <motion.span
                    layoutId="recovery-step"
                    aria-hidden="true"
                    className="absolute -inset-1.5 rounded-full bg-ink/10"
                    transition={reduce ? { duration: 0 } : SPRING_STANDARD}
                  />
                ) : null}
                <span
                  aria-hidden="true"
                  className={cn(
                    "relative flex h-6 w-6 items-center justify-center rounded-full text-caption font-bold tabular-nums",
                    "transition-colors duration-fast",
                    reached ? "bg-ink text-paper" : "border-2 border-line-strong bg-paper text-ink-muted",
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : item.step}
                </span>
              </span>
              <span
                className={cn(
                  "text-caption font-semibold transition-colors duration-fast",
                  reached ? "text-ink" : "text-ink-muted",
                )}
              >
                {item.label}
                {done ? <span className="sr-only"> (done)</span> : null}
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
