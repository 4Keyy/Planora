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
          ? "border-red-400 bg-red-50/40 hover:border-red-400 focus:border-red-500 focus:ring-red-100"
          : ""
        : ""

    const baseClasses = cn(
      "flex h-10 w-full rounded-xl border bg-white px-4 py-2 text-sm font-medium transition-all duration-200 ease-spring file:border-0 file:bg-transparent file:text-sm file:font-medium",
      "border-gray-200 bg-white/95",
      "hover:border-gray-300 hover:bg-white",
      "focus:outline-none focus:border-black focus:ring-4 focus:ring-black/10 focus:shadow-md focus:bg-white",
      "placeholder:text-gray-400 placeholder:font-normal",
      "shadow-input hover:shadow-sm",
      "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-gray-50 disabled:border-gray-100 disabled:hover:border-gray-100 disabled:hover:shadow-none",
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
            "absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold pointer-events-none tabular-nums select-none transition-colors duration-200",
            pct >= 0.80 ? "text-red-500" : "text-gray-400"
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
