"use client"

import { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import {
  AlignLeft,
  Calendar,
  ChevronRight,
  FileText,
  Folder,
  Plus,
  Sparkles,
  Users,
  X,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Category } from "@/types/category"
import type { CreateTodoPayload } from "@/types/todo"
import { IconPicker } from "@/components/ui/icon-picker"
import { ICON_MAP } from "@/lib/icon-map"
import { api, parseApiResponse, type ApiResponse } from "@/lib/api"
import { FriendMultiSelect } from "@/components/todos/friend-multi-select"
import { useFriends } from "@/hooks/use-friends"
import { cn } from "@/lib/utils"
import { TWEEN_FAST, SPRING_RESPONSIVE, EASE_OUT, EASE_OUT_EXPO } from "@/lib/animations"

interface CreateTodoPanelProps {
  isOpen: boolean
  onToggle: () => void
  categories: Category[]
  onSubmit: (payload: CreateTodoPayload) => Promise<void>
  onCreateCategory: () => Promise<void>
  onDeleteCategory: (id: string) => Promise<void>
  shortcutHint?: string
}

const priorityOptions = [
  { value: "VeryLow", label: "Very Low", short: "1", num: 1 },
  { value: "Low", label: "Low", short: "2", num: 2 },
  { value: "Medium", label: "Medium", short: "3", num: 3 },
  { value: "High", label: "High", short: "4", num: 4 },
  { value: "Urgent", label: "Urgent", short: "5", num: 5 },
]

const quickDueOptions = [
  { label: "Today", days: 0 },
  { label: "Tomorrow", days: 1 },
  { label: "Next week", days: 7 },
]

const TITLE_MAX_LENGTH = 200
const DESCRIPTION_MAX_LENGTH = 5000
const CATEGORY_NAME_MAX_LENGTH = 50
const LIMIT_WARNING_RATIO = 0.8
const PANEL_LAYOUT_TRANSITION = { duration: 0.4, ease: EASE_OUT } as const
const PANEL_FADE_TRANSITION = { duration: 0.18, ease: EASE_OUT_EXPO } as const
const PANEL_CONTENT_TRANSITION = { duration: 0.26, ease: EASE_OUT_EXPO } as const

const getPriorityNumber = (p: string): number => {
  const match = priorityOptions.find(o => o.value === p)
  return match?.num ?? 3
}

const toDateInputValue = (date: Date) => {
  const offset = date.getTimezoneOffset()
  const local = new Date(date.getTime() - offset * 60_000)
  return local.toISOString().slice(0, 10)
}

const quickDueValue = (days: number) => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toDateInputValue(date)
}

function SectionLabel({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-gray-400" strokeWidth={2.4} />
      <span className="text-[11px] font-black uppercase tracking-[0.14em] text-gray-500">
        {children}
      </span>
    </div>
  )
}

function PanelBlock({
  icon,
  title,
  meta,
  children,
  className,
}: {
  icon: LucideIcon
  title: string
  meta?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("rounded-2xl border border-gray-200/70 bg-white p-3.5 shadow-sm transition-[background-color,border-color,box-shadow] duration-300", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionLabel icon={icon}>{title}</SectionLabel>
        {meta}
      </div>
      {children}
    </div>
  )
}

function LimitCounter({ value, max }: { value: number; max: number }) {
  const isNearLimit = value >= max * LIMIT_WARNING_RATIO

  return (
    <span
      className={cn(
        "text-[11px] font-black tabular-nums transition-colors duration-300",
        isNearLimit ? "text-red-500" : "text-gray-400"
      )}
    >
      {value}/{max}
    </span>
  )
}

const limitPanelClass = (active: boolean) =>
  active ? "border-red-200 bg-red-50/55 shadow-red-100/60" : undefined

const limitInputClass = (active: boolean) =>
  active
    ? "border-red-300 bg-red-50/40 text-red-950 placeholder:text-red-300 hover:border-red-400 focus:border-red-500 focus:ring-red-100"
    : undefined

export function CreateTodoPanel({
  isOpen,
  onToggle,
  categories,
  onSubmit,
  onCreateCategory,
  onDeleteCategory,
}: CreateTodoPanelProps) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState("Medium")
  const [dueDate, setDueDate] = useState("")
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined)
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [isPublic, setIsPublic] = useState(false)
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([])

  const prefersReducedMotion = useReducedMotion()
  const friends = useFriends(isOpen)
  const titleRef = useRef<HTMLInputElement>(null)

  const [newCatName, setNewCatName] = useState("")
  const [newCatColor, setNewCatColor] = useState("#6366f1")
  const [newCatIcon, setNewCatIcon] = useState<string | null>(null)
  const titleNearLimit = title.length >= TITLE_MAX_LENGTH * LIMIT_WARNING_RATIO
  const descriptionNearLimit = description.length >= DESCRIPTION_MAX_LENGTH * LIMIT_WARNING_RATIO
  const categoryNameNearLimit = newCatName.length >= CATEGORY_NAME_MAX_LENGTH * LIMIT_WARNING_RATIO

  const resetForm = () => {
    setTitle("")
    setDescription("")
    setPriority("Medium")
    setDueDate("")
    setCategoryId(undefined)
    setFormError(null)
    setIsPublic(false)
    setSelectedFriendIds([])
    setNewCatName("")
    setNewCatColor("#6366f1")
    setNewCatIcon(null)
  }

  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => titleRef.current?.focus(), 220)
      return () => clearTimeout(t)
    }
  }, [isOpen])

  const handleSubmit = async () => {
    if (!title.trim()) {
      setFormError("Title is required")
      titleRef.current?.focus()
      return
    }
    setFormError(null)
    setCreating(true)

    try {
      let finalCategoryId = categoryId && categoryId !== "__new" && categoryId !== "__none" ? categoryId : undefined

      if (categoryId === "__new" && newCatName.trim()) {
        try {
          const catRes = await api.post<ApiResponse<Category>>("/categories/api/v1/categories", {
            name: newCatName.trim(),
            color: newCatColor,
            icon: newCatIcon,
            displayOrder: 0,
          })
          finalCategoryId = parseApiResponse<Category>(catRes.data).id
          await onCreateCategory()
        } catch {
          // Category creation failed; create the task without category.
        }
      }

      await onSubmit({
        userId: null,
        title: title.trim(),
        description: description.trim() || null,
        categoryId: finalCategoryId || null,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        priority: getPriorityNumber(priority),
        isPublic,
        sharedWithUserIds: selectedFriendIds,
        tags: [],
      })

      resetForm()
    } catch {
      setFormError("Failed to create task. Please try again.")
    } finally {
      setCreating(false)
    }
  }

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key === "Enter") {
        e.preventDefault()
        handleSubmit()
      } else if (e.key === "Escape" && !creating) {
        e.preventDefault()
        onToggle()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, title, description, priority, dueDate, categoryId, isPublic, selectedFriendIds, newCatName, newCatColor, newCatIcon, creating])

  const fadeTransition = prefersReducedMotion
    ? { duration: 0.01, ease: EASE_OUT_EXPO }
    : PANEL_FADE_TRANSITION
  const contentTransition = prefersReducedMotion
    ? { duration: 0.01, ease: EASE_OUT_EXPO }
    : PANEL_CONTENT_TRANSITION
  const fieldMotion = (delay = 0) => ({
    initial: { opacity: 0, y: prefersReducedMotion ? 0 : 8, scale: prefersReducedMotion ? 1 : 0.99 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: {
      duration: prefersReducedMotion ? 0.01 : 0.25,
      delay: prefersReducedMotion ? 0 : delay,
      ease: EASE_OUT_EXPO,
    },
  })

  // CSS timing for the grid-row height transition
  const rowTransition = prefersReducedMotion
    ? "grid-template-rows 0.01s linear"
    : "grid-template-rows 0.38s cubic-bezier(0.34, 1.2, 0.64, 1)"
  const contentOpacityTransition = prefersReducedMotion
    ? "opacity 0.01s linear"
    : `opacity ${isOpen ? "0.18s 0.12s" : "0.10s 0s"} cubic-bezier(0.16,1,0.3,1)`

  return (
    <div className="overflow-hidden rounded-3xl border border-gray-200/80 bg-white shadow-[0_18px_60px_-28px_rgba(15,23,42,0.35)]">
      {/*
        Always-visible header — clicking opens/closes the panel.
        The + button is ONE persistent element that rotates 0° ↔ 45°,
        so the animation plays correctly in both directions.
      */}
      <button
        type="button"
        onClick={onToggle}
        className="group flex w-full items-center justify-between gap-4 p-4 text-left transition-colors duration-200 hover:bg-gray-50/60 sm:p-5"
        aria-label={isOpen ? "Close create task panel" : "Open create task panel"}
        aria-expanded={isOpen}
      >
        <div className="flex min-w-0 items-center gap-3.5">
          {/* The single + icon that rotates between open/closed — never unmounts */}
          <motion.div
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.94 }}
            transition={SPRING_RESPONSIVE}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-gray-950 text-white shadow-md shadow-black/15"
          >
            <motion.span
              aria-hidden
              animate={{ rotate: isOpen ? 45 : 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 24 }}
              className="flex"
            >
              <Plus className="h-5 w-5" strokeWidth={2.5} />
            </motion.span>
          </motion.div>

          {/* Title area swaps between two states */}
          <div className="min-w-0">
            <AnimatePresence mode="wait" initial={false}>
              {!isOpen ? (
                <motion.div
                  key="closed-title"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.14, ease: EASE_OUT_EXPO }}
                >
                  <h3 className="text-sm font-black tracking-tight text-gray-950">New task</h3>
                  <p className="truncate text-[11px] font-semibold text-gray-400">press <kbd className="rounded bg-gray-100 px-1 py-px font-mono text-[10px] text-gray-500">C</kbd> to open</p>
                </motion.div>
              ) : (
                <motion.div
                  key="open-title"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.14, ease: EASE_OUT_EXPO }}
                >
                  <p className="text-sm font-black leading-none tracking-tight text-gray-950">New task</p>
                  <p className="mt-0.5 text-[11px] font-semibold text-gray-400">Ready for the list</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Chevron — fades out when open */}
        <motion.div
          animate={{ opacity: isOpen ? 0 : 1, x: isOpen ? 4 : 0 }}
          transition={{ duration: 0.16, ease: EASE_OUT_EXPO }}
          className="flex flex-shrink-0 items-center"
        >
          <ChevronRight className="h-4 w-4 text-gray-300 transition-colors group-hover:text-gray-700" />
        </motion.div>
      </button>

      {/*
        Content area — CSS grid-template-rows trick for smooth height animation.
        aria-hidden when collapsed prevents screen-reader traversal of the
        visually-hidden form, and makes queryByPlaceholderText return null when closed.
      */}
      <div
        aria-hidden={!isOpen}
        style={{
          display: "grid",
          gridTemplateRows: isOpen ? "1fr" : "0fr",
          transition: rowTransition,
        }}
      >
        <div className="overflow-hidden min-h-0">
          <div
            style={{ opacity: isOpen ? 1 : 0, transition: contentOpacityTransition }}
          >
            {/* Separator between header and form */}
            <div className="h-px bg-gray-100 mx-4" />

            <div className="space-y-4 p-4 sm:p-5">
              <motion.div
                {...fieldMotion(0.06)}
              >
                <PanelBlock
                  icon={FileText}
                  title="Title"
                  meta={<LimitCounter value={title.length} max={TITLE_MAX_LENGTH} />}
                  className={limitPanelClass(titleNearLimit)}
                >
                  <Input
                    ref={titleRef}
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="What needs to be done?"
                    maxLength={TITLE_MAX_LENGTH}
                    className={cn(
                      "h-12 rounded-xl border-gray-200 bg-white px-4 text-base font-black tracking-tight shadow-sm placeholder:font-semibold",
                      limitInputClass(titleNearLimit)
                    )}
                  />
                </PanelBlock>
              </motion.div>

              <motion.div
                {...fieldMotion(0.08)}
              >
                <PanelBlock
                  icon={AlignLeft}
                  title="Description"
                  meta={<LimitCounter value={description.length} max={DESCRIPTION_MAX_LENGTH} />}
                  className={limitPanelClass(descriptionNearLimit)}
                >
                  <Textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Add details, context, or acceptance criteria..."
                    rows={3}
                    maxLength={DESCRIPTION_MAX_LENGTH}
                    className={cn(
                      "min-h-[84px] rounded-xl border-gray-200 bg-white p-4 text-sm shadow-sm",
                      limitInputClass(descriptionNearLimit)
                    )}
                  />
                </PanelBlock>
              </motion.div>

              <motion.div
                {...fieldMotion(0.1)}
              >
                <PanelBlock icon={Sparkles} title="Priority">
                  <div className="grid grid-cols-5 gap-1 rounded-2xl border border-gray-100 bg-gray-50 p-1">
                    {priorityOptions.map(p => {
                      const active = priority === p.value
                      const urgent = p.value === "Urgent"
                      return (
                        <motion.button
                          key={p.value}
                          type="button"
                          onClick={() => setPriority(p.value)}
                          aria-pressed={active}
                          whileTap={{ scale: 0.97 }}
                          className={cn(
                            "group relative isolate flex min-h-[58px] flex-col items-center justify-center gap-1 overflow-hidden rounded-xl text-center transition-colors duration-300",
                            active
                              ? urgent
                                ? "text-red-600"
                                : "text-white"
                              : "text-gray-500 hover:text-gray-950"
                          )}
                        >
                          {active && (
                            <motion.span
                              layoutId="create-priority-active"
                              className={cn(
                                "absolute inset-0 rounded-xl shadow-sm",
                                urgent ? "bg-white ring-1 ring-inset ring-red-200" : "bg-gray-950"
                              )}
                              transition={SPRING_RESPONSIVE}
                            />
                          )}
                          <span className={cn(
                            "relative z-10 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black transition-colors duration-300",
                            active
                              ? urgent
                                ? "bg-red-50 text-red-600"
                                : "bg-white text-gray-950"
                              : "bg-white text-gray-500 group-hover:bg-gray-100 group-hover:text-gray-800"
                          )}>
                            {p.short}
                          </span>
                          <span className="relative z-10 text-[10px] font-black uppercase">{p.label}</span>
                        </motion.button>
                      )
                    })}
                  </div>
                </PanelBlock>
              </motion.div>

              <motion.div
                {...fieldMotion(0.12)}
              >
                <PanelBlock icon={Folder} title="Category">
                  <Select
                    value={categoryId || "__none"}
                    onValueChange={val => setCategoryId(val === "__none" ? undefined : val)}
                  >
                    <SelectTrigger className="h-11 rounded-xl border-gray-200 bg-white shadow-sm focus:ring-4 focus:ring-black/10">
                      <SelectValue placeholder="Select Category" />
                    </SelectTrigger>
                    <SelectContent className="z-[3000] rounded-2xl border-gray-100 p-2 shadow-2xl">
                      <SelectItem value="__none" className="rounded-xl text-xs font-bold text-gray-500">
                        No Category
                      </SelectItem>
                      {categories.map(cat => {
                        const CatIcon = cat.icon ? (ICON_MAP[cat.icon] ?? null) : null
                        return (
                          <SelectItem key={cat.id} value={cat.id} className="group rounded-xl">
                            <div className="flex w-full items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <span
                                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-100 bg-gray-50"
                                  style={{ color: cat.color ?? undefined }}
                                >
                                  {CatIcon ? <CatIcon className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
                                </span>
                                <span className="truncate text-sm font-bold">{cat.name}</span>
                              </div>
                              <button
                                type="button"
                                onClick={e => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  onDeleteCategory(cat.id)
                                }}
                                className="ml-2 rounded-lg p-1 text-gray-300 opacity-0 transition-[opacity,color,background-color] hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                                aria-label={`Delete ${cat.name}`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          </SelectItem>
                        )
                      })}
                      <SelectItem value="__new" className="rounded-xl font-black text-gray-950">
                        + Create Category
                      </SelectItem>
                    </SelectContent>
                  </Select>

                  <AnimatePresence>
                    {categoryId === "__new" && (
                      <motion.div
                        initial={{ opacity: 0, height: 0, marginTop: 0 }}
                        animate={{ opacity: 1, height: "auto", marginTop: 10 }}
                        exit={{ opacity: 0, height: 0, marginTop: 0 }}
                        transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
                        className="overflow-hidden"
                      >
                        <div
                          className={cn(
                            "rounded-2xl border border-dashed border-gray-200 bg-gray-50/80 p-3 transition-[background-color,border-color] duration-300",
                            limitPanelClass(categoryNameNearLimit)
                          )}
                        >
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <span className="text-[10px] font-black uppercase tracking-[0.12em] text-gray-400">
                              New category
                            </span>
                            <LimitCounter value={newCatName.length} max={CATEGORY_NAME_MAX_LENGTH} />
                          </div>
                          <Input
                            value={newCatName}
                            onChange={e => setNewCatName(e.target.value)}
                            placeholder="Category name *"
                            maxLength={CATEGORY_NAME_MAX_LENGTH}
                            className={cn("h-9 rounded-lg text-sm", limitInputClass(categoryNameNearLimit))}
                          />
                          <div className="mt-2 grid grid-cols-[1fr_52px] gap-2">
                            <IconPicker selectedIcon={newCatIcon} onIconSelect={setNewCatIcon} />
                            <Input
                              type="color"
                              value={newCatColor}
                              onChange={e => setNewCatColor(e.target.value)}
                              aria-label="Category color"
                              className="h-9 cursor-pointer rounded-lg border-gray-200 bg-white p-1"
                            />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </PanelBlock>
              </motion.div>

              <motion.div
                {...fieldMotion(0.14)}
              >
                <PanelBlock icon={Calendar} title="Due date">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_280px]">
                    <Input
                      type="date"
                      value={dueDate}
                      onChange={e => setDueDate(e.target.value)}
                      className="h-11 rounded-xl border-gray-200 bg-white text-xs font-bold uppercase shadow-sm"
                    />
                    <div className="grid grid-cols-3 gap-1 rounded-2xl border border-gray-100 bg-gray-50 p-1">
                      {quickDueOptions.map(option => {
                        const value = quickDueValue(option.days)
                        const active = dueDate === value
                        return (
                          <motion.button
                            key={option.label}
                            type="button"
                            onClick={() => setDueDate(value)}
                            whileTap={{ scale: 0.97 }}
                            className={cn(
                              "relative min-h-9 overflow-hidden rounded-xl px-2 text-[10px] font-black uppercase transition-colors duration-300",
                              active ? "text-white" : "text-gray-500 hover:text-gray-950"
                            )}
                          >
                            {active && (
                              <motion.span
                                layoutId="create-due-active"
                                className="absolute inset-0 rounded-xl bg-gray-950 shadow-sm"
                                transition={SPRING_RESPONSIVE}
                              />
                            )}
                            <span className="relative z-10">{option.label}</span>
                          </motion.button>
                        )
                      })}
                    </div>
                  </div>
                </PanelBlock>
              </motion.div>

              <motion.div
                {...fieldMotion(0.16)}
              >
                <PanelBlock icon={Users} title="Share With" className="bg-gradient-to-b from-white to-gray-50/70">
                  <FriendMultiSelect
                    friends={friends}
                    selectedIds={selectedFriendIds}
                    onChange={setSelectedFriendIds}
                    publicSelected={isPublic}
                    onPublicChange={setIsPublic}
                    placeholder="Private task"
                    contentClassName="z-[3000]"
                  />
                </PanelBlock>
              </motion.div>

              <AnimatePresence>
                {formError && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={TWEEN_FAST}
                    className="rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-center text-[11px] font-bold text-red-600"
                  >
                    {formError}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="flex flex-col gap-3 border-t border-gray-100 bg-gray-50/80 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="flex gap-2 sm:ml-auto">
                <Button
                  variant="secondary"
                  onClick={onToggle}
                  disabled={creating}
                  className="h-10 flex-1 rounded-xl border border-gray-200 bg-white px-5 font-bold text-gray-700 shadow-sm hover:bg-gray-50 sm:flex-none"
                >
                  Cancel
                </Button>
                <Button
                  className="h-10 flex-1 rounded-xl bg-gray-950 px-6 font-black text-white shadow-lg shadow-black/15 hover:bg-black disabled:shadow-none sm:flex-none"
                  onClick={handleSubmit}
                  disabled={creating || !title.trim()}
                >
                  {creating ? "Creating..." : "Create Task"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
