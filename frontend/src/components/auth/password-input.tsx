"use client"

import { forwardRef, useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * A password field with a reveal toggle.
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
 */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function PasswordInput({ className, ...props }, ref) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <Input
        {...props}
        ref={ref}
        type={visible ? "text" : "password"}
        className={cn("pr-14", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        className={cn(
          "absolute right-0 top-1/2 flex h-control w-control -translate-y-1/2 items-center justify-center",
          "rounded-md text-ink-subtle transition-colors duration-fast hover:text-ink"
        )}
      >
        {visible ? (
          <EyeOff className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Eye className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    </div>
  )
})
