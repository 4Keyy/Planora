/** Match known card content when refreshing; unknown initial content uses the compact shape. */
export function CategoryCardSkeleton({
  hasDescription = false,
  showTaskCount = false,
}: {
  hasDescription?: boolean
  showTaskCount?: boolean
}) {
  return (
    <div aria-hidden="true" className="flex animate-pulse rounded-lg border border-line bg-paper shadow-sm motion-reduce:animate-none">
      <div className="flex w-full items-start gap-4 p-5 pr-16 md:pr-20">
        <div className="h-10 w-10 flex-shrink-0 rounded-md bg-paper-sunken" />
        <div className="flex min-w-0 flex-1 flex-col self-stretch">
          <p className="text-body">
            <span className="block w-1/2 rounded-sm bg-paper-sunken">&nbsp;</span>
          </p>
          {hasDescription && (
            <p className="mt-0.5 text-body-sm"><span className="block w-3/4 rounded-sm bg-paper-sunken">&nbsp;</span></p>
          )}
          {showTaskCount && (
            <div className="mt-auto pt-3"><div className="h-6 w-20 rounded-sm bg-paper-sunken" /></div>
          )}
        </div>
      </div>
    </div>
  )
}
