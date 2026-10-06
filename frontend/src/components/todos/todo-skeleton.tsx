/**
 * A task card while its data is on the way: the same radius, border, padding and control
 * rail as `TodoCard`, so the real card replaces it without anything moving. It used to
 * be a 20px-radius box with 24px padding and a 24px circle, beside cards that are 16px,
 * 20px and 32px — the list visibly re-set itself when it arrived.
 *
 * The rail is the card's own `1fr auto 1fr` grid: the circle on the vertical centre and the
 * hide toggle's slot under it, which gives the placeholder the open card's 166px floor.
 */
export function TodoSkeleton() {
  return (
    <div aria-hidden="true" className="animate-pulse rounded-lg border border-line bg-paper p-5 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="grid w-8 flex-shrink-0 grid-rows-[1fr_auto_1fr] justify-items-center self-stretch">
          <div className="row-start-2 h-8 w-8 rounded-full bg-paper-sunken" />
          {/* The hide toggle's slot: a bare glyph at rest, so nothing is drawn here. */}
          <div className="row-start-3 mb-0.5 mt-4 h-7 w-7 self-end" />
        </div>
        <div className="flex-1 space-y-3">
          <div className="h-5 w-3/4 rounded-sm bg-paper-sunken" />
          <div className="flex gap-2">
            <div className="h-6 w-16 rounded-sm bg-paper-sunken" />
            <div className="h-6 w-10 rounded-sm bg-paper-sunken" />
          </div>
          <div className="h-4 w-1/2 rounded-sm bg-paper-sunken" />
        </div>
      </div>
    </div>
  )
}
