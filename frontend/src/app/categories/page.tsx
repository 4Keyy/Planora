"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { SPRING_STANDARD, TWEEN_UI } from "@/lib/animations"
import { Plus, Folder, Trash2, X } from "lucide-react"
import { api, parseApiResponse, type ApiResponse } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToastStore } from "@/store/toast"
import { Category, type CategoryListResponse, toCategoryList } from "@/types/category"
import { ICON_PICKER_ITEMS } from "@/components/ui/icon-picker"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { ModalPortal } from "@/components/ui/modal-portal"
import { ColorPicker } from "@/components/todos/edit-todo-modal/color-picker"
import { cn, truncateText } from "@/lib/utils"
import { ICON_MAP } from "@/lib/icon-map"

type CategoryFormData = {
  name: string
  description: string
  color: string
  icon: string | null
}

/**
 * Loading skeleton for category card
 */
function CategoryCardSkeleton() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="rounded-2xl border-2 border-gray-400 bg-transparent p-6 h-32 animate-pulse overflow-hidden"
    >
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-gray-300/30 flex-shrink-0 mt-0.5" />
        <div className="flex-1 space-y-2.5 min-w-0">
          <div className="h-5 bg-gray-300/30 rounded w-3/4" />
          <div className="h-4 bg-gray-300/20 rounded w-full" />
          <div className="h-2.5 bg-gray-300/20 rounded w-1/3 mt-2" />
        </div>
      </div>
    </motion.div>
  )
}

function CategoryCard({
  category,
  onEdit,
  onDelete,
}: {
  category: Category
  onEdit: () => void
  onDelete: () => void
}) {
  const CategoryIcon = category.icon ? (ICON_MAP[category.icon] ?? Folder) : Folder
  const accentColor = category.color || "#6366f1"
  const [isControlHover, setIsControlHover] = useState(false)
  const [isCardHovered, setIsCardHovered] = useState(false)
  const [isDeleteZoneHovered, setIsDeleteZoneHovered] = useState(false)

  const hoverShadow = `${accentColor}44`
  const hoverShadowSoft = `${accentColor}22`

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0, y: 15, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        whileHover={isControlHover ? undefined : { y: -4, scale: 1.008 }}
        transition={TWEEN_UI}
        onHoverStart={() => setIsCardHovered(true)}
        onHoverEnd={() => setIsCardHovered(false)}
        onClick={onEdit}
        style={{
          boxShadow: isCardHovered ? `0 8px 32px -4px ${hoverShadow}, 0 4px 16px -2px ${hoverShadowSoft}` : undefined,
          transitionProperty: "box-shadow, background-color",
          transitionDuration: "300ms",
          transitionTimingFunction: "ease-out",
        }}
        className="group/card relative cursor-pointer rounded-2xl border-2 border-gray-400 bg-transparent hover:bg-white/40 hover:backdrop-blur-sm overflow-hidden"
      >
        {/* Delete Trigger Area (Desktop - slide from right) */}
        <div
          className="absolute top-[-2px] right-[-2px] bottom-[-2px] w-[68px] z-30 hidden md:flex overflow-hidden"
          onMouseEnter={() => { setIsDeleteZoneHovered(true); setIsControlHover(true) }}
          onMouseLeave={() => { setIsDeleteZoneHovered(false); setIsControlHover(false) }}
        >
          <AnimatePresence>
            {isDeleteZoneHovered && (
              <motion.div
                key="delete-panel"
                variants={{
                  hidden: { clipPath: "inset(0 0 0 100%)", transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } },
                  visible: { clipPath: "inset(0 0 0 0%)", transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] } },
                }}
                initial="hidden"
                animate="visible"
                exit="hidden"
                style={{
                  background: "linear-gradient(to right, rgba(239,68,68,0) 0%, rgba(239,68,68,0.85) 35%, #dc2626 100%)",
                  boxShadow: "-6px 0 20px rgba(239,68,68,0.18)",
                }}
                className="h-full w-full flex items-center justify-center text-white cursor-pointer"
                whileHover={{ filter: "brightness(1.12)" }}
                onClick={(e) => { e.stopPropagation(); onDelete() }}
              >
                <motion.div
                  variants={{
                    hidden: { scale: 0.5, opacity: 0, y: 6 },
                    visible: { scale: 1, opacity: 1, y: 0, transition: { delay: 0.07, type: "spring", stiffness: 420, damping: 22 } },
                  }}
                >
                  <Trash2 className="h-[18px] w-[18px]" />
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Mobile Delete Button */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="absolute top-3 right-3 md:hidden z-30"
        >
          <motion.button
            whileHover={{ scale: 1.15, rotate: 10 }}
            whileTap={{ scale: 0.9 }}
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="p-2.5 rounded-full bg-red-500 text-white shadow-md hover:shadow-lg transition-all active:shadow-none"
            aria-label="Delete category"
          >
            <Trash2 className="h-5 w-5" />
          </motion.button>
        </motion.div>

        {/* Watermark icon */}
        <div className="absolute -right-7 -bottom-7 pointer-events-none opacity-[0.07] group-hover/card:opacity-[0.12] transition-opacity duration-300">
          <CategoryIcon className="h-32 w-32" style={{ color: "#000" }} strokeWidth={1} />
        </div>

        <div className="relative z-10 p-6">
          <div className="flex items-start gap-3 pr-8">
            {/* Icon */}
            <motion.div
              className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ backgroundColor: `${accentColor}18` }}
            >
              <CategoryIcon className="h-5 w-5" style={{ color: accentColor }} />
            </motion.div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <motion.h3
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="font-black text-gray-950 text-base tracking-tight leading-snug"
              >
                {truncateText(category.name, 20)}
              </motion.h3>
              {category.description && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.05 }}
                  className="text-sm text-gray-500 mt-1 line-clamp-2 leading-relaxed"
                >
                  {category.description}
                </motion.p>
              )}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="flex items-center gap-1.5 mt-2"
              >
                <div
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: accentColor }}
                />
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  {accentColor}
                </span>
              </motion.div>
            </div>
          </div>
        </div>
      </motion.div>
    </>
  )
}

/**
 * Category creation/editing modal
 */
function CategoryModal({
  isOpen,
  onClose,
  onSave,
  initialData,
  title,
}: {
  isOpen: boolean
  onClose: () => void
  onSave: (data: CategoryFormData) => Promise<void>
  initialData?: CategoryFormData
  title: string
}) {
  const [name, setName] = useState(initialData?.name ?? "")
  const [desc, setDesc] = useState(initialData?.description ?? "")
  const [color, setColor] = useState(initialData?.color ?? "#6366f1")
  const [icon, setIcon] = useState<string | null>(initialData?.icon ?? null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  /**
   * Reset form when modal opens/closes
   */
  useEffect(() => {
    if (isOpen) {
      setName(initialData?.name ?? "")
      setDesc(initialData?.description ?? "")
      setColor(initialData?.color ?? "#6366f1")
      setIcon(initialData?.icon ?? null)
      setError("")
    }
  }, [isOpen, initialData])

  /**
   * Close on Escape key
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
   * Handle save
   */
  const handleSave = async () => {
    if (!name.trim()) {
      setError("Name is required")
      return
    }

    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        description: desc.trim(),
        color,
        icon,
      })
      onClose()
    } catch {
      setError("Failed to save category")
    } finally {
      setSaving(false)
    }
  }

  const PreviewIcon = icon ? (ICON_MAP[icon] ?? Folder) : Folder
  const isEditing = !!initialData

  return (
    <ModalPortal>
      <AnimatePresence>
        {isOpen && (
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

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={SPRING_STANDARD}
          className="relative z-[2001] max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[2rem] bg-white shadow-2xl scrollbar-hide"
          onClick={(e) => e.stopPropagation()}
        >
        <div className="p-6 md:p-8">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="flex items-start justify-between gap-4"
          >
            <div>
              <h2 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight">
                {title}
              </h2>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-400 md:text-xs">
                {isEditing ? "Update category details" : "Organize your workspace"}
              </p>
            </div>
            <motion.button
              onClick={onClose}
              whileHover={{ scale: 1.1, rotate: 90 }}
              whileTap={{ scale: 0.95 }}
              className="h-10 w-10 rounded-2xl bg-gray-50 hover:bg-gray-100 flex items-center justify-center transition-[background-color] active:shadow-md"
              aria-label="Close category modal"
            >
              <X className="h-5 w-5 text-gray-500" />
            </motion.button>
          </motion.div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
            <div className="space-y-4">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.05 }}
                className="space-y-1.5"
              >
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 md:text-xs">
                  Name *
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Work, Personal, Projects..."
                  maxLength={50}
                  showCount
                  className="h-12 rounded-2xl border-none bg-gray-50/60 text-base font-bold placeholder:text-gray-300 focus-visible:bg-gray-50 focus-visible:ring-0 md:h-14 md:text-lg"
                />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
                className="space-y-1.5"
              >
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 md:text-xs">
                  Description
                </label>
                <Input
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder="Optional..."
                  maxLength={500}
                  showCount
                  className="h-12 rounded-2xl border-none bg-gray-50/60 text-sm font-bold placeholder:text-gray-300 focus-visible:bg-gray-50 focus-visible:ring-0"
                />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.15 }}
                className="space-y-1.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 md:text-xs">
                    Icon
                  </label>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-gray-300">
                    {icon || "Folder"}
                  </span>
                </div>
                <div className="rounded-[1.75rem] bg-gray-50/80 p-3 ring-1 ring-gray-100">
                  <div className="grid grid-cols-6 gap-2 sm:grid-cols-7">
                    {ICON_PICKER_ITEMS.map((item) => {
                      const IconComponent = item.icon
                      const isSelected = (icon ?? "Folder") === item.name
                      return (
                        <motion.button
                          key={item.name}
                          type="button"
                          whileHover={{ scale: 1.06 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => setIcon(item.name)}
                          className={cn(
                            "flex h-11 w-full items-center justify-center rounded-2xl border transition-all duration-150",
                            isSelected
                              ? "border-black bg-black text-white shadow-lg shadow-black/15"
                              : "border-transparent bg-white/80 text-gray-500 hover:border-gray-200 hover:text-gray-900"
                          )}
                          aria-label={`Select ${item.name} icon`}
                          aria-pressed={isSelected}
                        >
                          <IconComponent className="h-4 w-4" />
                        </motion.button>
                      )
                    })}
                  </div>
                </div>
              </motion.div>

              <AnimatePresence>
                {error && (
                  <motion.p
                    initial={{ opacity: 0, y: -6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.96 }}
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    className="rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-center text-[11px] font-bold text-red-600"
                  >
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 }}
              className="space-y-4"
            >
              <div className="rounded-[1.75rem] bg-gradient-to-br from-gray-50 to-white p-4 ring-1 ring-gray-100">
                <div className="mb-3 flex items-center gap-3">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: `${color}20` }}
                  >
                    <PreviewIcon className="h-6 w-6" style={{ color }} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-gray-900">
                      {name || "Preview"}
                    </p>
                    <p className="line-clamp-2 text-xs font-medium text-gray-500">
                      {desc || "Description"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 rounded-2xl bg-white/80 px-3 py-2 ring-1 ring-gray-100">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="font-mono text-xs font-bold uppercase tracking-wide text-gray-500">
                    {color}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 md:text-xs">
                  Color
                </label>
                <div className="rounded-[1.75rem] bg-gray-50/80 p-4 ring-1 ring-gray-100">
                  <ColorPicker value={color} onChange={setColor} />
                </div>
              </div>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.25 }}
            className="mt-6 flex flex-col-reverse gap-3 border-t border-gray-100 pt-5 sm:flex-row"
          >
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="sm:flex-1">
              <Button
                variant="outline"
                className="h-12 w-full rounded-2xl border-gray-100 font-bold text-gray-500 hover:bg-gray-50"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </Button>
            </motion.div>
            <motion.div
              whileHover={!saving && name.trim() ? { scale: 1.02 } : undefined}
              whileTap={!saving && name.trim() ? { scale: 0.98 } : undefined}
              className="sm:flex-1"
            >
              <Button
                className="h-12 w-full rounded-2xl bg-black font-bold shadow-xl shadow-black/10 hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
                onClick={handleSave}
                disabled={saving || !name.trim()}
              >
                {saving ? "Saving..." : "Save"}
              </Button>
            </motion.div>
          </motion.div>
        </div>
        </motion.div>
      </div>
        )}
      </AnimatePresence>
    </ModalPortal>
  )
}

export default function CategoriesPage() {
  const router = useRouter()
  const addToast = useToastStore((s) => s.addToast)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const clearAuth = useAuthStore(s => s.clearAuth)
  const hasHydrated = useAuthStore(s => s.hasHydrated)

  // Data state
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)

  // UI state
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null)

  /**
   * Fetch categories from API
   */
  const fetchCategories = useCallback(async () => {
    try {
      const response = await api.get<ApiResponse<CategoryListResponse>>("/categories/api/v1/categories")
      setCategories(toCategoryList(parseApiResponse<CategoryListResponse>(response.data)))
    } catch (error) {
      console.error("Failed to fetch categories:", error)
      addToast({ type: "error", title: "Failed to load categories" })
    } finally {
      setLoading(false)
    }
  }, [addToast])

  // Press "C" — open create modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "c") return
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
      if (isCreateOpen) return
      const target = e.target as HTMLElement
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return
      e.preventDefault()
      setIsCreateOpen(true)
    }
    window.addEventListener("keydown", handler, true)
    return () => window.removeEventListener("keydown", handler, true)
  }, [isCreateOpen])

  /**
   * Initialize on mount
   */
  useEffect(() => {
    if (!hasHydrated) return

    // Check authentication
    if (!isAuthenticated || !useAuthStore.getState().isTokenValid()) {
      clearAuth()
      router.replace("/auth/login")
      return
    }

    fetchCategories()
  }, [isAuthenticated, hasHydrated, router, fetchCategories, clearAuth])

  /**
   * Create new category
   */
  const handleCreate = async (data: CategoryFormData) => {
    try {
      await api.post("/categories/api/v1/categories", {
        name: data.name,
        description: data.description || null,
        color: data.color,
        icon: data.icon,
        displayOrder: 0,
      })
      await fetchCategories()
      addToast({ type: "success", title: "Category created!" })
    } catch (error) {
      console.error("Failed to create category:", error)
      addToast({ type: "error", title: "Failed to create category" })
    }
  }

  /**
   * Edit existing category
   */
  const handleEdit = async (data: CategoryFormData) => {
    if (!editingCategory) return

    try {
      await api.put(
        `/categories/api/v1/categories/${editingCategory.id}`,
        {
          name: data.name,
          description: data.description || null,
          color: data.color,
          icon: data.icon,
        }
      )
      await fetchCategories()
      addToast({ type: "success", title: "Category updated" })
    } catch (error) {
      console.error("Failed to update category:", error)
      addToast({ type: "error", title: "Failed to update category" })
    }
  }

  /**
   * Delete category
   */
  const confirmDelete = async () => {
    if (!deletingCategory) return

    try {
      await api.delete(
        `/categories/api/v1/categories/${deletingCategory.id}`
      )
      setCategories((prev) =>
        prev.filter((c) => c.id !== deletingCategory.id)
      )
      addToast({ type: "success", title: "Category deleted" })
      
      // Force reload to update todo items (since they might have lost their category)
      router.refresh()
    } catch (error) {
      console.error("Failed to delete category:", error)
      addToast({ type: "error", title: "Failed to delete category" })
    } finally {
      setDeletingCategory(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-1">
            Organization
          </p>
          <h1 className="text-3xl font-bold text-gray-900">Categories</h1>
          <p className="text-gray-500 mt-1">
            {categories.length} {categories.length === 1 ? "category" : "categories"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Category
            <kbd className="hidden md:flex font-mono bg-white/20 text-white/70 px-1.5 py-0.5 rounded text-[10px] font-bold border border-white/20 leading-tight ml-1.5">c</kbd>
          </Button>
        </div>
      </div>

      {/* Category grid */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <CategoryCardSkeleton key={i} />
          ))}
        </div>
      ) : categories.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-2xl border-2 border-dashed border-gray-400 bg-transparent p-16 text-center"
        >
          <div className="mx-auto h-14 w-14 rounded-2xl bg-gray-50 flex items-center justify-center mb-3">
            <Folder className="h-7 w-7 text-gray-200" />
          </div>
          <p className="font-semibold text-gray-900 mb-1">No categories yet</p>
          <p className="text-sm text-gray-500 mb-4">
            Create categories to organize your tasks
          </p>
          <Button
            size="sm"
            onClick={() => setIsCreateOpen(true)}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Create first category
          </Button>
        </motion.div>
      ) : (
        <AnimatePresence mode="popLayout">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {categories.map((category) => (
              <CategoryCard
                key={category.id}
                category={category}
                onEdit={() => setEditingCategory(category)}
                onDelete={() => setDeletingCategory(category)}
              />
            ))}
          </div>
        </AnimatePresence>
      )}

      {/* Modals */}
      <CategoryModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSave={handleCreate}
        title="New Category"
      />

      <CategoryModal
        isOpen={!!editingCategory}
        onClose={() => setEditingCategory(null)}
        onSave={handleEdit}
        initialData={editingCategory ? {
          name: editingCategory.name,
          description: editingCategory.description || "",
          color: editingCategory.color || "#6366f1",
          icon: editingCategory.icon || null,
        } : undefined}
        title="Edit Category"
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={!!deletingCategory}
        onClose={() => setDeletingCategory(null)}
        onConfirm={confirmDelete}
        title="Delete Category?"
        description={`Are you sure you want to delete "${deletingCategory?.name}"? All tasks in this category will become uncategorized.`}
        confirmText="Delete Category"
      />
    </div>
  )
}
