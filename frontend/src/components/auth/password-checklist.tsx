"use client"

import { useReducedMotion } from "framer-motion"
import { motion } from "@/components/ui/motion"
import { DURATION_FAST, EASE_OUT_EXPO } from "@/lib/animations"
import { PASSWORD_RULES } from "@/lib/password-policy"
import { cn } from "@/lib/utils"

/**
 * The password rule, ticking itself off while you type.
 *
 * It replaces a strength bar that scored the password into "Weak / Fair / Good /
 * Strong". The server accepts none of those words; it accepts a password that meets five
 * rules. So the bar could say "Good" over a password the server was about to refuse, and
 * the refusal then arrived as a sentence that did not match anything on screen. The list
 * shows exactly the rules the server checks (`PASSWORD_RULES`, held equal to the schema
 * by a test), and each one is met or it is not.
 *
 * A rule that BECOMES met draws its check — `pathLength`, the product's "you did this"
 * stroke. `initial={false}` keeps a rule that is already met when the list mounts from
 * drawing itself: nothing was done just now.
 *
 * No live region. The field points at this list with `aria-describedby`, so a screen
 * reader reads it on focus; announcing every tick while someone types would talk over
 * their own keystrokes.
 */
export function PasswordChecklist({ value, id }: { value: string; id: string }) {
  const reduce = useReducedMotion() ?? false

  return (
    <div>
      <ul id={id} className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
        {PASSWORD_RULES.map((rule) => {
          const met = rule.test(value)
          return (
            <li
              key={rule.id}
              className={cn(
                "flex items-center gap-2 text-caption font-semibold transition-colors duration-fast",
                met ? "text-ink" : "text-ink-muted",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-fast",
                  met ? "border-ink bg-ink" : "border-line-strong bg-paper",
                )}
              >
                <svg viewBox="0 0 24 24" width={10} height={10} fill="none" className="text-paper">
                  <motion.path
                    d="M4.5 12.5 L9.5 17.5 L19.5 7"
                    stroke="currentColor"
                    strokeWidth={4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={false}
                    animate={{ pathLength: met ? 1 : 0, opacity: met ? 1 : 0 }}
                    transition={reduce ? { duration: 0 } : { duration: DURATION_FAST, ease: EASE_OUT_EXPO }}
                  />
                </svg>
              </span>
              {rule.label}
              <span className="sr-only">{met ? " — done" : " — not yet"}</span>
            </li>
          )
        })}
      </ul>
      <p className="mt-3 text-caption text-ink-muted">
        We also check new passwords against known data breaches, without your password leaving Planora.
      </p>
    </div>
  )
}
