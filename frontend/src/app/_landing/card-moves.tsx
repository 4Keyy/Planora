"use client"

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { AnimatePresence, useInView, useReducedMotion } from "framer-motion"
import { motion } from "@/components/ui/motion"
import { AlarmClock, Check, Palette, Users, Zap } from "lucide-react"
import { TodoCard } from "@/components/todos/todo-card"
import { Button } from "@/components/ui/button"
import {
  DURATION_FAST,
  DURATION_UI,
  EASE_EXIT,
  EASE_OUT_EXPO,
  SPRING_GENTLE,
  TAP_PRESS,
} from "@/lib/animations"
import {
  buildCard,
  CARD_OWNER_ID,
  CATEGORIES,
  categoryOf,
  explainMove,
  INITIAL_CARD,
  nextCategory,
  nextUrgency,
  URGENCIES,
  type CardState,
  type Move,
} from "@/lib/landing-card"
import { cn } from "@/lib/utils"

/**
 * Block 5 — one card, five moves.
 *
 * The product's own `TodoCard` sits on a stage, and five large moves under it turn on the
 * things users actually run into on their tasks:
 *
 * 1. **Category** cycles Home → Work → Travel → none. The card takes the category's chip and
 *    its big watermark icon, its hover shadow glows in the category's colour, and the stage
 *    behind it picks the colour up too.
 * 2. **Share** frames the card in blue, opens the ring for two and adds the workers chip.
 * 3. **Urgency** cycles urgent → overdue → calm: the full priority bar and the red frame, then
 *    a date two days gone and "Overdue". Red outranks blue.
 * 4. **Take it** puts you on it: the check turns the category's colour, and on a shared task
 *    the chip turns blue and counts you in.
 * 5. **Finish** presses the card's own circle, so it is the product's completion that runs —
 *    the burst, the sweep, the drawn check — and the card steps back onto grey.
 *
 * The card stays live under all of it: its eye folds it to one line and a press opens it
 * again, its right edge deletes it (and "Make another" brings it back), and hovering shows
 * the lift and the glow. It replaced a builder with a title field and some twenty buttons,
 * which asked the visitor to make a task when the point was to see what a card says.
 *
 * Rules kept: the block is pure local state (no `api`, no global stores, no realtime); the
 * card's box is reserved at its tallest state so no move shifts the page; the date exists
 * only after mount, computed from the visitor's clock; the sentence under the card is the
 * block's one live region; the first move sends out one hint ring on first sight if nothing
 * has been pressed, and nothing moves at rest after that.
 */
export function CardMoves() {
  const reduce = useReducedMotion() ?? false
  const [state, setState] = useState<CardState>(INITIAL_CARD)
  const [move, setMove] = useState<Move | null>(null)
  const [now, setNow] = useState<Date | null>(null)
  const [folded, setFolded] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [touched, setTouched] = useState(false)
  const [hint, setHint] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const firstMoveRef = useRef<HTMLButtonElement>(null)
  /*
   * Where focus goes next. Deleting the card unmounts the control that was focused, and
   * "Make another" unmounts itself in turn; either way focus fell to <body> and the next Tab
   * started over at the top of the page. Callback refs put it on the thing that replaced it.
   */
  const focusNext = useRef<"another" | null>(null)
  const anotherRef = useCallback((node: HTMLButtonElement | null) => {
    if (node && focusNext.current === "another") {
      focusNext.current = null
      node.focus()
    }
  }, [])
  const seen = useInView(stageRef, { once: true, amount: 0.5 })

  // The clock, known only on the client: the server render and the first client one agree.
  useEffect(() => setNow(new Date()), [])

  useEffect(() => {
    if (!seen || touched || reduce) return
    const t = setTimeout(() => setHint(true), 1400)
    return () => clearTimeout(t)
  }, [seen, touched, reduce])

  const todo = useMemo(() => ({ ...buildCard(state, now), hidden: folded }), [state, now, folded])
  const category = categoryOf(state.category)

  const apply = (m: Move, patch: (s: CardState) => Partial<CardState>) => {
    setTouched(true)
    setHint(false)
    setFolded(false)
    setDeleted(false)
    setState((s) => ({ ...s, ...patch(s) }))
    setMove(m)
  }

  /**
   * Finish presses the card's own circle, so the completion that plays is the product's and
   * not an imitation of it. Folded or deleted, there is no circle to press, and the state
   * simply changes.
   */
  const finish = () => {
    const label = state.done ? "Mark as incomplete" : "Mark as complete"
    const circle = stageRef.current?.querySelector<HTMLButtonElement>(`[data-task-card] button[aria-label="${label}"]`)
    if (circle && !folded && !deleted) {
      setTouched(true)
      setHint(false)
      circle.click()
    } else {
      apply("finish", (s) => ({ done: !s.done, working: false }))
    }
  }

  const MOVES: {
    id: Move
    label: string
    value: string
    on: boolean
    icon: ReactNode
    /** The disc's colour while on — the effect's own colour on the card. */
    tone: string | { color: string }
    kind: MoveKind
    steps?: { count: number; at: number }
    run: () => void
  }[] = [
    {
      id: "category",
      kind: "cycle",
      label: "Category",
      value: category.name ?? "None",
      on: category.id !== "none",
      icon: <Palette className="h-5 w-5" aria-hidden="true" />,
      tone: category.color ? { color: category.color } : "bg-ink text-paper",
      steps: { count: CATEGORIES.length, at: CATEGORIES.indexOf(category) },
      run: () => apply("category", (s) => ({ category: nextCategory(s.category) })),
    },
    {
      id: "share",
      kind: "toggle",
      label: "Share",
      value: state.shared ? "Victoria & Tom" : "Only you",
      on: state.shared,
      icon: <Users className="h-5 w-5" aria-hidden="true" />,
      tone: "bg-accent text-paper",
      run: () => apply("share", (s) => ({ shared: !s.shared })),
    },
    {
      id: "urgency",
      kind: "cycle",
      label: "Urgency",
      value: state.urgency === "urgent" ? "Urgent" : state.urgency === "overdue" ? "Two days late" : "Calm",
      on: state.urgency !== "calm",
      icon: <AlarmClock className="h-5 w-5" aria-hidden="true" />,
      tone: "bg-alert text-paper",
      steps: { count: URGENCIES.length, at: URGENCIES.indexOf(state.urgency) },
      run: () => apply("urgency", (s) => ({ urgency: nextUrgency(s.urgency) })),
    },
    {
      id: "work",
      kind: "toggle",
      label: "Take it",
      value: state.working ? "You're on it" : "Nobody yet",
      on: state.working && !state.done,
      icon: <Zap className="h-5 w-5" aria-hidden="true" />,
      tone: "bg-ink text-paper",
      run: () => apply("work", (s) => ({ working: !s.working, done: false })),
    },
    {
      id: "finish",
      kind: "action",
      label: state.done ? "Reopen" : "Finish",
      value: state.done ? "Done" : "Press the circle",
      on: state.done,
      icon: <Check className="h-5 w-5" strokeWidth={2.5} aria-hidden="true" />,
      tone: "bg-positive text-paper",
      run: finish,
    },
  ]

  const sentence = explainMove(move, state)

  return (
    <div className="rounded-xl border border-line bg-paper-raised p-4 shadow-lg sm:p-6">
      {/* ── The stage. ── */}
      <div
        ref={stageRef}
        className={cn(
          "relative overflow-hidden rounded-lg bg-paper-sunken px-4 py-8 sm:px-10 sm:py-12",
          "bg-[radial-gradient(var(--pl-ink-faint)_1px,transparent_1px)] [background-size:16px_16px]"
        )}
      >
        {/* The category's colour, behind the card: the stage takes it up as the card does. */}
        <AnimatePresence initial={false}>
          {category.color && !state.done ? (
            <motion.span
              key={category.id}
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-1/2 h-72 w-[36rem] max-w-full -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
              style={{ backgroundColor: category.color }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.16 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : DURATION_UI * 2, ease: EASE_OUT_EXPO }}
            />
          ) : null}
        </AnimatePresence>

        {/* Reserved at the card's tallest state (shared, taken, overdue, with its note). */}
        <div className="relative mx-auto flex min-h-60 max-w-md flex-col justify-center">
          <AnimatePresence mode="wait" initial={false}>
            {deleted ? (
              <motion.div
                key="deleted"
                className="flex min-h-40 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-line-strong bg-paper p-6 text-center"
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO }}
              >
                <p className="text-body-sm font-semibold text-ink">Deleted. In the app you&rsquo;d get five seconds to undo.</p>
                <Button
                  ref={anotherRef}
                  variant="outline"
                  onClick={() => {
                    setDeleted(false)
                    setMove(null)
                    firstMoveRef.current?.focus()
                  }}
                >
                  Make another
                </Button>
              </motion.div>
            ) : (
              <motion.div key="card" exit={{ opacity: 0, transition: { duration: DURATION_FAST } }}>
                <TodoCard
                  todo={todo}
                  viewerId={CARD_OWNER_ID}
                  variant={state.done ? "completed" : "default"}
                  onComplete={() => {
                    setState((s) => ({ ...s, done: !s.done, working: false }))
                    setMove("finish")
                  }}
                  onToggleHidden={async () => {
                    setTouched(true)
                    setFolded((f) => !f)
                  }}
                  onDelete={() => {
                    setTouched(true)
                    focusNext.current = "another"
                    setDeleted(true)
                  }}
                  // Pressing the card opens its branch in the app; here the moves are the point.
                  onEdit={() => undefined}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* The block's one live region, reserved at its longest: three lines on a phone,
          two from `sm`, so no move can push the tiles below it. */}
      <p aria-live="polite" className="relative mx-auto mt-5 min-h-16 max-w-2xl text-pretty text-center text-body-sm font-semibold text-ink sm:min-h-12">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={sentence}
            className="block"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: DURATION_UI, ease: EASE_OUT_EXPO } }}
            exit={{ opacity: 0, y: reduce ? 0 : -8, transition: { duration: DURATION_FAST, ease: EASE_EXIT } }}
          >
            {sentence}
          </motion.span>
        </AnimatePresence>
      </p>

      {/* ── The five moves. ── */}
      <div role="group" aria-label="Moves for the card" className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {MOVES.map((m, i) => (
          <MoveTile
            key={m.id}
            label={m.label}
            value={m.value}
            on={m.on}
            icon={m.icon}
            tone={m.tone}
            kind={m.kind}
            steps={m.steps}
            ref={i === 0 ? firstMoveRef : undefined}
            hint={hint && i === 0}
            onHintDone={() => setHint(false)}
            onPress={m.run}
            className={i === MOVES.length - 1 ? "col-span-2 sm:col-span-1" : undefined}
          />
        ))}
      </div>

      <p className="mt-5 text-center text-caption text-ink-muted">
        Nothing here is saved, and the people are made up. The card itself is live: its eye folds
        it, its right edge deletes it.
      </p>
    </div>
  )
}

type MoveKind = "toggle" | "cycle" | "action"

/**
 * One move, and what it tells a screen reader depends on what kind it is:
 *
 * - a **toggle** (Share, Take it) keeps a fixed name and announces its pressed state; what it
 *   is set to now is its description, so the name never changes under the pressed state;
 * - a **cycle** (Category, Urgency) has no pressed state — three or four states have no
 *   "pressed" — so its name says what it is now and that a press moves on, and a row of dots
 *   shows where it is in the cycle;
 * - an **action** (Finish, then Reopen) is a plain button named for what it will do.
 *
 * The icon sits on top at every width: on a 360px phone a tile's text column is about 60px,
 * and a label with its dots beside it did not fit on one line.
 */
const MoveTile = forwardRef<
  HTMLButtonElement,
  {
    label: string
    value: string
    on: boolean
    icon: ReactNode
    tone: string | { color: string }
    kind: MoveKind
    steps?: { count: number; at: number }
    hint: boolean
    onHintDone: () => void
    onPress: () => void
    className?: string
  }
>(function MoveTile({ label, value, on, icon, tone, kind, steps, hint, onHintDone, onPress, className }, ref) {
  const reduce = useReducedMotion() ?? false
  const toneClass = typeof tone === "string" ? tone : "text-paper"
  const toneStyle = typeof tone === "string" ? undefined : { backgroundColor: tone.color }
  const valueId = `move-${label.toLowerCase().replace(/\s+/g, "-")}-value`

  return (
    <motion.button
      ref={ref}
      type="button"
      onClick={onPress}
      aria-pressed={kind === "toggle" ? on : undefined}
      aria-label={kind === "cycle" ? `${label}: ${value}. Press for the next one.` : label}
      aria-describedby={kind === "cycle" ? undefined : valueId}
      whileTap={reduce ? undefined : TAP_PRESS}
      className={cn(
        "group relative flex min-h-touch flex-col items-start gap-3 rounded-xl border p-3 text-left transition-[border-color,background-color,box-shadow] duration-fast sm:p-4",
        on ? "border-ink bg-paper shadow-md" : "border-line bg-paper-raised hover:border-line-strong hover:bg-paper",
        className
      )}
    >
      {hint && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-xl border-2 border-ink"
          initial={{ opacity: 0.6, scale: 1 }}
          animate={{ opacity: 0, scale: 1.06 }}
          transition={{ duration: 0.9, ease: EASE_OUT_EXPO, repeat: 1, repeatDelay: 0.2 }}
          onAnimationComplete={onHintDone}
        />
      )}
      <span className="flex w-full items-start justify-between gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "grid h-10 w-10 flex-shrink-0 place-items-center rounded-full transition-colors duration-fast",
            on ? toneClass : "bg-paper-sunken text-ink-muted group-hover:text-ink"
          )}
          style={on ? toneStyle : undefined}
        >
          <motion.span
            key={on ? "on" : "off"}
            className="grid place-items-center"
            initial={reduce ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={SPRING_GENTLE}
          >
            {icon}
          </motion.span>
        </span>
        {steps ? (
          <span aria-hidden="true" className="mt-1.5 flex gap-1">
            {Array.from({ length: steps.count }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 w-1.5 rounded-full transition-colors duration-fast",
                  i === steps.at ? "bg-ink" : "bg-line-strong"
                )}
              />
            ))}
          </span>
        ) : null}
      </span>
      <span className="w-full min-w-0">
        <span className="block text-body-sm font-bold text-ink">{label}</span>
        <span id={valueId} className="mt-0.5 block truncate text-caption text-ink-muted">
          {value}
        </span>
      </span>
    </motion.button>
  )
})
