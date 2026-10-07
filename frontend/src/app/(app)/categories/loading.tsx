import { PageHeaderSkeleton } from "@/components/layout/page-header"
import { CategoryCardSkeleton } from "@/components/categories/category-card-skeleton"

/** Streaming fallback for /categories: the header with its button, then the card grid. */
export default function CategoriesLoading() {
  return (
    <div aria-busy="true" className="skeleton-defer space-y-6">
      <PageHeaderSkeleton actions="button" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <CategoryCardSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}
