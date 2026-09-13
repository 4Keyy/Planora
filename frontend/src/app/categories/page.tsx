"use client"

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
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
import { AutosaveIndicator } from "@/components/ui/autosave-indicator"
import { useAutosave } from "@/hooks/use-autosave"
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
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="rounded-xl border-2 border-gray-400 bg-transparent p-6 h-32 animate-pulse overflow-hidden"
    >
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-gray-300/30 flex-shrink-0 mt-0.5" />
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
  const accentColor = category.color || "var(--pl-accent)"
  const [isControlHover, setIsControlHover] = useState(false)
  const [isCardHovered, setIsCardHovered] = useState(false)
  const [isDeleteZoneHovered, setIsDeleteZoneHovered] = useState(false)

  const hoverShadow = `${accentColor}44`
  const hoverShadowSoft = `${accentColor}22`

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0 }}
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
          transitionTimingFunction: "var(--pl-ease-emphasized)",
        }}
        className="group/card relative cursor-pointer rounded-xl border-2 border-gray-400 bg-transparent hover:bg-paper/40 hover:backdrop-blur-sm overflow-hidden"
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
                  hidden: { clipPath: "inset(0 0 0 100%)", transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } },
                  visible: { clipPath: "inset(0 0 0 0%)", transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] } },
                }}
                initial="hidden"
                animate="visible"
                exit="hidden"
                style={{
                  background: "linear-gradient(to right, rgba(239,68,68,0) 0%, rgba(239,68,68,0.85) 35%, var(--pl-alert) 100%)",
                  boxShadow: "-6px 0 20px rgba(239,68,68,0.18)",
                }}
                className="h-full w-full flex items-center justify-center text-paper cursor-pointer"
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
          initial={{ opacity: 0 }}
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
            /* Neutral until pressed — see todo-card.tsx. The saturated colour
               belongs to the confirmation, not to the invitation. */
            className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-paper/90 text-ink-subtle shadow-sm backdrop-blur-sm transition-colors hover:border-alert hover:bg-alert hover:text-paper active:bg-alert"
            aria-label="Delete category"
          >
            <Trash2 className="h-5 w-5" />
          </motion.button>
        </motion.div>

        {/* Watermark icon */}
        <div className="absolute -right-7 -bottom-7 pointer-events-none opacity-[0.07] group-hover/card:opacity-[0.12] transition-opacity duration-slow">
          <CategoryIcon className="h-32 w-32" style={{ color: "var(--pl-ink)" }} strokeWidth={1} />
        </div>

        <div className="relative z-10 p-6">
          <div className="flex items-start gap-3 pr-8">
            {/* Icon */}
            <motion.div
              className="h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ backgroundColor: `${accentColor}18` }}
            >
              <CategoryIcon className="h-5 w-5" style={{ color: accentColor }} />
            </motion.div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <motion.h2
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="font-bold text-ink text-body tracking-tight leading-snug"
              >
                {truncateText(category.name, 20)}
              </motion.h2>
              {category.description && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.05 }}
                  className="text-body-sm text-ink-subtle mt-1 line-clamp-2 leading-relaxed"
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
                <span className="text-caption font-bold text-ink-subtle uppercase tracking-wider">
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
  autosave = false,
}: {
  isOpen: boolean
  onClose: () => void
  onSave: (data: CategoryFormData) => Promise<void>
  initialData?: CategoryFormData
  title: string
  /** Edit mode: persist every change automatically with no Save/Cancel buttons. */
  autosave?: boolean
}) {
  const [name, setName] = useState(initialData?.name ?? "")
  const [desc, setDesc] = useState(initialData?.description ?? "")
  const [color, setColor] = useState(initialData?.color ?? "var(--pl-accent)")
  const [icon, setIcon] = useState<string | null>(initialData?.icon ?? null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  // Live form snapshot, trimmed exactly as it is persisted, used as the autosave value.
  const formData: CategoryFormData = useMemo(
    () => ({ name: name.trim(), description: desc.trim(), color, icon }),
    [name, desc, color, icon],
  )

  const { status: saveStatus, flush, reset } = useAutosave<CategoryFormData>({
    value: formData,
    enabled: autosave && isOpen,
    onSave,
    // Never persist an empty name (the category's only required field).
    validate: (data) => data.name.length > 0,
  })

  /**
   * Seed the form (and re-anchor the autosave baseline) only on the modal's *opening*
   * edge. `initialData` is a fresh object on every parent render, and autosave triggers
   * parent re-renders (optimistic grid updates) while the modal is open — so resetting on
   * its identity would clobber in-progress input. Gating on the open transition avoids that
   * while still re-seeding correctly when a different category is opened (open requires a
   * prior close, since the modal is a full-screen overlay).
   */
  const wasOpen = useRef(false)
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      const next = {
        name: initialData?.name ?? "",
        description: initialData?.description ?? "",
        color: initialData?.color ?? "var(--pl-accent)",
        icon: initialData?.icon ?? null,
      }
      setName(next.name)
      setDesc(next.description)
      setColor(next.color)
      setIcon(next.icon)
      setError("")
      reset({ ...next, name: next.name.trim(), description: next.description.trim() })
    }
    wasOpen.current = isOpen
  }, [isOpen, initialData, reset])

  /**
   * Flush any pending autosave, then close. Guarantees the last edit is persisted even
   * if the user closes within the debounce window (the modal stays mounted between opens,
   * so we cannot rely on an unmount flush here).
   */
  const handleClose = useCallback(() => {
    if (autosave) void flush()
    onClose()
  }, [autosave, flush, onClose])

  /**
   * Close on Escape key
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleClose()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleClose])

  /**
   * Handle explicit create (create mode only — editing autosaves).
   */
  const handleSave = async () => {
    if (!name.trim()) {
      setError("Name is required")
      return
    }

    setSaving(true)
    try {
      await onSave(formData)
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
        className="fixed inset-0 z-modal flex items-center justify-center p-4"
        onClick={handleClose}
      >
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-ink/60 backdrop-blur-md"
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={SPRING_STANDARD}
          className="relative z-modal max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[2rem] bg-paper shadow-xl scrollbar-hide"
          onClick={(e) => e.stopPropagation()}
        >
        <div className="p-6 md:p-8">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32 }}
            className="flex items-start justify-between gap-4"
          >
            <div>
              <h2 className="text-title-sm md:text-title font-bold text-ink tracking-tight">
                {title}
              </h2>
              <p className="mt-1 text-caption font-bold uppercase tracking-widest text-ink-subtle md:text-caption">
                {isEditing ? "Update category details" : "Organize your workspace"}
              </p>
            </div>
            <motion.button
              onClick={handleClose}
              whileHover={{ scale: 1.1, rotate: 90 }}
              whileTap={{ scale: 0.95 }}
              className="h-10 w-10 rounded-xl bg-paper-sunken hover:bg-gray-100 flex items-center justify-center transition-[background-color] active:shadow-md"
              aria-label="Close category modal"
            >
              <X className="h-5 w-5 text-ink-subtle" />
            </motion.button>
          </motion.div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
            <div className="space-y-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.32, delay: 0.05 }}
                className="space-y-1.5"
              >
                <label htmlFor="category-name" className="text-caption font-bold uppercase tracking-widest text-ink-subtle md:text-caption">
                  Name *
                </label>
                <Input
                  id="category-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Work, Personal, Projects..."
                  maxLength={50}
                  showCount
                  className="h-12 rounded-xl border-none bg-paper-sunken/60 text-body font-bold placeholder:text-ink-subtle focus-visible:bg-paper-sunken focus-visible:ring-0 md:h-14 md:text-title-sm"
                />
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.32, delay: 0.1 }}
                className="space-y-1.5"
              >
                <label htmlFor="category-description" className="text-caption font-bold uppercase tracking-widest text-ink-subtle md:text-caption">
                  Description
                </label>
                <Input
                  id="category-description"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder="Optional..."
                  maxLength={500}
                  showCount
                  className="h-12 rounded-xl border-none bg-paper-sunken/60 text-body-sm font-bold placeholder:text-ink-subtle focus-visible:bg-paper-sunken focus-visible:ring-0"
                />
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.32, delay: 0.15 }}
                className="space-y-1.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <label className="text-caption font-bold uppercase tracking-widest text-ink-subtle md:text-caption">
                    Icon
                  </label>
                  <span className="text-caption font-bold uppercase tracking-wide text-ink-subtle">
                    {icon || "Folder"}
                  </span>
                </div>
                <div className="rounded-[1.75rem] bg-paper-sunken/80 p-3 ring-1 ring-gray-100">
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
                            "flex h-11 w-full items-center justify-center rounded-xl border transition-[color,background-color,border-color,opacity,transform,box-shadow] duration-fast",
                            isSelected
                              ? "border-black bg-ink text-paper shadow-lg shadow-black/15"
                              : "border-transparent bg-paper/80 text-ink-subtle hover:border-line hover:text-ink"
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
                {(error || (autosave && !name.trim())) && (
                  <motion.p
                    initial={{ opacity: 0, y: -6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.96 }}
                    transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                    className="rounded-lg border border-alert-surface bg-alert-surface px-3 py-2.5 text-center text-caption font-bold text-alert"
                  >
                    {error || "Enter a name to save your changes"}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, delay: 0.2 }}
              className="space-y-4"
            >
              <div className="rounded-[1.75rem] bg-gradient-to-br from-gray-50 to-white p-4 ring-1 ring-gray-100">
                <div className="mb-3 flex items-center gap-3">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-xl"
                    style={{ backgroundColor: `${color}20` }}
                  >
                    <PreviewIcon className="h-6 w-6" style={{ color }} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-body-sm font-bold text-ink">
                      {name || "Preview"}
                    </p>
                    <p className="line-clamp-2 text-caption font-medium text-ink-subtle">
                      {desc || "Description"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 rounded-xl bg-paper/80 px-3 py-2 ring-1 ring-gray-100">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="font-mono text-caption font-bold uppercase tracking-wide text-ink-subtle">
                    {color}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-caption font-bold uppercase tracking-widest text-ink-subtle md:text-caption">
                  Color
                </label>
                <div className="rounded-[1.75rem] bg-paper-sunken/80 p-4 ring-1 ring-gray-100">
                  <ColorPicker value={color} onChange={setColor} />
                </div>
              </div>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, delay: 0.25 }}
            className="mt-6 flex items-center gap-3 border-t border-line pt-5"
          >
            {autosave ? (
              // Edit mode: no Save/Cancel — changes persist automatically. The indicator
              // confirms each save; "Done" simply closes the (already-saved) modal.
              <>
                <AutosaveIndicator status={saveStatus} />
                <div className="flex-1" />
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <Button
                    variant="outline"
                    className="h-12 rounded-xl border-line px-6 font-bold text-ink-subtle hover:bg-paper-sunken"
                    onClick={handleClose}
                  >
                    Done
                  </Button>
                </motion.div>
              </>
            ) : (
              // Create mode: a single explicit Create action (nothing exists to autosave yet).
              <motion.div
                whileHover={!saving && name.trim() ? { scale: 1.02 } : undefined}
                whileTap={!saving && name.trim() ? { scale: 0.98 } : undefined}
                className="flex-1"
              >
                <Button
                  className="h-12 w-full rounded-xl bg-ink font-bold shadow-xl shadow-black/10 hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
                  onClick={handleSave}
                  disabled={saving || !name.trim()}
                >
                  {saving ? "Creating..." : "Create category"}
                </Button>
              </motion.div>
            )}
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
   * Autosave an edit to the open category. Called by the modal on every committed
   * change (debounced), so it stays quiet on success and updates the grid optimistically
   * rather than refetching per keystroke. Errors are toasted and re-thrown so the modal's
   * AutosaveIndicator can show the failed state and retry on the next change.
   */
  const handleEdit = async (data: CategoryFormData) => {
    if (!editingCategory) return
    const id = editingCategory.id

    try {
      await api.put(
        `/categories/api/v1/categories/${id}`,
        {
          name: data.name,
          description: data.description || null,
          color: data.color,
          icon: data.icon,
        }
      )
      setCategories((prev) =>
        prev.map((c) =>
          c.id === id
            ? { ...c, name: data.name, description: data.description, color: data.color, icon: data.icon }
            : c
        )
      )
    } catch (error) {
      console.error("Failed to update category:", error)
      addToast({ type: "error", title: "Failed to save category" })
      throw error
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
          <p className="text-body-sm font-medium text-ink-subtle uppercase tracking-wider mb-1">
            Organization
          </p>
          <h1 className="text-display-sm font-bold text-ink">Categories</h1>
          <p className="text-ink-subtle mt-1">
            {categories.length} {categories.length === 1 ? "category" : "categories"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Category
            <kbd className="hidden md:flex font-mono bg-paper/20 text-paper/70 px-1.5 py-0.5 rounded text-caption font-bold border border-white/20 leading-tight ml-1.5">c</kbd>
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
          className="rounded-xl border-2 border-dashed border-gray-400 bg-transparent p-16 text-center"
        >
          <div className="mx-auto h-14 w-14 rounded-xl bg-paper-sunken flex items-center justify-center mb-3">
            <Folder className="h-7 w-7 text-gray-200" />
          </div>
          <p className="font-semibold text-ink mb-1">No categories yet</p>
          <p className="text-body-sm text-ink-subtle mb-4">
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
        autosave
        onClose={() => setEditingCategory(null)}
        onSave={handleEdit}
        initialData={editingCategory ? {
          name: editingCategory.name,
          description: editingCategory.description || "",
          color: editingCategory.color || "var(--pl-accent)",
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
