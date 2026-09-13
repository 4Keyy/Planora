export default function CategoriesLoading() {
  return (
    <div className="space-y-4">
      <div className="h-10 w-1/3 max-w-xs animate-pulse rounded-xl bg-gray-100" />
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-xl border border-line bg-paper shadow-sm"
          />
        ))}
      </div>
    </div>
  )
}
