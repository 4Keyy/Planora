export default function ProfileLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-4">
        <div className="h-20 w-20 animate-pulse rounded-full bg-gray-100" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-2/3 max-w-sm animate-pulse rounded bg-gray-100" />
          <div className="h-3 w-1/3 max-w-xs animate-pulse rounded bg-gray-50" />
        </div>
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-2xl border border-gray-100 bg-white shadow-soft"
          />
        ))}
      </div>
    </div>
  )
}
