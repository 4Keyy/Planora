export function TodoSkeleton() {
  return (
    <div className="rounded-xl border border-line bg-paper p-6 shadow-sm animate-pulse relative overflow-hidden">
      <div className="flex items-start gap-4">
        <div className="h-6 w-6 rounded-full bg-gray-100 mt-1 flex-shrink-0" />
        <div className="flex-1 space-y-3">
          <div className="h-4 bg-gray-100 rounded-md w-3/4" />
          <div className="h-3 bg-paper-sunken rounded-md w-1/2" />
          <div className="h-3 bg-paper-sunken rounded-md w-1/4 pt-2" />
        </div>
      </div>
    </div>
  )
}
