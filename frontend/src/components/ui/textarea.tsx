import * as React from "react"
import { cn } from "@/lib/utils"

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  showCount?: boolean
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, showCount, maxLength, onChange, value, defaultValue, ...props }, ref) => {
    const [charCount, setCharCount] = React.useState<number>(() => {
      if (value !== undefined) return String(value).length
      if (defaultValue !== undefined) return String(defaultValue).length
      return 0
    })

    React.useEffect(() => {
      if (value !== undefined) setCharCount(String(value).length)
    }, [value])

    const pct = maxLength && showCount ? charCount / maxLength : 0

    const limitBorder =
      showCount && maxLength
        ? pct >= 0.80
          ? "border-alert bg-alert-surface/40 hover:border-alert focus:border-alert focus:ring-alert-surface"
          : ""
        : ""

    const baseClasses = cn(
      "flex min-h-[120px] w-full rounded-lg border bg-paper px-4 py-3 text-body-sm leading-relaxed font-medium transition-all duration-base ease-emphasized resize-none",
      "border-line bg-paper/95",
      "hover:border-line-strong hover:bg-paper",
      "focus:outline-none focus:border-black focus:ring-4 focus:ring-black/10 focus:shadow-md focus:bg-paper",
      "placeholder:text-ink-subtle placeholder:font-normal",
      "shadow-none hover:shadow-sm",
      "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-paper-sunken disabled:border-line disabled:hover:border-line disabled:hover:shadow-none",
      limitBorder,
      showCount && maxLength ? "pb-7" : "",
      className
    )

    if (!showCount || !maxLength) {
      return (
        <textarea
          className={baseClasses}
          maxLength={maxLength}
          onChange={onChange}
          value={value}
          defaultValue={defaultValue}
          ref={ref}
          {...props}
        />
      )
    }

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setCharCount(e.target.value.length)
      onChange?.(e)
    }

    return (
      <div className="relative">
        <textarea
          className={baseClasses}
          maxLength={maxLength}
          onChange={handleChange}
          value={value}
          defaultValue={defaultValue}
          ref={ref}
          {...props}
        />
        <span
          className={cn(
            "absolute right-3 bottom-2.5 text-caption font-semibold pointer-events-none tabular-nums select-none transition-colors duration-base",
            pct >= 0.80 ? "text-alert" : "text-ink-subtle"
          )}
        >
          {charCount}/{maxLength}
        </span>
      </div>
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
