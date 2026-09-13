import * as React from "react"
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
      "flex h-control w-full rounded-md border bg-paper px-4 py-2 text-body-sm font-medium transition-[color,background-color,border-color,opacity,transform,box-shadow] duration-base ease-emphasized file:border-0 file:bg-transparent file:text-body-sm file:font-medium",
      "border-line bg-paper/95",
      "hover:border-line-strong hover:bg-paper",
      "focus:outline-none focus:border-black focus:ring-4 focus:ring-black/10 focus:shadow-md focus:bg-paper",
      "placeholder:text-ink-subtle placeholder:font-normal",
      "shadow-none hover:shadow-sm",
      "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-paper-sunken disabled:border-line disabled:hover:border-line disabled:hover:shadow-none",
      limitBorder,
      showCount && maxLength ? "pr-[4.5rem]" : "",
      className
    )

    if (!showCount || !maxLength) {
      return (
        <input
          type={type}
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

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setCharCount(e.target.value.length)
      onChange?.(e)
    }

    return (
      <div className="relative">
        <input
          type={type}
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
            "absolute right-3 top-1/2 -translate-y-1/2 text-caption font-semibold pointer-events-none tabular-nums select-none transition-colors duration-base",
            pct >= 0.80 ? "text-alert" : "text-ink-subtle"
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
