/**
 * A card on its way: the rail's centred circle, a title, a chip row and a date — the size of
 * an ordinary open card, which is what most of a list is. Cards have no height floor any
 * more (see EYE_CORNER_MIN_BODY in todo-card.tsx), so neither does this; the archive's
 * completed card is a title alone.
 */
export function TodoSkeleton({ completed = false }: { completed?: boolean }) {
  return (
    <div aria-hidden="true" className="animate-pulse rounded-lg border border-line bg-paper p-5 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="grid w-8 flex-shrink-0 grid-rows-[1fr_auto_1fr] justify-items-center self-stretch">
          <div className="row-start-2 h-8 w-8 rounded-full bg-paper-sunken" />
        </div>
        <div className="flex-1 space-y-3">
          <div className="h-5 w-3/4 rounded-sm bg-paper-sunken" />
          {!completed && <>
            <div className="flex gap-2">
              <div className="h-6 w-16 rounded-sm bg-paper-sunken" />
              <div className="h-6 w-10 rounded-sm bg-paper-sunken" />
            </div>
            <div className="h-4 w-1/2 rounded-sm bg-paper-sunken" />
          </>}
        </div>
      </div>
    </div>
  )
}
