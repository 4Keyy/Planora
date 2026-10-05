"use client"

import * as React from "react"
import { motion, useReducedMotion } from "framer-motion"
import { DURATION_UI, EASE_OUT_EXPO } from "@/lib/animations"
import { cn } from "@/lib/utils"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  showCount?: boolean
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, showCount, maxLength, onChange, value, defaultValue, ...props }, ref) => {
    const [charCount, setCharCount] = React.useState<number>(() => {
      if (value !== undefined) return String(value).length
      if (defaultValue !== undefined) return String(defaultValue).length
      return 0
    })
    const [isFocused, setIsFocused] = React.useState(false)
    const reduce = useReducedMotion() ?? false

    React.useEffect(() => {
      if (value !== undefined) setCharCount(String(value).length)
    }, [value])

    const pct = maxLength && showCount ? charCount / maxLength : 0

    const limitBorder =
      showCount && maxLength
        ? pct >= 0.80
          ? "border-alert bg-alert-surface/40"
          : ""
        : ""

    const baseClasses = cn(
      "relative flex h-control w-full rounded-md border bg-paper px-4 py-2 text-body-sm font-medium file:border-0 file:bg-transparent file:text-body-sm file:font-medium",
      "border-line bg-paper/95",
      "placeholder:text-ink-subtle placeholder:font-normal",
      "shadow-none",
      "transition-colors duration-base ease-emphasized",
      "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-paper-sunken disabled:border-line",
      limitBorder,
      showCount && maxLength ? "pr-[4.5rem]" : "",
      className
    )

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(true)
      props.onFocus?.(e)
    }

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(false)
      props.onBlur?.(e)
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (showCount && maxLength) {
        setCharCount(e.target.value.length)
      }
      onChange?.(e)
    }

    const inputElement = (
      <>
        <input
          type={type}
          className={baseClasses}
          maxLength={maxLength}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          value={value}
          defaultValue={defaultValue}
          ref={ref}
          {...props}
        />
        {/* Animated focus border with gradient glow */}
        <motion.span
          className="pointer-events-none absolute inset-0 rounded-md"
          initial={false}
          animate={{
            opacity: isFocused && !reduce ? 1 : 0,
            scale: isFocused && !reduce ? 1 : 0.98,
          }}
          transition={{
            duration: DURATION_UI,
            ease: EASE_OUT_EXPO,
          }}
          aria-hidden="true"
          style={{
            background: "linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(147, 51, 234, 0.15) 100%)",
            boxShadow: "0 0 0 2px rgba(59, 130, 246, 0.25), 0 0 24px rgba(59, 130, 246, 0.15), 0 0 40px rgba(147, 51, 234, 0.08)",
          }}
        />
        {/* Inner glow ring */}
        <motion.span
          className="pointer-events-none absolute inset-0 rounded-md border-2"
          initial={false}
          animate={{
            opacity: isFocused && !reduce ? 1 : 0,
            borderColor: isFocused ? "rgba(59, 130, 246, 0.4)" : "rgba(59, 130, 246, 0)",
          }}
          transition={{
            duration: DURATION_UI,
            ease: EASE_OUT_EXPO,
          }}
          aria-hidden="true"
        />
      </>
    )

    if (!showCount || !maxLength) {
      return <div className="relative">{inputElement}</div>
    }

    return (
      <div className="relative">
        {inputElement}
        <span
          className={cn(
            "absolute right-3 top-1/2 z-10 -translate-y-1/2 text-caption font-semibold pointer-events-none tabular-nums select-none transition-colors duration-base",
            pct >= 0.80 ? "text-alert" : "text-ink-muted"
          )}
        >
          {charCount}/{maxLength}
        </span>
      </div>
    )
  }
)
Input.displayName = "Input"

export { Input }
