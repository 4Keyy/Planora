/**
 * A category card while the list loads: the card's own box — border, `p-5`, the 40px icon
 * and a text column of the name's and the description's line boxes — so each real card
 * replaces its placeholder at exactly the same height.
 */
export function CategoryCardSkeleton() {
  return (
    <div aria-hidden="true" className="animate-pulse rounded-lg border border-line bg-paper shadow-sm">
      <div className="flex items-center gap-4 p-5">
        <div className="h-10 w-10 flex-shrink-0 rounded-md bg-paper-sunken" />
        <div className="min-w-0 flex-1">
          <p className="text-body">
            <span className="inline-block w-1/2 rounded-sm bg-paper-sunken">&nbsp;</span>
          </p>
          <p className="mt-0.5 text-body-sm">
            <span className="inline-block w-3/4 rounded-sm bg-paper-sunken">&nbsp;</span>
          </p>
        </div>
      </div>
    </div>
  )
}
