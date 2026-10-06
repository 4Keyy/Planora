"use client"

import { useRef, useState } from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import { TAP_PRESS } from "@/lib/animations"
import { POPOVER_SURFACE } from "@/components/ui/surfaces"
import { useDismissHiddenAnchor } from "@/hooks/use-dismiss-hidden-anchor"
import {
  CheckCircle2,
  Clock,
  Target,
  Briefcase,
  Home,
  ShoppingCart,
  Heart,
  Star,
  Zap,
  Coffee,
  Book,
  Code,
  Music,
  Camera,
  Palette,
  Dumbbell,
  Plane,
  Car,
  Bike,
  Gamepad2,
  Shirt,
  Pizza,
  Gift,
  Flag,
  Trophy,
  Award,
  Settings,
  Users,
  Mail,
  Phone,
  Calendar,
  FileText,
  Folder,
  Tag,
  Bookmark,
  Archive,
  Lightbulb,
  Sparkles,
  CircleDot,
  Square,
  Circle,
  Triangle,
  Hexagon,
} from "lucide-react"

export const ICON_PICKER_ITEMS = [
  { name: "CheckCircle2", icon: CheckCircle2 },
  { name: "Clock", icon: Clock },
  { name: "Target", icon: Target },
  { name: "Briefcase", icon: Briefcase },
  { name: "Home", icon: Home },
  { name: "ShoppingCart", icon: ShoppingCart },
  { name: "Heart", icon: Heart },
  { name: "Star", icon: Star },
  { name: "Zap", icon: Zap },
  { name: "Coffee", icon: Coffee },
  { name: "Book", icon: Book },
  { name: "Code", icon: Code },
  { name: "Music", icon: Music },
  { name: "Camera", icon: Camera },
  { name: "Palette", icon: Palette },
  { name: "Dumbbell", icon: Dumbbell },
  { name: "Plane", icon: Plane },
  { name: "Car", icon: Car },
  { name: "Bike", icon: Bike },
  { name: "Gamepad2", icon: Gamepad2 },
  { name: "Shirt", icon: Shirt },
  { name: "Pizza", icon: Pizza },
  { name: "Gift", icon: Gift },
  { name: "Flag", icon: Flag },
  { name: "Trophy", icon: Trophy },
  { name: "Award", icon: Award },
  { name: "Settings", icon: Settings },
  { name: "Users", icon: Users },
  { name: "Mail", icon: Mail },
  { name: "Phone", icon: Phone },
  { name: "Calendar", icon: Calendar },
  { name: "FileText", icon: FileText },
  { name: "Folder", icon: Folder },
  { name: "Tag", icon: Tag },
  { name: "Bookmark", icon: Bookmark },
  { name: "Archive", icon: Archive },
  { name: "Lightbulb", icon: Lightbulb },
  { name: "Sparkles", icon: Sparkles },
  { name: "CircleDot", icon: CircleDot },
  { name: "Square", icon: Square },
  { name: "Circle", icon: Circle },
  { name: "Triangle", icon: Triangle },
  { name: "Hexagon", icon: Hexagon },
] as const

interface IconPickerProps {
  selectedIcon: string | null
  onIconSelect: (icon: string) => void
}

/**
 * "CheckCircle2" → "Check circle 2". The stored value is a lucide component name; a person
 * reads a label, and a screen reader needs one for each of the forty-odd icon-only buttons.
 */
function iconLabel(name: string): string {
  const words = name.replace(/([a-z])([A-Z0-9])/g, "$1 $2").toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function IconPicker({ selectedIcon, onIconSelect }: IconPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const skipCloseFocus = useRef(false)
  useDismissHiddenAnchor(isOpen, triggerRef, () => {
    skipCloseFocus.current = true
    setIsOpen(false)
  })

  const SelectedIconComponent =
    ICON_PICKER_ITEMS.find((i) => i.name === selectedIcon)?.icon || Tag

  return (
    <PopoverPrimitive.Root open={isOpen} onOpenChange={(next) => {
      if (next) skipCloseFocus.current = false
      setIsOpen(next)
    }}>
      <PopoverPrimitive.Trigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className="group flex h-control w-full items-center gap-3 rounded-md bg-paper-sunken px-4 transition-[color,background-color,transform] duration-fast hover:bg-gray-100 active:scale-95"
        >
          <SelectedIconComponent className="h-4 w-4 text-ink" aria-hidden="true" />
          <span className="truncate text-body-sm font-semibold text-ink-muted transition-colors duration-fast group-hover:text-ink">
            {selectedIcon ? iconLabel(selectedIcon) : "Icon"}
          </span>
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        {/* Radix keeps the content mounted until the fold's `animationend`; the motion is the
            product's shared dropdown motion (globals.css), unfolding from the anchor Radix supplies. */}
        <PopoverPrimitive.Content
          align="center"
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => { if (skipCloseFocus.current) e.preventDefault() }}
          className={cn(
            POPOVER_SURFACE,
            "dropdown-surface z-popover w-[min(320px,calc(100vw-24px))] origin-[var(--radix-popover-content-transform-origin)] outline-none",
          )}
        >
          <div className="custom-scrollbar grid max-h-[min(328px,calc(100vh-96px))] grid-cols-5 justify-items-center gap-2 overflow-y-auto p-4">
          {ICON_PICKER_ITEMS.map((item) => {
            const IconComponent = item.icon
            const isSelected = selectedIcon === item.name
            return (
              /* Colour on hover is CSS; the press is the one transform, and it is
                 framer's alone — a CSS `transition` on `transform` would re-ease
                 every frame framer writes. It used to grow 10% on hover, in
                 framer-motion, and paint its background through the same spring. */
              <motion.button
                key={item.name}
                type="button"
                whileTap={TAP_PRESS}
                aria-label={iconLabel(item.name)}
                aria-pressed={isSelected}
                onClick={() => {
                  onIconSelect(item.name)
                  setIsOpen(false)
                }}
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-md transition-colors duration-fast",
                  isSelected ? "bg-ink text-paper shadow-sm" : "text-ink hover:bg-gray-100"
                )}
              >
                <IconComponent className="h-4 w-4" aria-hidden="true" />
              </motion.button>
            )
          })}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
