import type { ReactNode } from "react"
import { FIELD_LABEL_CLASS } from "@/components/ui/field-label"
import { cn } from "@/lib/utils"

/**
 * The top of every signed-in page: an eyebrow, the one `h1`, a sentence, and the
 * page's own actions at the far end.
 *
 * Five pages wrote five: "WORKSPACE OVERVIEW" in a pill with 0.2em tracking, a
 * "WORKSPACE" eyebrow at 0.3em over a 44px title, "ORGANIZATION" in
 * sentence tracking over a 32px one, "ARCHIVE" under its own title, and a profile header
 * at 24px. Nothing about any of them was wrong alone; together they made moving between
 * tabs look like moving between products.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className={FIELD_LABEL_CLASS}>{eyebrow}</p> : null}
        <h1 className={cn("text-title font-bold tracking-tight text-ink sm:text-display-sm", eyebrow && "mt-2")}>
          {title}
        </h1>
        {description ? <p className="mt-2 max-w-2xl text-body text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

/**
 * The shape of `PageHeader` while a route streams in, so the real header lands on top of
 * it instead of re-setting the page below.
 *
 * Each bar is an inline-block holding a non-breaking space inside the SAME type classes as
 * the text it stands for, so its height is that text's line box by construction (the
 * title is 32px on phones and 38px from `sm`, not a number typed twice). `actions` draws the
 * placeholder the page's actions will occupy: pills (36px) or a button (44px), stacked
 * under the title on phones exactly as `PageHeader` stacks them.
 */
export function PageHeaderSkeleton({
  withSentence = true,
  actions,
}: {
  withSentence?: boolean
  actions?: "pills" | "button"
}) {
  const bar = "inline-block rounded-sm bg-paper-sunken"
  return (
    <div aria-hidden="true" className="flex animate-pulse flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-caption">
          <span className={cn(bar, "w-24")}>&nbsp;</span>
        </p>
        <p className="mt-2 text-title font-bold sm:text-display-sm">
          <span className={cn(bar, "w-48 rounded-md")}>&nbsp;</span>
        </p>
        {withSentence ? (
          <p className="mt-2 text-body">
            <span className={cn(bar, "w-72 max-w-full")}>&nbsp;</span>
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className={cn("flex-shrink-0 rounded-md bg-paper-sunken", actions === "pills" ? "h-9 w-48 rounded-full" : "h-11 w-full sm:w-40")} />
      ) : null}
    </div>
  )
}
