"use client"

import { AnimatePresence, motion } from "framer-motion"
import { X, type LucideIcon } from "lucide-react"
import { NumberRoll } from "@/components/ui/number-roll"
import { EASE_OUT_EXPO, DURATION_UI, SPRING_STANDARD } from "@/lib/animations"
import { cn } from "@/lib/utils"

/**
 * What to do with the rows you have gathered.
 *
 * A multi-selection is only worth having if something can be done to all of it at
 * once, and the product had neither half: no way to select, and nothing to do with
 * a selection. The keyboard supplies the first (`x`, `Shift+↑/↓`, `⌘A` — see
 * `use-list-navigation.ts`); this is the second.
 *
 * It is a bar rather than a menu because the count is the important part. A menu
 * hides how many rows an action is about to touch behind a click, and "delete" is
 * not a word anybody should read without that number beside it. Here the number is
 * larger than the labels and rolls when it changes, so a selection that grew while
 * the user was reading cannot be missed.
 *
 * ## Why it announces, and why only once
 *
 * The bar is `role="status"` `aria-live="polite"`: appearing is news, and a
 * keyboard user who pressed `x` needs to hear that a selection now exists. The
 * *count* is deliberately outside the live region. It changes on every `x`, and a
 * region that re-announced on each one would talk over the list the user is moving
 * through — the same failure `UpdatePill` is built to avoid.
 *
 * ## Why it does not take the keyboard
 *
 * No shortcut triggers a bulk action. A destructive keystroke that acts on an
 * invisible set is the one keyboard affordance that cannot be taken back, so each
 * of these is a press, and the destructive one is marked as such.
 */

export interface SelectionAction {
  id: string
  label: string
  icon?: LucideIcon
  onRun: () => void
  /** Draws the action in the product's one saturated colour and puts it last. */
  destructive?: boolean
  /** Blocks re-entry while the action is in flight, without resizing the bar. */
  busy?: boolean
}

export interface SelectionBarProps {
  count: number
  actions: SelectionAction[]
  onClear: () => void
  /** Singular noun for what was selected. Pluralised internally. */
  noun?: string
  className?: string
}

export function SelectionBar({ count, actions, onClear, noun = "task", className }: SelectionBarProps) {
  const ordered = [...actions].sort((a, b) => Number(a.destructive ?? false) - Number(b.destructive ?? false))

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ ...SPRING_STANDARD, opacity: { duration: DURATION_UI, ease: EASE_OUT_EXPO } }}
          /*
           * `sticky`, not `toast`: a message about something that just happened has
           * to be able to appear over this bar, including the undo bar that a bulk
           * delete raises. The two would otherwise stack at the same height and the
           * later one would win by source order, which is not a decision anyone made.
           */
          className={cn(
            "pointer-events-none fixed inset-x-0 bottom-0 z-sticky flex justify-center px-4 pb-4 pb-safe",
            className,
          )}
        >
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-line bg-paper px-2 py-2 shadow-xl"
          >
            {/*
             * The count lives outside the announcement. The live region says a
             * selection exists; how many is read from here when the user arrives,
             * not shouted on every `x`.
             */}
            <span aria-hidden="true" className="flex items-center gap-1.5 px-3 text-body-sm font-semibold text-ink">
              <NumberRoll value={count} />
              <span className="font-medium text-ink-subtle">{count === 1 ? noun : `${noun}s`}</span>
            </span>

            <span className="h-6 w-px flex-shrink-0 bg-line" aria-hidden="true" />

            {ordered.map((action) => {
              const Icon = action.icon
              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={action.onRun}
                  disabled={action.busy}
                  aria-busy={action.busy || undefined}
                  /*
                   * The name carries the count. "Delete" alone is what the eye reads
                   * next to a number it can see; a screen-reader user gets no such
                   * adjacency, so the number goes into the name.
                   */
                  aria-label={`${action.label} ${count} ${count === 1 ? noun : `${noun}s`}`}
                  className={cn(
                    "inline-flex min-h-touch flex-shrink-0 items-center gap-2 rounded-full px-3.5 text-body-sm font-semibold",
                    "transition-colors duration-fast disabled:cursor-wait disabled:opacity-60",
                    action.destructive
                      ? "text-alert hover:bg-alert-surface"
                      : "text-ink-muted hover:bg-paper-sunken hover:text-ink",
                  )}
                >
                  {Icon && <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />}
                  <span>{action.label}</span>
                </button>
              )
            })}

            <span className="h-6 w-px flex-shrink-0 bg-line" aria-hidden="true" />

            <button
              type="button"
              onClick={onClear}
              aria-label="Clear the selection"
              className="inline-flex min-h-touch min-w-touch flex-shrink-0 items-center justify-center rounded-full text-ink-subtle transition-colors duration-fast hover:bg-paper-sunken hover:text-ink"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
