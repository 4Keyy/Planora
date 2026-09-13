import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // ===== BASE STYLES (unified across all variants) =====
  "touch-target inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-[color,background-color,border-color,opacity,transform,box-shadow] duration-base ease-emphasized focus-visible:outline-none focus-visible:ring-4 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed relative overflow-hidden group",
  {
    variants: {
      variant: {
        default:
          "bg-ink text-paper shadow-md hover:bg-gray-900 hover:shadow-lg active:scale-[0.96] focus-visible:ring-black/30 hover:translate-y-[-2px] duration-base",

        secondary:
          "bg-gray-100 text-ink shadow-sm hover:bg-gray-200 hover:shadow-md active:scale-[0.96] focus-visible:ring-gray-400/30 hover:translate-y-[-1px]",

        outline:
          "border-2 border-line bg-paper text-ink hover:bg-paper-sunken hover:border-line-strong hover:shadow-sm active:scale-[0.96] focus-visible:ring-gray-300/30 transition-[color,background-color,border-color,opacity,transform,box-shadow]",

        accent:
          "bg-gray-900 text-paper shadow-md hover:bg-ink hover:shadow-lg active:scale-[0.96] focus-visible:ring-black/30 hover:translate-y-[-2px]",

        ghost:
          "text-ink-muted hover:bg-gray-100 hover:text-ink active:scale-[0.96] focus-visible:ring-gray-300/30 transition-[color,background-color,border-color,opacity,transform,box-shadow]",

        link:
          "text-ink underline-offset-4 hover:underline hover:opacity-80 active:opacity-70 focus-visible:ring-black/20 font-medium",

        destructive:
          "bg-alert text-paper shadow-md hover:bg-alert hover:shadow-lg active:scale-[0.96] focus-visible:ring-alert/30 hover:translate-y-[-2px]",
      },
      size: {
        sm: "h-control-sm rounded-md px-4 text-caption font-semibold tracking-wide",
        default: "h-control rounded-md px-5 text-body-sm font-semibold",
        lg: "h-control-lg rounded-md px-6 text-body font-semibold",
        icon: "h-control w-control rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /**
   * An action is in flight. Blocks the button, announces the state, and swaps
   * the label for a spinner WITHOUT changing the button's width, so the layout
   * around it does not jump.
   *
   * Ten places in this product fired a delete or a save with no guard at all —
   * including "delete account" — so a second click sent a second request.
   */
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"

    // `asChild` renders someone else's element (usually a Link); a spinner and a
    // disabled attribute would be meaningless or actively wrong there.
    if (asChild) {
      return (
        <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props}>
          {children}
        </Comp>
      )
    }

    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && (
          <Loader2
            className="absolute h-4 w-4 animate-spin"
            aria-hidden="true"
            data-testid="button-spinner"
          />
        )}
        {/* The label keeps its box so the button never resizes mid-action. */}
        <span className={cn("inline-flex items-center gap-2", loading && "invisible")}>
          {children}
        </span>
      </button>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
