import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // ===== BASE STYLES (unified across all variants) =====
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-[color,background-color,border-color,opacity,transform,box-shadow] duration-200 ease-spring focus-visible:outline-none focus-visible:ring-4 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed relative overflow-hidden group",
  {
    variants: {
      variant: {
        default:
          "bg-black text-white shadow-md hover:bg-gray-900 hover:shadow-lg active:scale-[0.96] focus-visible:ring-black/30 hover:translate-y-[-2px] duration-200",

        secondary:
          "bg-gray-100 text-gray-900 shadow-sm hover:bg-gray-200 hover:shadow-md active:scale-[0.96] focus-visible:ring-gray-400/30 hover:translate-y-[-1px]",

        outline:
          "border-2 border-gray-200 bg-white text-gray-900 hover:bg-gray-50 hover:border-gray-300 hover:shadow-sm active:scale-[0.96] focus-visible:ring-gray-300/30 transition-all",

        accent:
          "bg-gray-900 text-white shadow-md hover:bg-black hover:shadow-lg active:scale-[0.96] focus-visible:ring-black/30 hover:translate-y-[-2px]",

        ghost:
          "text-gray-700 hover:bg-gray-100 hover:text-gray-900 active:scale-[0.96] focus-visible:ring-gray-300/30 transition-all",

        link:
          "text-black underline-offset-4 hover:underline hover:opacity-80 active:opacity-70 focus-visible:ring-black/20 font-medium",

        destructive:
          "bg-red-600 text-white shadow-md hover:bg-red-700 hover:shadow-lg active:scale-[0.96] focus-visible:ring-red-600/30 hover:translate-y-[-2px]",
      },
      size: {
        sm: "h-9 rounded-lg px-4 text-xs font-bold tracking-wide",
        default: "h-10 rounded-xl px-5 text-sm font-semibold",
        lg: "h-12 rounded-xl px-6 text-base font-bold",
        icon: "h-10 w-10 rounded-xl",
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
