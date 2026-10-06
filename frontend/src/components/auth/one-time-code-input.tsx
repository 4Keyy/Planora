"use client"

import { forwardRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { DURATION_FAST, EASE_OUT_EXPO } from "@/lib/animations"
import { cn } from "@/lib/utils"

export const CODE_LENGTH = 6

/** Digits only, at most six — what a pasted "123 456" or "123-456" should become. */
export function normaliseCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, CODE_LENGTH)
}

/**
 * The six-digit code from an authenticator app, as six cells.
 *
 * It is ONE real `<input>` laid over the cells, not six inputs. Six inputs break every
 * way a code actually arrives: a paste lands in the first box and stops, the phone's
 * "from Messages" suggestion fills one box, a password manager fills one box, and
 * backspace has to be taught to walk backwards. One input with
 * `autoComplete="one-time-code"` and `inputMode="numeric"` gets all of that from the
 * platform; the cells are only how its value is drawn. Its text and caret are
 * transparent, and the cell where the next digit will land shows the focus instead —
 * the same 1px ink edge and 3px halo a focused <Input> draws (`field-box`), so the
 * input itself is `field-naked` and never boxes the whole row in the global ring.
 *
 * `onComplete` fires once, when the sixth digit arrives, so the form can submit without
 * a button press — the button is still there for anyone who expects it.
 */
export interface OneTimeCodeInputProps {
  value: string
  onChange: (code: string) => void
  onComplete?: (code: string) => void
  id?: string
  "aria-describedby"?: string
  "aria-invalid"?: boolean
  invalid?: boolean
  autoFocus?: boolean
  label?: string
}

export const OneTimeCodeInput = forwardRef<HTMLInputElement, OneTimeCodeInputProps>(function OneTimeCodeInput(
  { value, onChange, onComplete, id, invalid = false, autoFocus, label = "6-digit code", ...aria },
  ref,
) {
  const reduce = useReducedMotion() ?? false
  const [focused, setFocused] = useState(false)
  const caret = Math.min(value.length, CODE_LENGTH - 1)

  return (
    <div className="relative">
      <div aria-hidden="true" className="grid grid-cols-6 gap-2">
        {Array.from({ length: CODE_LENGTH }, (_, i) => {
          const digit = value[i]
          const active = focused && i === caret
          return (
            <span
              key={i}
              className={cn(
                "flex h-14 items-center justify-center rounded-md bg-paper text-title font-bold tabular-nums text-ink",
                "transition-[border-color,box-shadow] duration-base ease-emphasized",
                invalid
                  ? cn("border-2 border-alert", active && "ring-[3px] ring-alert/[0.12]")
                  : active
                    ? "border border-ink ring-[3px] ring-ink/[0.08]"
                    : "border border-line-strong",
              )}
            >
              <AnimatePresence initial={false}>
                {digit ? (
                  <motion.span
                    key={`${i}-${digit}`}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: DURATION_FAST, ease: EASE_OUT_EXPO }}
                  >
                    {digit}
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </span>
          )
        })}
      </div>
      <input
        ref={ref}
        id={id}
        aria-label={label}
        aria-describedby={aria["aria-describedby"]}
        aria-invalid={invalid || aria["aria-invalid"] || undefined}
        value={value}
        onChange={(event) => {
          const next = normaliseCode(event.target.value)
          if (next === value) return
          onChange(next)
          if (next.length === CODE_LENGTH && value.length < CODE_LENGTH) onComplete?.(next)
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus={autoFocus}
        inputMode="numeric"
        autoComplete="one-time-code"
        // Not `maxLength`: a pasted "123 456" is seven characters and would be cut to
        // "123 45" before `normaliseCode` ever saw it.
        pattern="[0-9]*"
        spellCheck={false}
        className="field-naked absolute inset-0 h-full w-full bg-transparent text-transparent caret-transparent selection:bg-transparent"
      />
    </div>
  )
})
