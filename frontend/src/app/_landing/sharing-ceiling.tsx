"use client"

import { useState } from "react"
import { Minus, Plus } from "lucide-react"
import { RedactionBadge } from "@/components/ui/redaction-badge"
import { NumberRoll } from "@/components/ui/number-roll"
import { FIELD_LABEL_CLASS } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { ceilingCaption, isAtSharingCeiling, SHARING_CEILING } from "@/lib/landing-audience"

const MAX = 10

/**
 * Block 2 — the ceiling of sharing.
 *
 * The cut opens from 16% and widens 4.5% per viewer, saturating at 50%: past half a
 * circle the mark stops reading as a ring. A visitor left to find that alone would
 * push the count to ten, watch a motionless arc and conclude the mark is decorative,
 * so this block walks them into the ceiling on purpose and names it.
 *
 * The closed ring appears exactly once, and only as a mark. `showLabel={false}` with
 * no `onClick` is the component's `aria-hidden` mark-only branch, so the ring is
 * decorative and the prose beside it carries the fact. That is not tidiness: the
 * labelled variant would announce "Public", a sentence that is false about every task
 * in this product, and it would be the only thing a screen-reader user was told about
 * that ring.
 */
export function SharingCeiling() {
  const [count, setCount] = useState(3)
  const atCeiling = isAtSharingCeiling(count)

  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
      <div className="rounded-lg border border-line bg-paper-raised p-6 shadow-sm sm:p-7">
        <p className={FIELD_LABEL_CLASS}>Viewers</p>

        <div className="mt-4 flex min-h-control items-center">
          <RedactionBadge audience="shared" viewerCount={count} size="md" />
        </div>

        <div className="mt-5 flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCount((c) => Math.max(0, c - 1))}
            disabled={count === 0}
            aria-label="Remove a viewer"
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </Button>

          {/* Reserved two-column width: 9 → 10 must not shove the buttons sideways. */}
          <span className="text-title font-bold tabular-nums text-ink">
            <NumberRoll value={count} minDigits={2} />
          </span>

          <Button
            variant="outline"
            size="icon"
            onClick={() => setCount((c) => Math.min(MAX, c + 1))}
            disabled={count === MAX}
            aria-label="Add a viewer"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        <p
          className="mt-5 text-body-sm text-ink-muted"
          aria-live="polite"
        >
          {ceilingCaption(count)}
        </p>

        {atCeiling ? (
          <p className="mt-2 text-caption font-semibold uppercase tracking-wider text-warn">
            The mark has stopped widening
          </p>
        ) : (
          <p className="mt-2 text-caption text-ink-subtle">
            Widens until {SHARING_CEILING}
          </p>
        )}
      </div>

      <div>
        <div className="flex items-center gap-3">
          {/* The one closed ring on the page — decorative, aria-hidden, prose carries the fact. */}
          <RedactionBadge audience="public" showLabel={false} size="md" />
          <p className="text-body-sm font-semibold uppercase tracking-wider text-ink-muted">
            The state Planora cannot enter
          </p>
        </div>

        <p className="mt-4 text-body text-ink-muted">
          A closed ring would mean anyone could read the task. There is no publish button and no
          link to hand out: the editor writes <code className="text-body-sm">isPublic: false</code>{" "}
          on every save, and no route serves a task to an anonymous reader. Sharing stops at people
          you invited by email and who accepted.
        </p>

        {/* The page's one roadmap marker. An aside: no icon, no accent, no heading tag,
            so it cannot be skimmed as a feature. */}
        <div className="mt-6 rounded-md border border-line bg-paper-sunken p-5">
          <p className="text-caption font-semibold uppercase tracking-wider text-ink-muted">
            Not built — on the roadmap
          </p>
          <p className="mt-2 text-body-sm text-ink-muted">
            Showing different people different subsets of a task&rsquo;s fields. Today the only
            field-level behaviour that exists is that a task you hide from one person shows them
            the words &ldquo;Hidden task&rdquo;. This line stays here until that changes.
          </p>
        </div>
      </div>
    </div>
  )
}
