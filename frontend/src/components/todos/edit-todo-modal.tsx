"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Todo, type UpdateTodoPayload, isTodoOwner } from "@/types/todo"
import { Category } from "@/types/category"
import { IconPicker } from "@/components/ui/icon-picker"
import { ICON_MAP } from "@/lib/icon-map"
import { api, parseApiResponse, type ApiResponse } from "@/lib/api"
import { ModalPortal } from "@/components/ui/modal-portal"
import { useAuthStore } from "@/store/auth"
import { FriendMultiSelect } from "@/components/todos/friend-multi-select"
import { useFriends } from "@/hooks/use-friends"
import { SPRING_STANDARD } from "@/lib/animations"
import { TaskComments } from "@/components/todos/task-comments"

/**
 * Priority level options with styling
 */
const PRIORITY_OPTIONS = [
  { value: "VeryLow", label: "Very Low", color: "#6b7280" },
  { value: "Low", label: "Low", color: "#059669" },
  { value: "Medium", label: "Medium", color: "#2563eb" },
  { value: "High", label: "High", color: "#ea580c" },
  { value: "Urgent", label: "Urgent", color: "#dc2626" },
] as const

/**
 * Convert priority string to numeric value
 */
const getPriorityNumber = (priority: string): number => {
  const priorityMap: Record<string, number> = {
    VeryLow: 1,
    Low: 2,
    Medium: 3,
    High: 4,
    Urgent: 5,
    Critical: 5,
  }
  return priorityMap[priority] ?? 3
}

/**
 * Convert numeric priority to string value
 */
const getPriorityString = (priority: string | number): string => {
  const normalized = String(priority)
  // If backend already sends a named enum, keep it.
  if (PRIORITY_OPTIONS.some((p) => p.value === normalized)) return normalized

  const priorityMap: Record<string, string> = {
    "1": "VeryLow",
    "2": "Low",
    "3": "Medium",
    "4": "High",
    "5": "Urgent",
  }
  return priorityMap[normalized] ?? "Medium"
}

interface EditTodoModalProps {
  todo: Todo
  categories: Category[]
  onClose: () => void
  onSave: (payload: UpdateTodoPayload) => Promise<void>
  onSaveViewerPreference: (payload: { viewerCategoryId: string | null }) => Promise<void>
  onCreateCategory: () => Promise<void>
  onDeleteCategory?: (categoryId: string) => Promise<void>
}

/**
 * Modal for editing existing todos
 */
export function EditTodoModal({
  todo,
  categories,
  onClose,
  onSave,
  onSaveViewerPreference,
  onCreateCategory,
}: EditTodoModalProps) {
  const viewerId = useAuthStore((s) => s.user?.userId)
  const isOwner = isTodoOwner(todo, viewerId)
  const isFriendVisible = todo.isPublic || (todo.sharedWithUserIds?.length ?? 0) > 0
  const canManageViewerCategory = !isOwner && isFriendVisible
  const canEditCategory = isOwner || canManageViewerCategory
  const [title, setTitle] = useState(todo.title)
  const [description, setDescription] = useState(todo.description || "")
  const [priority, setPriority] = useState(getPriorityString(todo.priority))
  const [dueDate, setDueDate] = useState(
    todo.dueDate ? new Date(todo.dueDate).toISOString().split("T")[0] : ""
  )
  const [categoryId, setCategoryId] = useState(todo.categoryId ?? "__none")
  const friends = useFriends(true)
  const [isPublic, setIsPublic] = useState(todo.isPublic)
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>(todo.sharedWithUserIds ?? [])
  const [requiredWorkers, setRequiredWorkers] = useState<number | null>(todo.requiredWorkers ?? null)
  const [saving, setSaving] = useState(false)
  const hasSharedAudience = isPublic || selectedFriendIds.length > 0

  // New category creation form state
  const [newCatName, setNewCatName] = useState("")
  const [newCatColor, setNewCatColor] = useState("#6366f1")
  const [newCatIcon, setNewCatIcon] = useState<string | null>(null)

  // Ensure form always shows current todo values when opening/changing todo
  useEffect(() => {
    setTitle(todo.title)
    setDescription(todo.description || "")
    setPriority(getPriorityString(todo.priority))
    setDueDate(todo.dueDate ? new Date(todo.dueDate).toISOString().split("T")[0] : "")
    setCategoryId(todo.categoryId ?? "__none")
    setIsPublic(todo.isPublic)
    setSelectedFriendIds(todo.sharedWithUserIds ?? [])
    setRequiredWorkers(todo.requiredWorkers ?? null)

    // Reset inline category creation state
    setNewCatName("")
    setNewCatColor("#6366f1")
    setNewCatIcon(null)
  }, [todo.id, todo.title, todo.description, todo.priority, todo.dueDate, todo.categoryId, todo.isPublic, todo.sharedWithUserIds])

  /**
   * Close modal on Escape key
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  /**
   * Handle save with validation
   */
  const handleSave = async () => {
    if (isOwner && !title.trim()) return
    if (!isOwner && !canManageViewerCategory) return

    setSaving(true)
    try {
      let finalCategoryId = categoryId !== "__none" && categoryId !== "__new" ? categoryId : undefined

      // Create new category if requested
      if (categoryId === "__new" && newCatName.trim()) {
        try {
          const response = await api.post<ApiResponse<Category>>("/categories/api/v1/categories", {
            name: newCatName.trim(),
            color: newCatColor,
            icon: newCatIcon,
            displayOrder: 0,
          })
          finalCategoryId = parseApiResponse<Category>(response.data).id
          await onCreateCategory()
        } catch {
          // Silently skip category creation if it fails
        }
      }

      if (isOwner) {
        await onSave({
          title: title.trim(),
          description: description.trim() || null,
          priority: getPriorityNumber(priority),
          dueDate: dueDate ? new Date(dueDate).toISOString() : null,
          categoryId: finalCategoryId || null,
          isPublic,
          sharedWithUserIds: selectedFriendIds,
          requiredWorkers: requiredWorkers,
          clearRequiredWorkers: requiredWorkers === null,
        })
      } else {
        await onSaveViewerPreference({
          viewerCategoryId: finalCategoryId || null,
        })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[2000] flex items-center justify-center p-4"
        onClick={onClose}
      >
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-md"
        />

      {/* Modal Container */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={SPRING_STANDARD}
        className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-[2rem] bg-white shadow-2xl z-[2001] scrollbar-hide"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 md:p-7 space-y-5">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="flex items-center justify-between"
          >
            <div>
              <h2 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight">
                Edit Task
              </h2>
              <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">
                Update your progress
              </p>
            </div>
            <motion.button
              onClick={onClose}
              whileHover={{ scale: 1.1, rotate: 90 }}
              whileTap={{ scale: 0.95 }}
              className="h-10 w-10 rounded-2xl bg-gray-50 hover:bg-gray-100 flex items-center justify-center transition-[background-color] active:shadow-md"
            >
              <X className="h-5 w-5 text-gray-500" />
            </motion.button>
          </motion.div>

          {/* Form Fields */}
          <div className="space-y-4">
            {/* Title Input */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.05 }}
              className="space-y-1"
            >
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Task Title"
                disabled={!isOwner}
                maxLength={200}
                showCount={isOwner}
                className="border-none bg-gray-50/50 text-base md:text-lg font-bold focus-visible:ring-0 focus-visible:bg-gray-50 placeholder:text-gray-300 h-12 md:h-14 rounded-2xl"
              />
            </motion.div>

            {/* Description Input */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className="space-y-1"
            >
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Notes or details..."
                rows={3}
                disabled={!isOwner}
                maxLength={5000}
                showCount={isOwner}
                className="border-none bg-gray-50/50 text-sm focus-visible:ring-0 focus-visible:bg-gray-50 placeholder:text-gray-300 rounded-2xl resize-none p-4"
              />
            </motion.div>

            {/* Priority & Due Date */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.15 }}
              className="grid grid-cols-1 sm:grid-cols-2 gap-4"
            >
              <div className="space-y-1">
                <Select value={priority} onValueChange={setPriority} disabled={!isOwner}>
                  <SelectTrigger className="border-none bg-gray-50/50 h-12 rounded-2xl focus:ring-0">
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent className="rounded-2xl border-gray-100 shadow-xl p-2 z-[3000]">
                    {PRIORITY_OPTIONS.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        className="rounded-xl py-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: option.color }}
                          />
                          <span className="text-[10px] font-black uppercase tracking-tighter">
                            {option.label}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={!isOwner}
                  className="border-none bg-gray-50/50 h-12 rounded-2xl focus-visible:ring-0 text-[10px] md:text-xs font-black uppercase"
                />
              </div>
            </motion.div>

            {/* Category Selection */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 }}
              className="space-y-1"
            >
              <Select value={categoryId} onValueChange={setCategoryId} disabled={!canEditCategory}>
                <SelectTrigger className="border-none bg-gray-50/50 h-12 rounded-2xl focus:ring-0">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent className="rounded-2xl border-gray-100 shadow-xl p-2 z-[3000]">
                  <SelectItem value="__none" className="rounded-xl text-[10px] font-black uppercase text-gray-400">
                    No category
                  </SelectItem>
                  {categories.map((cat) => {
                    const CatIcon = cat.icon ? (ICON_MAP[cat.icon] ?? null) : null
                    return (
                      <SelectItem key={cat.id} value={cat.id} className="rounded-xl py-2.5">
                        <div className="flex items-center gap-2">
                          {CatIcon && (
                            <CatIcon
                              className="h-4 w-4"
                              style={{ color: cat.color || "#111" }}
                            />
                          )}
                          <span className="text-sm font-bold">{cat.name}</span>
                        </div>
                      </SelectItem>
                    )
                  })}
                  {canEditCategory && (
                    <SelectItem value="__new" className="rounded-xl font-black text-indigo-600 focus:text-indigo-700">
                      + Create Category
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              {canManageViewerCategory && (
                <p className="text-[10px] md:text-xs text-gray-400 font-semibold">
                  This category is private for you and does not change the author&apos;s task.
                </p>
              )}
            </motion.div>

            {/* Inline New Category Creation Form */}
            <AnimatePresence>
            {canEditCategory && categoryId === "__new" && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden space-y-4 pt-2 border-t border-gray-100"
              >
                <div className="space-y-1">
                  <Input
                    placeholder="Category Name"
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    maxLength={50}
                    showCount
                    className="border-none bg-gray-50 h-10 rounded-xl focus-visible:ring-0 text-sm font-bold"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <IconPicker
                      selectedIcon={newCatIcon}
                      onIconSelect={setNewCatIcon}
                    />
                  </div>
                  <div className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-xl border border-gray-100">
                    <input
                      type="color"
                      value={newCatColor}
                      onChange={(e) => setNewCatColor(e.target.value)}
                      className="h-8 w-8 rounded-lg cursor-pointer bg-transparent border-none"
                    />
                    <span className="text-[10px] font-black uppercase tracking-tighter pr-2">
                      Color
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
            </AnimatePresence>
          </div>

          {/* Share with friends — owner only */}
          {isOwner && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.23 }}
              className="space-y-2 rounded-2xl border border-gray-100 bg-gradient-to-br from-gray-50/80 to-white p-3.5 shadow-sm"
            >
              <label className="text-[10px] md:text-xs font-black uppercase tracking-widest text-gray-400">
                Share with friends
              </label>
              <FriendMultiSelect
                friends={friends}
                selectedIds={selectedFriendIds}
                onChange={setSelectedFriendIds}
                disabled={false}
                publicSelected={isPublic}
                onPublicChange={setIsPublic}
                placeholder="Private task"
                contentClassName="z-[2600]"
              />
              <p className="text-[10px] md:text-xs text-gray-400 font-semibold">
                Choose all friends or pick specific people. Leave empty to keep this task private.
              </p>
              {hasSharedAudience && (
                <div className="flex items-center gap-2 pt-1">
                  <label className="text-[11px] font-black uppercase tracking-wider text-gray-400 whitespace-nowrap">
                    Max workers
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={isPublic ? 1 + friends.length : selectedFriendIds.length > 0 ? 1 + selectedFriendIds.length : undefined}
                    value={requiredWorkers ?? ""}
                    onChange={(e) => {
                      const v = e.target.value
                      setRequiredWorkers(v === "" ? null : Math.max(1, parseInt(v, 10)))
                    }}
                    placeholder="No limit"
                    className="h-8 rounded-lg text-xs w-28 border-gray-200 bg-white"
                  />
                </div>
              )}
            </motion.div>
          )}

          {/* Comments */}
          {hasSharedAudience && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.26 }}
              className="rounded-2xl border border-gray-100 bg-gray-50/50 p-3.5"
            >
              <TaskComments
                todoId={todo.id}
                isOwner={isOwner}
                canComment={true}
              />
            </motion.div>
          )}

          {/* Footer Actions */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.3 }}
            className="flex gap-3 pt-4 border-t border-gray-50"
          >
            <motion.div
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="flex-1"
            >
              <Button
                variant="outline"
                onClick={onClose}
                className="w-full h-12 rounded-2xl font-bold border-gray-100 hover:bg-gray-50 text-gray-500"
              >
                Cancel
              </Button>
            </motion.div>
            <motion.div
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="flex-1"
            >
              <Button
                onClick={handleSave}
                disabled={saving || (isOwner ? !title.trim() : !canManageViewerCategory)}
                className="w-full h-12 rounded-2xl font-bold bg-black hover:bg-gray-900 shadow-xl shadow-black/10"
              >
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </motion.div>
          </motion.div>
        </div>
      </motion.div>
      </div>
    </ModalPortal>
  )
}
