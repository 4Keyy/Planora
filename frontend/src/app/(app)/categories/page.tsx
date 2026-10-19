"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence } from "framer-motion"
import { Plus, Folder } from "lucide-react"
import { api, parseApiResponse, type ApiResponse } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { Button } from "@/components/ui/button"
import { useToastStore } from "@/store/toast"
import { Category, type CategoryListResponse, toCategoryList } from "@/types/category"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { StatusPanel } from "@/components/ui/status-panel"
import { PageHeader } from "@/components/layout/page-header"
import { CategoryCard } from "@/components/categories/category-card"
import { CategoryCardSkeleton } from "@/components/categories/category-card-skeleton"
import { CategoryDialog, type CategoryFormData } from "@/components/categories/category-dialog"
import { Enter, SkeletonSwap } from "@/components/animated/entrance"
import { forgetOrigin, rememberOrigin } from "@/lib/shared-origin"
import { canHandleCreateShortcut } from "@/lib/create-task-request"

/**
 * When the page's parts arrive, in ms after it starts: the header line by line, then the
 * cards in reading order — from their moment, or from when they load if that is later.
 */
const CATEGORIES_AT = {
  header: 0,
  cards: 230,
} as const

type CategoryTaskCount = { categoryId: string; openCount: number }

export default function CategoriesPage() {
  const router = useRouter()
  const addToast = useToastStore((s) => s.addToast)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const clearAuth = useAuthStore(s => s.clearAuth)
  const hasHydrated = useAuthStore(s => s.hasHydrated)

  // Data state
  const [categories, setCategories] = useState<Category[]>([])
  /** Open tasks per category; null until read, or when the count could not be read. */
  const [openCounts, setOpenCounts] = useState<Map<string, number> | null>(null)
  const [loading, setLoading] = useState(true)

  // UI state
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null)
  const hasLoadedGrid = useRef(false)
  useEffect(() => {
    if (!loading) hasLoadedGrid.current = true
  }, [loading])

  /**
   * The new-category sheet grows out of whatever opened it — the button, when it was pressed —
   * and from the centre for `C`, which has no place on the page.
   */
  const openCreate = useCallback((from?: HTMLElement | null) => {
    if (from) rememberOrigin(from)
    else forgetOrigin()
    setIsCreateOpen(true)
  }, [])

  /**
   * Fetch categories from API
   */
  const fetchCategories = useCallback(async () => {
    try {
      // The counts come with the list, so a card is drawn once with its count rather than
      // growing a chip after it has arrived. A count that cannot be read only hides the chips.
      const [response, counts] = await Promise.all([
        api.get<ApiResponse<CategoryListResponse>>("/categories/api/v1/categories"),
        api
          .get<CategoryTaskCount[]>("/todos/api/v1/todos/category-counts")
          .then((res) => new Map((res.data ?? []).map((c) => [c.categoryId, c.openCount] as const)))
          .catch(() => null),
      ])
      setCategories(toCategoryList(parseApiResponse<CategoryListResponse>(response.data)))
      setOpenCounts(counts)
    } catch (error) {
      console.error("Failed to fetch categories:", error)
      addToast({ type: "error", title: "Couldn't load categories" })
    } finally {
      setLoading(false)
    }
  }, [addToast])

  // Press "C" — open create modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!canHandleCreateShortcut(e)) return
      if (isCreateOpen || editingCategory || deletingCategory) return
      e.preventDefault()
      openCreate(null)
    }
    window.addEventListener("keydown", handler, true)
    return () => window.removeEventListener("keydown", handler, true)
  }, [isCreateOpen, editingCategory, deletingCategory, openCreate])

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
    } catch (error) {
      console.error("Failed to create category:", error)
      addToast({ type: "error", title: "Couldn't create category" })
      // The sheet stays open with what was typed, and says so.
      throw error
    }
    await fetchCategories()
    addToast({ type: "success", title: "Category created" })
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
            ? { ...c, name: data.name, description: data.description || null, color: data.color, icon: data.icon }
            : c
        )
      )
    } catch (error) {
      console.error("Failed to update category:", error)
      addToast({ type: "error", title: "Couldn't save category" })
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
      // Deleted from its own sheet: the sheet has nothing left to show.
      if (editingCategory?.id === deletingCategory.id) setEditingCategory(null)
      addToast({ type: "success", title: "Category deleted" })
      
      // Force reload to update todo items (since they might have lost their category)
      router.refresh()
    } catch (error) {
      console.error("Failed to delete category:", error)
      addToast({ type: "error", title: "Couldn't delete category" })
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
        entranceAt={CATEGORIES_AT.header}
        eyebrow="Workspace"
        title="Categories"
        // Constant on purpose: a count here grew the sentence by a line after the list
        // arrived and pushed the full-width button down on a phone — a layout shift decided
        // by data. The grid below is the count.
        description="Group tasks the way you think about them."
        actions={
          // The shortcut hint is visual; `aria-keyshortcuts` carries it to assistive tech,
          // so the button is not announced as "New category c".
          <Button onClick={(e) => openCreate(e.currentTarget)} aria-keyshortcuts="c" className="w-full sm:w-auto">
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
      <SkeletonSwap
        loading={loading}
        skeleton={
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <CategoryCardSkeleton key={i} showTaskCount />
            ))}
          </div>
        }
      >
        {categories.length === 0 ? (
          <Enter tier="panel" at={CATEGORIES_AT.cards}>
            <StatusPanel
              icon={Folder}
              title="No categories yet"
              description="Categories group tasks the way you think about them: home, work, a trip."
              action={{ label: "Create a category", onClick: () => openCreate(null) }}
            />
          </Enter>
        ) : (
          // The presence wraps the cards, not the grid: wrapped round the grid it had one child
          // that never left, so a deleted category vanished in a frame while its neighbours
          // glided. `relative` is the offset parent a leaving card is pinned to.
          <div className="relative grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <AnimatePresence mode="popLayout">
              {categories.map((category, index) => (
                <CategoryCard
                  key={category.id}
                  category={category}
                  taskCount={openCounts ? openCounts.get(category.id) ?? 0 : undefined}
                  onEdit={() => setEditingCategory(category)}
                  onDelete={() => setDeletingCategory(category)}
                  entrance={{ at: CATEGORIES_AT.cards, index: hasLoadedGrid.current ? 0 : index }}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </SkeletonSwap>

      {/* The two sheets: one for a new category, one for an existing one. */}
      <CategoryDialog
        mode="create"
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSave={handleCreate}
      />

      <CategoryDialog
        mode="edit"
        open={!!editingCategory}
        category={editingCategory}
        onClose={() => setEditingCategory(null)}
        onSave={handleEdit}
        onDelete={() => editingCategory && setDeletingCategory(editingCategory)}
        onOpenCount={(id, openCount) =>
          setOpenCounts((prev) => {
            // Without the page's counts no card shows one; a single fresh count would make
            // every other card read "No tasks".
            if (!prev || prev.get(id) === openCount) return prev
            const next = new Map(prev)
            next.set(id, openCount)
            return next
          })
        }
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
