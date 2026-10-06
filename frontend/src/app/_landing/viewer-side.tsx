"use client"

import { useMemo, useReducer, type ReactNode } from "react"
import { AnimatePresence, useReducedMotion } from "framer-motion"
import { motion } from "@/components/ui/motion"
import { TodoCard } from "@/components/todos/todo-card"
import { Button } from "@/components/ui/button"
import { DURATION_DELIBERATE, DURATION_FAST, DURATION_UI, EASE_EXIT, EASE_OUT_EXPO, EASE_STANDARD } from "@/lib/animations"
import {
  INITIAL_VIEWER_STATE,
  ownerStatus,
  sentenceFor,
  signalFor,
  viewerCardDone,
  viewerReducer,
  viewerStatus,
  type Signal,
  type StatusLabel,
} from "@/lib/landing-viewer"
import type { Todo } from "@/types/todo"
import { cn } from "@/lib/utils"
import { FIXTURE_OWNER_ID, SHARED_TASK } from "./fixtures"

const VIEWER_ID = "fx-viewer"

/**
 * Block 3 — two lists, one task.
 *
 * Victoria shares a task with you. Both copies are the shipped `TodoCard`, and every control on
 * them is wired: your card's own check circle ticks it off for you, its eye button hides it,
 * and Victoria's card's circle finishes it for everyone. The buttons under each list do the same
 * things for anyone who would rather not hunt for a circle.
 *
 * It used to set `isCompletedByViewer` on the todo — a field `TodoCard` never reads, since it
 * renders "done" from its `variant` prop — and hand the card no-op handlers, so "Tick it off
 * for me" did nothing and the card's own circle played its animation and snapped back. It
 * also told visitors a viewer "cannot reopen" their tick, which the product allows until the
 * owner has finished the task for everyone. The facts, and the state, are in
 * `lib/landing-viewer.ts`.
 *
 * The hidden copy is the server's projection, not a styled title: `HiddenTodoDtoFactory`
 * sends "Hidden task" with no author, no description, no audience list and none of the
 * owner's category — so that is exactly what your card is given.
 *
 * The line between the lists is an illustration of where a change goes, not a network
 * trace, and the sentence under them says the same thing in words (it is the block's one
 * live region). Both cards sit in boxes of reserved height, because a collapsed card is
 * shorter than an open one and the page below must not move.
 */
export function ViewerSide() {
  const [state, dispatch] = useReducer(viewerReducer, INITIAL_VIEWER_STATE)
  const signal = signalFor(state.last)
  const { viewerHidden, ownerDone, ownerHidden } = state
  const ownTick = state.viewerDone
  const viewerDone = viewerCardDone(state)

  // New objects per state: `TodoCard` is memoised on the todo's identity.
  const ownerTodo = useMemo<Todo>(
    () => ({ ...SHARED_TASK, isCompleted: ownerDone, hidden: ownerHidden }),
    [ownerDone, ownerHidden],
  )
  const viewerTodo = useMemo<Todo>(
    () =>
      viewerHidden && !viewerDone
        ? {
            ...SHARED_TASK,
            userId: "00000000-0000-0000-0000-000000000000",
            title: "Hidden task",
            description: undefined,
            authorName: undefined,
            categoryName: undefined,
            sharedWithUserIds: [],
            hasSharedAudience: true,
            hidden: true,
          }
        : {
            ...SHARED_TASK,
            hidden: false,
            ownerCompleted: ownerDone,
            isCompletedByViewer: ownTick,
          },
    [viewerHidden, viewerDone, ownerDone, ownTick],
  )

  return (
    <div>
      {/* The instruction lives in the section, under its heading, in the same place as every
          other block's; the board starts where every other block's content starts. */}
      <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_96px_minmax(0,1fr)] lg:gap-0">
        <Screen
          who="Victoria's list"
          initial="V"
          status={ownerStatus(state)}
          card={
            <TodoCard
              todo={ownerTodo}
              viewerId={FIXTURE_OWNER_ID}
              variant={state.ownerDone ? "completed" : "default"}
              onComplete={() => dispatch({ type: "owner-toggle-done" })}
              onToggleHidden={async () => dispatch({ type: "owner-toggle-hidden" })}
              onDelete={() => dispatch({ type: "owner-delete" })}
              onEdit={() => dispatch({ type: "open-card" })}
            />
          }
          actions={
            <Button
              variant="outline"
              onClick={() => dispatch({ type: "owner-toggle-done" })}
              aria-pressed={state.ownerDone}
            >
              {state.ownerDone ? "Let Victoria reopen it" : "Let Victoria finish it"}
            </Button>
          }
        />

        <SignalLine signal={signal} seq={state.seq} />

        <Screen
          who="Your list"
          initial="Y"
          status={viewerStatus(state)}
          card={
            <TodoCard
              todo={viewerTodo}
              viewerId={VIEWER_ID}
              variant={viewerDone ? "completed" : "default"}
              onComplete={() => dispatch({ type: "viewer-toggle-done" })}
              onToggleHidden={async () => dispatch({ type: "viewer-toggle-hidden" })}
              onDelete={() => undefined}
              // A collapsed card expands itself through onToggleHidden; an open one would
              // open the branch in the app, and says so here.
              onEdit={() => dispatch({ type: "open-card" })}
            />
          }
          actions={
            <>
              <Button
                variant="outline"
                onClick={() => dispatch({ type: "viewer-toggle-done" })}
                aria-pressed={state.viewerDone}
                disabled={state.ownerDone}
              >
                {state.viewerDone ? "Reopen it for yourself" : "Tick it off for yourself"}
              </Button>
              <Button
                variant="outline"
                onClick={() => dispatch({ type: "viewer-toggle-hidden" })}
                aria-pressed={state.viewerHidden}
                disabled={viewerDone}
              >
                {state.viewerHidden ? "Show it again" : "Hide it from your list"}
              </Button>
            </>
          }
        />
      </div>

      {/* The block's one live region. Reserved at two lines so a longer sentence never
          pushes the page below it. */}
      <div className="mt-8 flex min-h-12 flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <Sentence text={sentenceFor(state.last)} seq={state.seq} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => dispatch({ type: "reset" })}
          disabled={state.seq === 0 || state.last === "reset"}
        >
          Start over
        </Button>
      </div>
    </div>
  )
}

/** One person's screen: who it belongs to, where the task stands for them, the card, the controls. */
function Screen({
  who,
  initial,
  status,
  card,
  actions,
}: {
  who: string
  initial: string
  status: StatusLabel
  card: ReactNode
  actions: ReactNode
}) {
  return (
    <section
      aria-label={who}
      className="flex flex-col rounded-xl border border-line bg-paper-sunken p-4 sm:p-5"
    >
      <header className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid h-6 w-6 place-items-center rounded-full bg-ink text-caption font-bold text-paper"
          >
            {initial}
          </span>
          <span className="text-body-sm font-semibold text-ink">{who}</span>
        </span>
        <StatusPill status={status} />
      </header>
      {/* Reserved: the open card is the tallest state (166px, the card's control-rail
          floor), and the collapsed or completed card must not shorten the block. */}
      <div className="mt-4 min-h-[10.375rem]">{card}</div>
      <div className="mt-4 flex flex-wrap gap-2">{actions}</div>
    </section>
  )
}

function StatusPill({ status }: { status: StatusLabel }) {
  const done = status === "Done for you" || status === "Done for everyone"
  return (
    <span
      className={cn(
        // A fixed minimum so "Open" ↔ "Done for everyone" never reflows the header.
        "inline-flex min-w-36 justify-center rounded-full px-2.5 py-1 text-caption font-semibold",
        "transition-colors duration-fast",
        done ? "bg-positive-surface text-positive" : status === "Hidden" ? "bg-paper-muted text-ink" : "bg-paper text-ink-muted",
      )}
    >
      {status}
    </span>
  )
}

/**
 * The line between the two lists, and a dot that shows where the last change went.
 *
 * Your tick leaves your list and stops against a bar halfway: it stays with you. Victoria
 * finishing the task crosses all the way over. Transform only; under reduced motion the dot
 * is not drawn and the sentence carries the fact alone.
 *
 * Each dot is centred on the track by a static wrapper and moved by the node inside it.
 * The dot used to carry both jobs, and framer-motion writes the whole `transform`: the
 * first frame of `x` replaced the `-translate-y-1/2` that centred it, so every dot ran half
 * its own height below the line. The stop is the wall's near edge, not its centre, so a
 * refused change meets the bar instead of sinking into it.
 */
const DOT = 10
/** The side-by-side track is the 96px middle column; the stacked one is h-14. */
const TRACK_X = 96
const TRACK_Y = 56
/** The wall is 4px thick, centred on the track. */
const WALL_HALF = 2

function SignalLine({ signal, seq }: { signal: Signal; seq: number }) {
  const reduce = useReducedMotion() ?? false
  const crossing = signal === "owner-to-viewer"
  const travel = { duration: DURATION_DELIBERATE, ease: EASE_STANDARD, times: [0, 0.7, 1] }

  return (
    <div aria-hidden="true" className="relative flex h-14 items-center justify-center lg:h-auto">
      {/* The track: vertical between stacked screens, horizontal between side-by-side ones. */}
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line-strong lg:hidden" />
      <span className="absolute inset-x-0 top-1/2 hidden h-px -translate-y-1/2 bg-line-strong lg:block" />
      {/* The wall, halfway: what stops a viewer's change. It gives a little when one lands. */}
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <motion.span
          key={`wall-${signal === "stays-with-viewer" ? seq : "rest"}`}
          className="block h-1 w-6 rounded-full bg-ink-subtle lg:h-6 lg:w-1"
          animate={signal === "stays-with-viewer" && !reduce ? { scale: [1, 1, 1.35, 1] } : { scale: 1 }}
          transition={{ duration: DURATION_DELIBERATE, times: [0, 0.62, 0.72, 1], ease: EASE_STANDARD }}
        />
      </span>

      {!reduce && (
        <AnimatePresence>
          {signal && (
            <>
              <span key={`x-${seq}`} className="absolute inset-x-0 top-1/2 hidden h-2.5 -translate-y-1/2 lg:block">
                <motion.span
                  className="absolute left-0 top-0 h-2.5 w-2.5 rounded-full bg-ink"
                  initial={{ x: crossing ? 0 : TRACK_X - DOT, opacity: 1 }}
                  animate={{
                    x: crossing ? TRACK_X - DOT : TRACK_X / 2 + WALL_HALF,
                    opacity: [1, 1, 0],
                  }}
                  transition={travel}
                />
              </span>
              <span key={`y-${seq}`} className="absolute inset-y-0 left-1/2 w-2.5 -translate-x-1/2 lg:hidden">
                <motion.span
                  className="absolute left-0 top-0 h-2.5 w-2.5 rounded-full bg-ink"
                  initial={{ y: crossing ? 0 : TRACK_Y - DOT, opacity: 1 }}
                  animate={{
                    y: crossing ? TRACK_Y - DOT : TRACK_Y / 2 + WALL_HALF,
                    opacity: [1, 1, 0],
                  }}
                  transition={travel}
                />
              </span>
            </>
          )}
        </AnimatePresence>
      )}
    </div>
  )
}

function Sentence({ text, seq }: { text: string; seq: number }) {
  const reduce = useReducedMotion() ?? false
  return (
    <p aria-live="polite" className="relative text-body-sm font-semibold text-ink">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={seq}
          className="block"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: { duration: DURATION_UI, ease: EASE_OUT_EXPO } }}
          exit={
            reduce
              ? { opacity: 0, transition: { duration: DURATION_FAST } }
              : { opacity: 0, y: -8, transition: { duration: DURATION_FAST, ease: EASE_EXIT } }
          }
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </p>
  )
}
