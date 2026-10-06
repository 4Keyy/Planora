"use client"

import { forwardRef, useEffect, useMemo, useRef, useState, useCallback, useId } from "react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { DURATION_FAST, DURATION_UI, EASE_EXIT, EASE_OUT_EXPO, TWEEN_UI } from "@/lib/animations"
import { Plus, Folder, Trash2, X } from "lucide-react"
import { api, parseApiResponse, type ApiResponse } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToastStore } from "@/store/toast"
import { Category, type CategoryListResponse, toCategoryList } from "@/types/category"
import { ICON_PICKER_ITEMS } from "@/components/ui/icon-picker"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { AutosaveIndicator } from "@/components/ui/autosave-indicator"
import { useAutosave } from "@/hooks/use-autosave"
import { ColorPicker } from "@/components/todos/edit-todo-modal/color-picker"
import { cn } from "@/lib/utils"
import { ICON_MAP } from "@/lib/icon-map"
import { FIELD_LABEL_CLASS } from "@/components/ui/field"
import { Overlay } from "@/components/ui/overlay"
import { StatusPanel } from "@/components/ui/status-panel"
import { PageHeader } from "@/components/layout/page-header"
import { CategoryCardSkeleton } from "@/components/categories/category-card-skeleton"

type CategoryFormData = {
  name: string
  description: string
  color: string
  icon: string | null
}

/**
 * Loading skeleton for category card
 */
/**
 * One category, in the same shell as a task card: an opaque paper card with a hairline
 * border that lifts 2px and deepens its shadow under the pointer, and a delete strip that
 * slides in from the right edge on a desktop.
 *
 * It used to be a transparent card with a grey 2px border, a hover glow computed from
 * the category's colour, a `backdrop-blur` switched on under the pointer, and the colour's
 * hex code printed as the card's second line ("#0EA5E9") — a value nobody chose by name
 * and nobody reads. The colour is still there, as the icon's tint.
 *
 * Every action is a real control. The card used to be a clickable `div` with a delete
 * strip that mounted only on mouse-enter, so from a keyboard a category could be neither
 * edited nor (on a desktop) deleted. The card's body is now a button, and the desktop
 * strip is a button that slides in on hover and on keyboard focus alike.
 */
/*
 * A forwardRef because the grid's presence runs in `popLayout` mode: it pins a leaving card
 * where it stood through this ref, and a component that drops the ref is silently not popped.
 */
const CategoryCard = forwardRef<HTMLDivElement, {
  category: Category
  onEdit: () => void
  onDelete: () => void
}>(function CategoryCard({ category, onEdit, onDelete }, ref) {
  const CategoryIcon = category.icon ? (ICON_MAP[category.icon] ?? Folder) : Folder
  const accentColor = category.color || "var(--pl-accent)"
  const [isControlHover, setIsControlHover] = useState(false)

  return (
    <motion.div
      ref={ref}
      // Position only: a size `layout` would stretch the bordered, rounded surface.
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: DURATION_FAST, ease: EASE_EXIT } }}
      whileHover={isControlHover ? undefined : { y: -2 }}
      transition={TWEEN_UI}
      className="group/card relative overflow-hidden rounded-lg border border-line bg-paper shadow-sm transition-shadow duration-base ease-emphasized hover:shadow-lg"
    >
      {/* Delete strip (desktop): always mounted, parked past the card's right edge, and
          slid in by a CSS transform when its zone is hovered or the button is focused. */}
      <div
        className="group/delete absolute inset-y-0 right-0 z-30 hidden w-16 overflow-hidden md:block"
        onMouseEnter={() => setIsControlHover(true)}
        onMouseLeave={() => setIsControlHover(false)}
      >
        <button
          type="button"
          aria-label={`Delete category ${category.name}`}
          className={cn(
            "flex h-full w-full translate-x-full items-center justify-center bg-alert text-paper focus-visible:-outline-offset-2",
            "transition-transform duration-base ease-emphasized group-hover/delete:translate-x-0 focus-visible:translate-x-0",
          )}
          onClick={onDelete}
        >
          <Trash2 className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {/* Delete (phones): neutral until pressed — the saturated colour belongs to the
          confirmation, not to the invitation. */}
      <button
        type="button"
        onClick={onDelete}
        className="absolute right-2 top-2 z-30 flex h-11 w-11 items-center justify-center rounded-full text-ink-muted transition-colors duration-fast active:bg-alert-surface active:text-alert md:hidden"
        aria-label={`Delete category ${category.name}`}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>

      <div aria-hidden="true" className="pointer-events-none absolute -bottom-6 -right-6 opacity-5 transition-opacity duration-slow group-hover/card:opacity-10">
        <CategoryIcon className="h-28 w-28 text-ink" strokeWidth={1} />
      </div>

      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit category ${category.name}`}
        // The focus ring is drawn inside the edge: the card clips its overflow, and an
        // outline offset outwards would be cut away entirely.
        className="relative z-10 flex w-full items-center gap-4 rounded-lg p-5 pr-14 text-left focus-visible:-outline-offset-2 md:pr-5"
      >
        <span
          aria-hidden="true"
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md"
          style={{ backgroundColor: `color-mix(in srgb, ${accentColor} 12%, transparent)` }}
        >
          <CategoryIcon className="h-5 w-5" style={{ color: accentColor }} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-body font-semibold tracking-tight text-ink">{category.name}</h2>
          <p className="mt-0.5 line-clamp-1 text-body-sm text-ink-muted">
            {category.description?.trim() || "No description"}
          </p>
        </div>
      </button>
    </motion.div>
  )
})

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

  const headingId = useId()
  const PreviewIcon = icon ? (ICON_MAP[icon] ?? Folder) : Folder
  const isEditing = !!initialData

  /*
   * One surface in the system's own terms. The dialog carried a private vocabulary —
   * 32px and 28px corner radii, `ring-gray-100`, borderless inputs on
   * a tinted fill, a close button that spun 90° on hover, five sections each fading in on
   * its own delay, and a Create button that grew under the pointer inside a wrapper that
   * also grew — none of it used anywhere else in the product.
   */
  return (
    <Overlay
      open={isOpen}
      onClose={handleClose}
      hideHeader
      labelledBy={headingId}
      className="max-w-3xl"
    >
      <div className="p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={headingId} className="text-title font-bold tracking-tight text-ink">
              {title}
            </h2>
            <p className="mt-1 text-body-sm text-ink-muted">
              {isEditing ? "Changes save as you make them." : "Name it, pick an icon and a colour."}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="-mr-2 -mt-1 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors duration-fast hover:bg-paper-sunken hover:text-ink"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="category-name" className={FIELD_LABEL_CLASS}>
                Name <span className="text-alert" aria-hidden="true">*</span>
              </label>
              <Input
                id="category-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Work, Home, Trip to Lisbon"
                maxLength={50}
                showCount
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="category-description" className={FIELD_LABEL_CLASS}>
                Description
              </label>
              <Input
                id="category-description"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Optional"
                maxLength={500}
                showCount
              />
            </div>

            <fieldset className="space-y-2">
              <legend className={FIELD_LABEL_CLASS}>Icon</legend>
              {/* Five across on phones: six made each cell 42px at 390 and 37px at 360. */}
              <div className="grid grid-cols-5 gap-2 rounded-lg border border-line bg-paper-sunken p-2 sm:grid-cols-7">
                {ICON_PICKER_ITEMS.map((item) => {
                  const IconComponent = item.icon
                  const isSelected = (icon ?? "Folder") === item.name
                  return (
                    <button
                      key={item.name}
                      type="button"
                      onClick={() => setIcon(item.name)}
                      className={cn(
                        "flex h-11 w-full items-center justify-center rounded-md transition-colors duration-fast",
                        isSelected ? "bg-ink text-paper" : "text-ink-muted hover:bg-paper hover:text-ink",
                      )}
                      aria-label={`${item.name} icon`}
                      aria-pressed={isSelected}
                    >
                      <IconComponent className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )
                })}
              </div>
            </fieldset>

            <AnimatePresence>
              {(error || (autosave && !name.trim())) && (
                <motion.p
                  role="alert"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: DURATION_FAST, ease: EASE_EXIT } }}
                  transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO }}
                  className="rounded-md border border-alert/25 bg-alert-surface px-4 py-3 text-body-sm text-alert"
                >
                  {error || "Enter a name to save your changes."}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          <div className="space-y-5">
            <div className="space-y-2">
              <p className={FIELD_LABEL_CLASS}>Preview</p>
              <div className="flex items-center gap-4 rounded-lg border border-line bg-paper p-4 shadow-sm">
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md"
                  style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
                >
                  <PreviewIcon className="h-5 w-5" style={{ color }} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-body font-semibold text-ink">{name || "Category name"}</p>
                  <p className="line-clamp-1 text-body-sm text-ink-muted">{desc || "No description"}</p>
                </div>
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className={FIELD_LABEL_CLASS}>Colour</legend>
              <div className="rounded-lg border border-line bg-paper-sunken p-4">
                <ColorPicker value={color} onChange={setColor} />
              </div>
            </fieldset>
          </div>
        </div>

        <div className="mt-8 flex items-center gap-3 border-t border-line pt-6">
          {autosave ? (
            // Edit mode: no Save/Cancel — changes persist automatically. The indicator
            // confirms each save; "Done" simply closes the (already-saved) dialog.
            <>
              <AutosaveIndicator status={saveStatus} />
              <div className="flex-1" />
              <Button variant="outline" onClick={handleClose}>
                Done
              </Button>
            </>
          ) : (
            // Create mode: a single explicit Create action (nothing exists to autosave yet).
            <Button size="lg" className="w-full" onClick={handleSave} loading={saving} disabled={!name.trim()}>
              Create category
            </Button>
          )}
        </div>
      </div>
    </Overlay>
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
      {/* Stacked on phones rather than wrapped: as a `flex-wrap` row at 390px the action
          started beside the title and dropped below it once the title block had its final
          height — an 84px jump that put this route's CLS at 0.129. */}
      <PageHeader
        eyebrow="Workspace"
        title="Categories"
        // Constant on purpose: a count here grew the sentence by a line after the list
        // arrived and pushed the full-width button down on a phone — a layout shift decided
        // by data. The grid below is the count.
        description="Group tasks the way you think about them."
        actions={
          // The shortcut hint is visual; `aria-keyshortcuts` carries it to assistive tech,
          // so the button is not announced as "New category c".
          <Button onClick={() => setIsCreateOpen(true)} aria-keyshortcuts="c" className="w-full sm:w-auto">
            <Plus className="h-4 w-4" aria-hidden="true" />
            New category
            <kbd
              aria-hidden="true"
              className="hidden rounded-sm border border-paper/20 bg-paper/10 px-1.5 font-sans text-caption font-semibold text-paper/80 md:inline"
            >
              C
            </kbd>
          </Button>
        }
      />

      {/* Category grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <CategoryCardSkeleton key={i} />
          ))}
        </div>
      ) : categories.length === 0 ? (
        <StatusPanel
          icon={Folder}
          title="No categories yet"
          description="Categories group tasks the way you think about them: home, work, a trip."
          action={{ label: "Create a category", onClick: () => setIsCreateOpen(true) }}
        />
      ) : (
        // The presence wraps the cards, not the grid: wrapped round the grid it had one child
        // that never left, so a deleted category vanished in a frame while its neighbours
        // glided. `relative` is the offset parent a leaving card is pinned to.
        <div className="relative grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <AnimatePresence mode="popLayout" initial={false}>
            {categories.map((category) => (
              <CategoryCard
                key={category.id}
                category={category}
                onEdit={() => setEditingCategory(category)}
                onDelete={() => setDeletingCategory(category)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Modals */}
      <CategoryModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSave={handleCreate}
        title="New category"
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
        title="Edit category"
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
