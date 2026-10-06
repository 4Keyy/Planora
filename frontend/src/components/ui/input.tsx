import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  showCount?: boolean
}

/**
 * The boxed text field.
 *
 * Its focus state is not declared here: `field-box` hands it to globals.css ("Field focus"),
 * which draws an ink edge and a soft halo on the field's own radius. A text field matches
 * :focus-visible on every focus, click included, so the global ring would box it on every
 * click — and a per-component ring is how eight sub-3:1 indicators once shipped.
 *
 * No wrapper unless there is a counter to position: the <input> itself must be the flex or
 * grid item, or `w-full` resolves against a shrink-wrapped div (the profile page's
 * password-plus-button rows collapsed to their intrinsic width that way). And no focus state
 * kept in React: a caller's own `onFocus`/`onBlur` (react-hook-form's `register`) used to
 * replace the component's, and the highlight then stayed on after the field was left.
 */
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

    const counted = Boolean(showCount && maxLength)
    const pct = counted && maxLength ? charCount / maxLength : 0
    const overLimit = counted && pct >= 0.8

    const baseClasses = cn(
      "field-box flex h-control w-full rounded-md border bg-paper px-4 py-2 text-body-sm font-medium transition-[color,background-color,border-color,opacity,transform,box-shadow] duration-base ease-emphasized file:border-0 file:bg-transparent file:text-body-sm file:font-medium",
      "border-line bg-paper/95",
      "hover:border-line-strong hover:bg-paper",
      "placeholder:text-ink-subtle placeholder:font-normal",
      "shadow-none hover:shadow-sm",
      "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-paper-sunken disabled:border-line disabled:hover:border-line disabled:hover:shadow-none",
      overLimit && "border-alert bg-alert-surface/40 hover:border-alert hover:bg-alert-surface/40",
      counted && "pr-[4.5rem]",
      className
    )

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (counted) setCharCount(e.target.value.length)
      onChange?.(e)
    }

    const input = (
      <input
        type={type}
        className={baseClasses}
        maxLength={maxLength}
        onChange={handleChange}
        value={value}
        defaultValue={defaultValue}
        data-over-limit={overLimit || undefined}
        ref={ref}
        {...props}
      />
    )

    if (!counted) return input

    return (
      <div className="relative">
        {input}
        <span
          className={cn(
            "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 select-none text-caption font-semibold tabular-nums transition-colors duration-base",
            overLimit ? "text-alert" : "text-ink-muted"
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
