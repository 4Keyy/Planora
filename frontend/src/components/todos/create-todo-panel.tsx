"use client"

import { useEffect, useRef, useState, type RefObject } from "react"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import {
  ArrowRight,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  Globe2,
  Lock,
  Plus,
  Sparkles,
  Users,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar } from "@/components/ui/avatar"
import { Category } from "@/types/category"
import type { CreateTodoPayload } from "@/types/todo"
import type { FriendDto } from "@/types/auth"
import { ICON_MAP } from "@/lib/icon-map"
import { Popover, PopoverHeader } from "@/components/todos/edit-todo-modal/popover"
import { PriorityPopover } from "@/components/todos/edit-todo-modal/popovers/priority"
import { CategoryPopover } from "@/components/todos/edit-todo-modal/popovers/category"
import { DatePopover } from "@/components/todos/edit-todo-modal/popovers/date"
import { formatDueRange, getPriorityLabel, getPriorityNumber } from "@/components/todos/edit-todo-modal/utils"
import { useFriends } from "@/hooks/use-friends"
import { cn } from "@/lib/utils"
import { TWEEN_FAST, SPRING_RESPONSIVE, EASE_OUT_EXPO } from "@/lib/animations"

interface CreateTodoPanelProps {
  isOpen: boolean
  onToggle: () => void
  categories: Category[]
  onSubmit: (payload: CreateTodoPayload) => Promise<void>
  onCreateCategory: () => Promise<void>
  onDeleteCategory: (id: string) => Promise<void>
  shortcutHint?: string
}

const TITLE_MAX_LENGTH = 200
const DESCRIPTION_MAX_LENGTH = 5000
const LIMIT_WARNING_RATIO = 0.8

type OpenPopover = "priority" | "date" | "category" | "share" | null

function LimitCounter({ value, max }: { value: number; max: number }) {
  const isNearLimit = value >= max * LIMIT_WARNING_RATIO

  return (
    <span
      className={cn(
        "text-[11px] font-black tabular-nums transition-colors duration-300",
        isNearLimit ? "text-red-500" : "text-gray-300"
      )}
    >
      {value}/{max}
    </span>
  )
}

function friendName(f: FriendDto): string {
  const full = [f.firstName, f.lastName].filter(Boolean).join(" ").trim()
  if (full) return full
  return f.email ? f.email.split("@")[0] : f.id
}

/**
 * One of the four selector plates under the title area (Priority / Due date /
 * Category / Share). A compact card trigger whose current value crossfades in
 * place; the actual picker opens as an anchored popover rendered via
 * {@link Popover} inside the same relative wrapper (`containerRef`).
 */
function SelectorCard({
  containerRef,
  label,
  ariaLabel,
  value,
  valueKey,
  muted,
  icon,
  iconClass,
  iconStyle,
  open,
  onToggle,
  onClear,
  clearLabel,
  children,
}: {
  containerRef: RefObject<HTMLDivElement>
  label: string
  /** Accessible name of the trigger; defaults to the visible label. */
  ariaLabel?: string
  value: string
  /** Key driving the value crossfade — change it to animate the swap. */
  valueKey: string
  /** Placeholder-ish values ("No date", "None") render in a lighter tone. */
  muted?: boolean
  icon: React.ReactNode
  iconClass: string
  /** Inline squircle background (e.g. a category color tint). */
  iconStyle?: React.CSSProperties
  open: boolean
  onToggle: () => void
  onClear?: () => void
  clearLabel?: string
  children?: React.ReactNode
}) {
  return (
    <div ref={containerRef} className="relative">
      <motion.button
        type="button"
        onClick={onToggle}
        aria-label={ariaLabel ?? label}
        aria-expanded={open}
        whileTap={{ scale: 0.98 }}
        transition={SPRING_RESPONSIVE}
        className={cn(
          "group flex w-full items-center gap-3 rounded-2xl border bg-white p-3 text-left shadow-sm",
          "transition-[border-color,box-shadow,background-color] duration-200",
          open
            ? "border-gray-300 shadow-md"
            : "border-gray-200/80 hover:border-gray-300 hover:shadow-md"
        )}
      >
        <span
          className={cn(
            "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl transition-colors duration-200",
            iconClass
          )}
          style={iconStyle}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-black uppercase tracking-[0.14em] text-gray-400">
            {label}
          </span>
          {/* Fixed-height value row so the crossfade never resizes the card. */}
          <span className="relative block h-5 overflow-hidden">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={valueKey}
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -8, opacity: 0 }}
                transition={{ duration: 0.16, ease: EASE_OUT_EXPO }}
                className={cn(
                  "block truncate text-sm font-black leading-5 tracking-tight",
                  muted ? "text-gray-400" : "text-gray-950"
                )}
              >
                {value}
              </motion.span>
            </AnimatePresence>
          </span>
        </span>
        {onClear && (
          <span
            role="button"
            tabIndex={0}
            aria-label={clearLabel}
            onClick={e => { e.stopPropagation(); onClear() }}
            onKeyDown={e => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                e.stopPropagation()
                onClear()
              }
            }}
            className="flex h-6 w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded-lg text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
        )}
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
          className="flex-shrink-0 text-gray-300 transition-colors group-hover:text-gray-500"
        >
          <ChevronDown className="h-4 w-4" strokeWidth={2.2} />
        </motion.span>
      </motion.button>
      {children}
    </div>
  )
}

/**
 * Share picker mirroring the FriendMultiSelect semantics the panel used before
 * the redesign: "All friends" toggles the public flag (clearing direct shares),
 * picking a friend while public switches to a direct share with just them.
 */
function SharePopover({
  open,
  onClose,
  containerRef,
  friends,
  isPublic,
  onPublicChange,
  selectedIds,
  onChange,
}: {
  open: boolean
  onClose: () => void
  containerRef: RefObject<HTMLElement | null>
  friends: FriendDto[]
  isPublic: boolean
  onPublicChange: (v: boolean) => void
  selectedIds: string[]
  onChange: (ids: string[]) => void
}) {
  const toggleFriend = (id: string) => {
    if (isPublic) {
      onPublicChange(false)
      onChange([id])
      return
    }
    onChange(
      selectedIds.includes(id) ? selectedIds.filter(fid => fid !== id) : [...selectedIds, id]
    )
  }

  const sub = isPublic
    ? "all friends"
    : selectedIds.length > 0
      ? `${selectedIds.length} of ${friends.length}`
      : "only you"

  return (
    <Popover open={open} onClose={onClose} width={320} align="right" containerRef={containerRef}>
      <PopoverHeader
        label="Share"
        sub={<span className="text-[11px] font-semibold text-gray-400">{sub}</span>}
      />
      <div className="p-1.5">
        <button
          type="button"
          onClick={() => {
            const nextPublic = !isPublic
            onPublicChange(nextPublic)
            if (nextPublic) onChange([])
          }}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-colors duration-150",
            isPublic ? "bg-gray-950 text-white" : "hover:bg-gray-50"
          )}
        >
          <span
            className={cn(
              "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg",
              isPublic ? "bg-white/10 text-white" : "bg-gray-100 text-gray-500"
            )}
          >
            <Globe2 className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-black tracking-tight">All friends</span>
            <span className={cn("block text-[11px] font-semibold", isPublic ? "text-white/55" : "text-gray-400")}>
              Every accepted friend can see it
            </span>
          </span>
          <span
            className={cn(
              "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-black transition-colors",
              isPublic ? "bg-white text-gray-950" : "shadow-[inset_0_0_0_1.5px_#e5e5e5] text-transparent"
            )}
          >
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        </button>

        <div className="mx-1.5 my-1.5 h-px bg-gray-100" />

        {friends.length === 0 ? (
          <div className="px-3 py-5 text-center text-xs font-bold text-gray-400">
            No friends yet.
          </div>
        ) : (
          <div className="max-h-52 space-y-0.5 overflow-y-auto">
            {friends.map(f => {
              const selected = !isPublic && selectedIds.includes(f.id)
              return (
                <button
                  key={f.id}
                  type="button"
                  role="checkbox"
                  aria-checked={selected}
                  aria-label={friendName(f)}
                  onClick={() => toggleFriend(f.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors duration-150",
                    selected ? "bg-gray-50" : "hover:bg-gray-50"
                  )}
                >
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg">
                    <Avatar
                      src={f.profilePictureUrl}
                      firstName={f.firstName}
                      lastName={f.lastName}
                      email={f.email}
                      size={28}
                      className="rounded-lg"
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-bold text-gray-800">
                    {friendName(f)}
                  </span>
                  <span
                    className={cn(
                      "flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full transition-colors",
                      selected ? "bg-gray-950 text-white" : "shadow-[inset_0_0_0_1.5px_#e5e5e5] text-transparent"
                    )}
                  >
                    <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </Popover>
  )
}

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
  const [dueDateStart, setDueDateStart] = useState("")
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined)
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [isPublic, setIsPublic] = useState(false)
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([])
  const [openPopover, setOpenPopover] = useState<OpenPopover>(null)
  // The collapse animation needs overflow clipping, but the selector popovers
  // must escape the panel once it is fully open — so clipping is released after
  // the height transition settles (see the timeout below).
  const [settled, setSettled] = useState(isOpen)

  const prefersReducedMotion = useReducedMotion()
  const friends = useFriends(isOpen)
  const titleRef = useRef<HTMLInputElement>(null)

  const priorityCardRef = useRef<HTMLDivElement>(null)
  const dateCardRef = useRef<HTMLDivElement>(null)
  const categoryCardRef = useRef<HTMLDivElement>(null)
  const shareCardRef = useRef<HTMLDivElement>(null)

  const titleNearLimit = title.length >= TITLE_MAX_LENGTH * LIMIT_WARNING_RATIO

  const togglePopover = (key: Exclude<OpenPopover, null>) =>
    setOpenPopover(prev => (prev === key ? null : key))

  const resetForm = () => {
    setTitle("")
    setDescription("")
    setPriority("Medium")
    setDueDate("")
    setDueDateStart("")
    setCategoryId(undefined)
    setFormError(null)
    setIsPublic(false)
    setSelectedFriendIds([])
    setOpenPopover(null)
  }

  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => titleRef.current?.focus(), 220)
      return () => clearTimeout(t)
    }
    setOpenPopover(null)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      setSettled(false)
      return
    }
    const t = setTimeout(() => setSettled(true), 400)
    return () => clearTimeout(t)
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
      await onSubmit({
        userId: null,
        title: title.trim(),
        description: description.trim() || null,
        categoryId: categoryId || null,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        dueDateStart: dueDateStart ? new Date(dueDateStart).toISOString() : null,
        priority: getPriorityNumber(priority),
        isPublic,
        sharedWithUserIds: selectedFriendIds,
        tags: [],
        // Auto-set capacity = author + selected friends; unlimited for public-only tasks
        requiredWorkers: selectedFriendIds.length > 0 ? 1 + selectedFriendIds.length : null,
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
    // Capture phase: this must observe an open selector popover BEFORE the
    // popover's own (document-level) Escape handler closes it, so one Escape
    // closes the popover and only the next one closes the panel.
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key === "Enter") {
        e.preventDefault()
        handleSubmit()
      } else if (e.key === "Escape" && !creating) {
        if (openPopover) return
        e.preventDefault()
        onToggle()
      }
    }
    window.addEventListener("keydown", handler, true)
    return () => window.removeEventListener("keydown", handler, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, title, description, priority, dueDate, dueDateStart, categoryId, isPublic, selectedFriendIds, creating, openPopover])

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

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

  const selectedCategory = categoryId ? categories.find(c => c.id === categoryId) : undefined
  const SelectedCatIcon = selectedCategory?.icon ? (ICON_MAP[selectedCategory.icon] ?? Folder) : Folder

  const shareValue = isPublic
    ? "Public"
    : selectedFriendIds.length > 0
      ? `${selectedFriendIds.length} ${selectedFriendIds.length === 1 ? "friend" : "friends"}`
      : "Private"
  const shareAria = isPublic
    ? "Shared with all friends"
    : selectedFriendIds.length > 0
      ? `Shared with ${selectedFriendIds.length} ${selectedFriendIds.length === 1 ? "friend" : "friends"}`
      : "Private task"

  const handleDeleteCategory = async (id: string) => {
    await onDeleteCategory(id)
    if (categoryId === id) setCategoryId(undefined)
  }

  return (
    <div
      className={cn(
        "rounded-3xl border border-gray-200/80 bg-white shadow-[0_18px_60px_-28px_rgba(15,23,42,0.35)]",
        !isOpen && "overflow-hidden"
      )}
    >
      {/*
        Always-visible header — clicking opens/closes the panel.
        The + button is ONE persistent element that rotates 0° ↔ 45°,
        so the animation plays correctly in both directions.
      */}
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "group flex w-full items-center justify-between gap-4 rounded-t-3xl p-4 text-left transition-colors duration-200 hover:bg-gray-50/60 sm:p-5",
          !isOpen && "rounded-b-3xl"
        )}
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
                  <p className="mt-0.5 text-[11px] font-semibold text-gray-400">Title is all you need</p>
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
        {/* Clipping is released once the open transition settles so the
            selector popovers can extend past the panel bounds. */}
        <div className={cn("min-h-0", (!isOpen || !settled) && "overflow-hidden")}>
          <div
            style={{ opacity: isOpen ? 1 : 0, transition: contentOpacityTransition }}
          >
            {/* Separator between header and form */}
            <div className="h-px bg-gray-100 mx-4" />

            <div className="space-y-6 p-5 sm:p-6">
              {/* Title + details behind a single left rule, exactly like the
                  mock: naked oversized inputs, no boxed fields. The rule warms
                  up while either field has focus. */}
              <motion.div
                {...fieldMotion(0.06)}
                className="border-l-2 border-gray-100 pl-4 transition-colors duration-300 focus-within:border-gray-900 sm:pl-6"
              >
                <div className="flex items-start gap-3">
                  <input
                    ref={titleRef}
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="What needs to be done?"
                    maxLength={TITLE_MAX_LENGTH}
                    className={cn(
                      "w-full border-none bg-transparent p-0 text-2xl font-black tracking-tight outline-none sm:text-[28px] sm:leading-tight",
                      "placeholder:text-gray-300",
                      titleNearLimit ? "text-red-600" : "text-gray-950"
                    )}
                  />
                  <span className="mt-2 flex-shrink-0">
                    <LimitCounter value={title.length} max={TITLE_MAX_LENGTH} />
                  </span>
                </div>
                <div className="mt-2 flex items-start gap-3">
                  <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Add details — optional."
                    rows={2}
                    maxLength={DESCRIPTION_MAX_LENGTH}
                    className="max-h-40 w-full resize-none border-none bg-transparent p-0 text-[15px] font-medium text-gray-700 outline-none placeholder:text-gray-400"
                  />
                  <span className="flex-shrink-0">
                    <LimitCounter value={description.length} max={DESCRIPTION_MAX_LENGTH} />
                  </span>
                </div>
              </motion.div>

              {/* Selector plates — auto-fit so the row is 4-up on the wide
                  tasks page and stacks gracefully in the dashboard sidebar. */}
              <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
                <motion.div {...fieldMotion(0.1)}>
                  <SelectorCard
                    containerRef={priorityCardRef}
                    label="Priority"
                    value={getPriorityLabel(priority)}
                    valueKey={priority}
                    icon={<Sparkles className="h-[18px] w-[18px]" strokeWidth={2.2} />}
                    iconClass="bg-gray-950 text-white shadow-md shadow-black/15"
                    open={openPopover === "priority"}
                    onToggle={() => togglePopover("priority")}
                  >
                    <PriorityPopover
                      open={openPopover === "priority"}
                      onClose={() => setOpenPopover(null)}
                      value={priority}
                      onChange={setPriority}
                      containerRef={priorityCardRef as RefObject<HTMLElement | null>}
                    />
                  </SelectorCard>
                </motion.div>

                <motion.div {...fieldMotion(0.13)}>
                  <SelectorCard
                    containerRef={dateCardRef}
                    label="Due date"
                    value={dueDate ? formatDueRange(dueDateStart, dueDate) : "No date"}
                    valueKey={`${dueDateStart}|${dueDate}`}
                    muted={!dueDate}
                    icon={<Calendar className="h-[18px] w-[18px]" strokeWidth={2.2} />}
                    iconClass={dueDate ? "bg-gray-950 text-white shadow-md shadow-black/15" : "bg-gray-100 text-gray-500"}
                    open={openPopover === "date"}
                    onToggle={() => togglePopover("date")}
                    onClear={dueDate ? () => { setDueDate(""); setDueDateStart("") } : undefined}
                    clearLabel="Clear due date"
                  >
                    <DatePopover
                      open={openPopover === "date"}
                      onClose={() => setOpenPopover(null)}
                      start={dueDateStart}
                      end={dueDate}
                      onChange={(s, e) => {
                        setDueDateStart(s ?? "")
                        setDueDate(e ?? "")
                      }}
                      containerRef={dateCardRef as RefObject<HTMLElement | null>}
                    />
                  </SelectorCard>
                </motion.div>

                <motion.div {...fieldMotion(0.16)}>
                  <SelectorCard
                    containerRef={categoryCardRef}
                    label="Category"
                    value={selectedCategory?.name ?? "None"}
                    valueKey={categoryId ?? "__none"}
                    muted={!selectedCategory}
                    icon={
                      selectedCategory
                        ? <SelectedCatIcon className="h-[18px] w-[18px]" style={{ color: selectedCategory.color ?? "#525252" }} />
                        : <Folder className="h-[18px] w-[18px]" strokeWidth={2.2} />
                    }
                    iconClass={selectedCategory ? "" : "bg-gray-100 text-gray-500"}
                    iconStyle={selectedCategory ? { background: `${selectedCategory.color ?? "#6b7280"}1A` } : undefined}
                    open={openPopover === "category"}
                    onToggle={() => togglePopover("category")}
                    onClear={selectedCategory ? () => setCategoryId(undefined) : undefined}
                    clearLabel="Clear category"
                  >
                    <CategoryPopover
                      open={openPopover === "category"}
                      onClose={() => setOpenPopover(null)}
                      value={categoryId ?? null}
                      onChange={id => setCategoryId(id ?? undefined)}
                      categories={categories}
                      onCreateCategory={onCreateCategory}
                      onDeleteCategory={handleDeleteCategory}
                      containerRef={categoryCardRef as RefObject<HTMLElement | null>}
                      canEdit
                    />
                  </SelectorCard>
                </motion.div>

                <motion.div {...fieldMotion(0.19)}>
                  <SelectorCard
                    containerRef={shareCardRef}
                    label="Share"
                    ariaLabel={shareAria}
                    value={shareValue}
                    valueKey={shareValue}
                    muted={!isPublic && selectedFriendIds.length === 0}
                    icon={
                      isPublic
                        ? <Globe2 className="h-[18px] w-[18px]" strokeWidth={2.2} />
                        : selectedFriendIds.length > 0
                          ? <Users className="h-[18px] w-[18px]" strokeWidth={2.2} />
                          : <Lock className="h-[18px] w-[18px]" strokeWidth={2.2} />
                    }
                    iconClass={
                      isPublic || selectedFriendIds.length > 0
                        ? "bg-gray-950 text-white shadow-md shadow-black/15"
                        : "bg-gray-100 text-gray-500"
                    }
                    open={openPopover === "share"}
                    onToggle={() => togglePopover("share")}
                  >
                    <SharePopover
                      open={openPopover === "share"}
                      onClose={() => setOpenPopover(null)}
                      containerRef={shareCardRef as RefObject<HTMLElement | null>}
                      friends={friends}
                      isPublic={isPublic}
                      onPublicChange={setIsPublic}
                      selectedIds={selectedFriendIds}
                      onChange={setSelectedFriendIds}
                    />
                  </SelectorCard>
                </motion.div>
              </div>

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

            <motion.div
              {...fieldMotion(0.22)}
              className="flex flex-col gap-3 rounded-b-3xl border-t border-gray-100 bg-gray-50/80 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
            >
              <div className="hidden items-center gap-1.5 sm:flex">
                <kbd className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-black text-gray-500 shadow-sm">
                  {isMac ? "⌘" : "Ctrl"}
                </kbd>
                <kbd className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-black text-gray-500 shadow-sm">
                  ↵
                </kbd>
                <span className="ml-1 text-[11px] font-bold text-gray-400">to create</span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={onToggle}
                  disabled={creating}
                  className="h-10 flex-1 rounded-xl border border-gray-200 bg-white px-5 font-bold text-gray-700 shadow-sm hover:bg-gray-50 sm:flex-none"
                >
                  Cancel
                </Button>
                <Button
                  className={cn(
                    "group h-10 flex-1 rounded-xl bg-gray-950 px-6 font-black text-white shadow-lg shadow-black/15 hover:bg-black sm:flex-none",
                    "disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none"
                  )}
                  onClick={handleSubmit}
                  disabled={creating || !title.trim()}
                >
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" strokeWidth={2.5} />
                  {creating ? "Creating..." : "Create task"}
                </Button>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  )
}
