import { cn } from "@/lib/utils"
import { WORDMARK_ARC, WORDMARK_GEOMETRY as mark } from "@/lib/brand-mark"

export { WORDMARK_ARC } from "@/lib/brand-mark"

/**
 * The product's name, and its mark, in one place.
 *
 * There were five wordmarks: the landing nav's 16px word, the footer's 14px word, the
 * app bar's 14px word behind a 6px dot, and the auth screens' 20px word behind a 7px
 * dot in `bg-gray-900` — each written where it was needed and none aware of the others.
 *
 * The mark is the private ring from `RedactionBadge`: a ring cut once at twelve o'clock
 * with you at the centre. It is the state every task starts in and the promise the
 * product is built around, so it doubles as the logo rather than inventing a second
 * symbol. It is drawn statically (no motion, no track): a logo is not a state that
 * changes.
 *
 * The shared geometry in `lib/brand-mark` also generates the browser and document icons.
 * The arc is copied from `redactionArc("private")` rather than imported, and a test holds
 * the two equal. `redaction-badge.tsx` is a client module, and a function imported from
 * one into a server component — this renders in the landing footer — arrives as a client
 * reference, not as something that can be called.
 */
export function Wordmark({
  size = "md",
  showName = true,
  className,
}: {
  size?: "sm" | "md"
  /** The mark alone, for a caller that animates the name in and out itself. */
  showName?: boolean
  className?: string
}) {
  const px = size === "sm" ? 16 : 20
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox={mark.viewBox} width={px} height={px} fill="none" aria-hidden="true" className="flex-shrink-0">
        <circle
          cx={mark.center}
          cy={mark.center}
          r={mark.radius}
          strokeWidth={mark.strokeWidth}
          strokeLinecap={mark.linecap}
          pathLength={1}
          strokeDasharray={`${WORDMARK_ARC.dash} ${WORDMARK_ARC.gap}`}
          strokeDashoffset={-WORDMARK_ARC.gap / 2}
          transform={mark.rotation}
          className="stroke-ink"
        />
        <circle cx={mark.center} cy={mark.center} r={mark.dotRadius} className="fill-ink" />
      </svg>
      {showName && (
        <span className={cn("font-bold tracking-tight text-ink", size === "sm" ? "text-body-sm" : "text-body")}>
          Planora
        </span>
      )}
    </span>
  )
}
