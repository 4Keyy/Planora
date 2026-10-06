import { PLATE_ROW, PLATE_SURFACE } from "@/components/todos/plate"
import { cn } from "@/lib/utils"

/**
 * The place a control plate will occupy, built from the plate's own class strings so the
 * real plate lands on it to the pixel — the old 84px placeholder sat under an 86px panel on
 * a desktop and a 78px one on a phone, and the list below moved when it arrived.
 */
export function CreatePlatePlaceholder() {
  return (
    <div aria-hidden="true" className={PLATE_SURFACE}>
      <div className={cn(PLATE_ROW, "h-20")} />
    </div>
  )
}

/**
 * The quick filter's place: a title row and, on phones, the actions row under it — the
 * same stack and gaps as `QuickFilterBar`.
 */
export function FilterPlatePlaceholder() {
  return (
    <div aria-hidden="true" className={PLATE_SURFACE}>
      <div className={cn(PLATE_ROW, "flex-col gap-4 py-4 sm:flex-row sm:items-center sm:py-0")}>
        <div className="h-11" />
        <div className="h-11 sm:hidden" />
      </div>
    </div>
  )
}
