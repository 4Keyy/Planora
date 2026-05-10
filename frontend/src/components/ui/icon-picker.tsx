"use client"

import { useState } from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"
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

const iconList = [
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
]

interface IconPickerProps {
  selectedIcon: string | null
  onIconSelect: (icon: string) => void
}

export function IconPicker({ selectedIcon, onIconSelect }: IconPickerProps) {
  const [isOpen, setIsOpen] = useState(false)

  const SelectedIconComponent =
    iconList.find((i) => i.name === selectedIcon)?.icon || Tag

  return (
    <PopoverPrimitive.Root open={isOpen} onOpenChange={setIsOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-3 w-full h-10 px-4 rounded-xl bg-gray-50 hover:bg-gray-100 transition-all active:scale-95 group"
        >
          <SelectedIconComponent className="h-4 w-4 text-black group-hover:text-black transition-colors" />
          <span className="text-xs font-black uppercase tracking-tighter text-gray-400 group-hover:text-gray-900 truncate">
            {selectedIcon || "Icon"}
          </span>
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <AnimatePresence>
          {isOpen && (
            <PopoverPrimitive.Content
              forceMount
              asChild
              align="center"
              sideOffset={8}
              collisionPadding={12}
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -6 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="z-[5000] w-[min(320px,calc(100vw-24px))] rounded-3xl border border-gray-100 bg-white p-4 shadow-[0_20px_50px_rgba(0,0,0,0.15)] outline-none"
              >
                <div className="grid max-h-[min(328px,calc(100vh-96px))] grid-cols-5 gap-2 overflow-y-auto p-4 custom-scrollbar">
                {iconList.map((item) => {
                  const IconComponent = item.icon
                  const isSelected = selectedIcon === item.name
                  return (
                    <motion.button
                      key={item.name}
                      type="button"
                      whileHover={{ scale: 1.1, backgroundColor: "#f3f4f6" }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => {
                        onIconSelect(item.name)
                        setIsOpen(false)
                      }}
                      className={cn(
                        "h-10 w-10 flex items-center justify-center rounded-2xl transition-all",
                        isSelected
                          ? "bg-black text-white shadow-xl shadow-black/20"
                          : "text-black hover:text-black hover:bg-gray-100"
                      )}
                    >
                      <IconComponent className="h-4 w-4" />
                    </motion.button>
                  )
                })}
                </div>
              </motion.div>
            </PopoverPrimitive.Content>
          )}
        </AnimatePresence>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
