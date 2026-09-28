"use client"

import { forwardRef, useState, type FocusEvent, type KeyboardEvent } from "react"
import { ArrowBigUp, Eye, EyeOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * A password field with a reveal toggle and, on request, a Caps Lock warning.
 *
 * Written three times across the two auth screens before this — same markup, same
 * toggle, drifting independently. Living in `components/` rather than beside one route
 * also pulls it under the 85% coverage gate, which `src/app/**` is excluded from.
 *
 * The toggle is a real 44×44 target. It was 36×36, which `.touch-target` was papering
 * over: that utility paints an invisible 44px hit area with a pseudo-element, and the
 * pseudo-element is clipped by any `overflow: hidden` ancestor and inherits
 * `pointer-events: none` from any wrapper that sets it. A control that measures 44 to
 * a probe and accepts no taps is worse than one that measures 36 honestly.
 *
 * Caps Lock is the one password mistake the field can see coming: the characters are
 * masked, so a person types a correct password in the wrong case and learns about it
 * only from the refusal. The browser reports the key's state on every key event
 * (`getModifierState`), so the warning appears while typing and goes away on blur. The
 * caller's own `onKeyDown`/`onKeyUp`/`onBlur` still run — react-hook-form's `register`
 * passes an `onBlur`, and dropping it would silently stop validation on blur.
 */
export interface PasswordInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Show "Caps Lock is on" under the field while it is focused and Caps Lock is on. */
  capsLockHint?: boolean
  onCapsLockChange?: (on: boolean) => void
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { className, capsLockHint = false, onCapsLockChange, onKeyDown, onKeyUp, onBlur, ...props },
  ref,
) {
  const [visible, setVisible] = useState(false)
  const [capsLock, setCapsLock] = useState(false)

  const report = (on: boolean) => {
    if (on === capsLock) return
    setCapsLock(on)
    onCapsLockChange?.(on)
  }

  const readKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (typeof event.getModifierState === "function") report(event.getModifierState("CapsLock"))
  }

  return (
    <div>
      <div className="relative">
        <Input
          {...props}
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn("pr-14", className)}
          onKeyDown={(event) => {
            readKey(event)
            onKeyDown?.(event)
          }}
          onKeyUp={(event) => {
            readKey(event)
            onKeyUp?.(event)
          }}
          onBlur={(event: FocusEvent<HTMLInputElement>) => {
            report(false)
            onBlur?.(event)
          }}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          className={cn(
            "absolute right-0 top-1/2 flex h-control w-control -translate-y-1/2 items-center justify-center",
            "rounded-md text-ink-subtle transition-colors duration-fast hover:text-ink",
          )}
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      {capsLockHint && capsLock ? (
        <p role="status" className="mt-2 flex animate-fade-in items-center gap-1.5 text-caption font-semibold text-ink-muted">
          <ArrowBigUp className="h-3.5 w-3.5" aria-hidden="true" />
          Caps Lock is on
        </p>
      ) : null}
    </div>
  )
})
