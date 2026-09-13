import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // ===== BASE STYLES (unified across all variants) =====
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-[color,background-color,border-color,opacity,transform,box-shadow] duration-base ease-emphasized focus-visible:outline-none focus-visible:ring-4 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed relative overflow-hidden group",
  {
    variants: {
      variant: {
        default:
          "bg-ink text-paper shadow-md hover:bg-gray-900 hover:shadow-lg active:scale-[0.96] focus-visible:ring-black/30 hover:translate-y-[-2px] duration-base",

        secondary:
          "bg-gray-100 text-ink shadow-sm hover:bg-gray-200 hover:shadow-md active:scale-[0.96] focus-visible:ring-gray-400/30 hover:translate-y-[-1px]",

        outline:
          "border-2 border-line bg-paper text-ink hover:bg-paper-sunken hover:border-line-strong hover:shadow-sm active:scale-[0.96] focus-visible:ring-gray-300/30 transition-all",

        accent:
          "bg-gray-900 text-paper shadow-md hover:bg-ink hover:shadow-lg active:scale-[0.96] focus-visible:ring-black/30 hover:translate-y-[-2px]",

        ghost:
          "text-ink-muted hover:bg-gray-100 hover:text-ink active:scale-[0.96] focus-visible:ring-gray-300/30 transition-all",

        link:
          "text-ink underline-offset-4 hover:underline hover:opacity-80 active:opacity-70 focus-visible:ring-black/20 font-medium",

        destructive:
          "bg-alert text-paper shadow-md hover:bg-alert hover:shadow-lg active:scale-[0.96] focus-visible:ring-alert/30 hover:translate-y-[-2px]",
      },
      size: {
        sm: "h-9 rounded-md px-4 text-caption font-bold tracking-wide",
        default: "h-10 rounded-lg px-5 text-body-sm font-semibold",
        lg: "h-12 rounded-lg px-6 text-body font-bold",
        icon: "h-10 w-10 rounded-lg",
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
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
