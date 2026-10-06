"use client"

import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { cn } from "@/lib/utils"
import { useDismissHiddenAnchor } from "@/hooks/use-dismiss-hidden-anchor"

const TriggerContext = React.createContext<{
  triggerRef: React.MutableRefObject<HTMLButtonElement | null>
  skipCloseFocus: React.MutableRefObject<boolean>
} | null>(null)

function DropdownMenu({ open: controlledOpen, defaultOpen = false, onOpenChange, children, ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root>) {
  const [ownOpen, setOwnOpen] = React.useState(defaultOpen)
  const open = controlledOpen ?? ownOpen
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const skipCloseFocus = React.useRef(false)
  const context = React.useMemo(() => ({ triggerRef, skipCloseFocus }), [])
  const setOpen = React.useCallback((next: boolean) => {
    if (controlledOpen === undefined) setOwnOpen(next)
    onOpenChange?.(next)
  }, [controlledOpen, onOpenChange])
  React.useEffect(() => { if (open) skipCloseFocus.current = false }, [open])
  useDismissHiddenAnchor(open, triggerRef, () => {
    skipCloseFocus.current = true
    setOpen(false)
  })
  return (
    <TriggerContext.Provider value={context}>
      <DropdownMenuPrimitive.Root {...props} open={open} onOpenChange={setOpen}>
        {children}
      </DropdownMenuPrimitive.Root>
    </TriggerContext.Provider>
  )
}

const DropdownMenuTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>((props, forwardedRef) => {
  const context = React.useContext(TriggerContext)
  const ref = React.useCallback((node: HTMLButtonElement | null) => {
    if (context) context.triggerRef.current = node
    if (typeof forwardedRef === "function") forwardedRef(node)
    else if (forwardedRef) forwardedRef.current = node
  }, [context, forwardedRef])
  return <DropdownMenuPrimitive.Trigger {...props} ref={ref} />
})
DropdownMenuTrigger.displayName = DropdownMenuPrimitive.Trigger.displayName

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, align = "center", onCloseAutoFocus, ...props }, ref) => {
  const context = React.useContext(TriggerContext)
  return (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      align={align}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event)
        // Restoring focus to an off-screen field would scroll the page back to it.
        if (context?.skipCloseFocus.current) event.preventDefault()
      }}
      className={cn(
        "z-50 min-w-[12rem] overflow-hidden rounded-lg border border-line/60 bg-paper p-1.5 text-ink shadow-xl",
        // The product's one dropdown motion (globals.css): it unfolds out of its trigger from
        // the anchor Radix supplies, and folds back into it. Radix sets `data-state` and
        // `data-side`, and keeps the menu mounted until the fold's `animationend`.
        "dropdown-surface origin-[var(--radix-dropdown-menu-content-transform-origin)]",
        className
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
  )
})
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-body-sm transition-colors duration-base ease-emphasized focus:bg-accent-surface focus:text-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0 hover:bg-paper-sunken",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-gray-100", className)}
    {...props}
  />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
}
