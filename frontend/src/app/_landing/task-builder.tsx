"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion"
import { Check, Globe2, Plus } from "lucide-react"
import { TodoCard } from "@/components/todos/todo-card"
import { Field, FIELD_LABEL_CLASS } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Avatar } from "@/components/ui/avatar"
import { PriorityMeter } from "@/components/ui/priority-meter"
import { RedactionBadge } from "@/components/ui/redaction-badge"
import { InkCheck } from "@/components/ui/ink-check"
import { ICON_MAP } from "@/lib/icon-map"
import { DURATION_FAST, DURATION_UI, EASE_EXIT, EASE_OUT_EXPO, TAP_PRESS } from "@/lib/animations"
import {
  BUILDER_OWNER_ID,
  buildTodo,
  CATEGORIES,
  DEFAULT_TITLE,
  explainerFor,
  INITIAL_BUILDER,
  LEVELS,
  litSignals,
  PRIORITY_NAME,
  SHARE_PEOPLE,
  SIGNALS,
  STATUSES,
  toggleAllFriends,
  togglePerson,
  whenOptions,
  type BuilderState,
  type Change,
  type SignalId,
  type StatusId,
} from "@/lib/landing-task-builder"
import { cn } from "@/lib/utils"

/**
 * Block 5 — make one, and see what it says.
 *
 * The visitor names a task and dresses it, and the product's own `TodoCard` assembles itself
 * beside the controls. Under the card a legend names every signal a card can show — the red
 * frame, the priority bar, the ring, the in-progress tint, the finished surface — and lights
 * the ones this card is showing right now. A list of features is a brochure; a card that
 * changes while its legend says why is the product explaining itself.
 *
 * The block used to show a card and one sentence, and nothing on it ever turned red, closed
 * its ring or went into progress: the controls could not produce those states, so the
 * product's most visible signals were the ones the landing page never showed. "Today",
 * "All friends" and "In progress" are here for exactly that reason.
 *
 * Every handler on the card is live. Its circle ticks the task off (and back); its eye folds
 * it away and a press opens it again; a press on its body puts you in the title field, which
 * is what editing is; its delete takes it away and offers another. The sentence under the
 * card says what the last change means, and it is the block's one live region.
 *
 * Dates are computed from the moment of the click (`lib/landing-task-builder.ts`). Until the
 * clock is known the weekday option reads "In three days" and "Today" carries no date, so the
 * server and the first client render agree.
 *
 * On first sight, if untouched, the default title types itself in, so the card visibly
 * responds to the field before anyone has touched it. Any focus or key in the field
 * finishes it at once.
 */
export function TaskBuilder() {
  const reduce = useReducedMotion() ?? false
  const [state, setState] = useState<BuilderState>(INITIAL_BUILDER)
  const [change, setChange] = useState<Change | null>(null)
  const [now, setNow] = useState<Date | null>(null)
  const [deleted, setDeleted] = useState(false)
  const [folded, setFolded] = useState(false)
  const [typed, setTyped] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const seen = useInView(rootRef, { once: true, amount: 0.4 })
  const touched = useRef(false)

  // The clock, known only on the client — see the header.
  useEffect(() => setNow(new Date()), [])

  // The title types itself in once, on first sight, unless someone got there first.
  useEffect(() => {
    if (!seen || reduce || touched.current) return
    let i = 0
    setTyped(0)
    const id = setInterval(() => {
      i += 1
      if (i >= DEFAULT_TITLE.length || touched.current) {
        clearInterval(id)
        setTyped(null)
        return
      }
      setTyped(i)
    }, 700 / DEFAULT_TITLE.length)
    return () => clearInterval(id)
  }, [seen, reduce])

  const touch = () => {
    touched.current = true
    setTyped(null)
  }

  // A patch may be computed from the latest state, so two presses inside one frame (a
  // double tap across two chips) both land instead of the second undoing the first.
  const update = (patch: Partial<BuilderState> | ((s: BuilderState) => Partial<BuilderState>), what: Change) => {
    touch()
    setState((s) => ({ ...s, ...(typeof patch === "function" ? patch(s) : patch) }))
    setChange(what)
  }

  const todo = useMemo(() => {
    const built = buildTodo(
      typed === null ? state : { ...state, title: DEFAULT_TITLE.slice(0, Math.max(1, typed)) },
      now
    )
    return { ...built, hidden: folded }
  }, [state, typed, now, folded])
  const when = whenOptions(now)
  const lit = litSignals(state, now)
  const done = state.status === "done"

  const setStatus = (status: StatusId) => {
    if (status === state.status) return
    setFolded(false)
    update({ status }, status === "done" ? "done" : status === "working" ? "working" : state.status === "done" ? "undone" : "todo")
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        "grid grid-cols-1 gap-10 rounded-xl border border-line bg-paper-raised p-6 shadow-lg sm:p-10",
        "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-14 lg:gap-y-6"
      )}
    >
      {/* ── Three grid items in reading order for a phone — the card, the controls, the
          legend — placed into two columns on wide screens: controls on the left through
          both rows, the card above its legend on the right. On a phone the legend used to
          sit between the card and the controls, five rows of reading before the first
          thing you could press. ── */}
      <div className="lg:col-start-2 lg:row-start-1">
        <div
          className={cn(
            "relative rounded-lg bg-paper-sunken p-4 sm:p-6",
            "bg-[radial-gradient(var(--pl-ink-faint)_1px,transparent_1px)] [background-size:16px_16px]"
          )}
        >
          {/* Reserved for the largest card (every option on), so the page never moves. */}
          <div className="flex min-h-56 flex-col justify-center">
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
                  <p className="text-body-sm font-semibold text-ink">Deleted. That&rsquo;s all it takes.</p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDeleted(false)
                      setChange(null)
                    }}
                  >
                    Make another
                  </Button>
                </motion.div>
              ) : (
                <motion.div key="card" exit={{ opacity: 0, transition: { duration: DURATION_FAST } }}>
                  <TodoCard
                    todo={todo}
                    viewerId={BUILDER_OWNER_ID}
                    variant={done ? "completed" : "default"}
                    onComplete={() => setStatus(done ? "todo" : "done")}
                    onToggleHidden={async () => {
                      touch()
                      setFolded((f) => !f)
                      setChange(folded ? "unfold" : "fold")
                    }}
                    onDelete={() => {
                      touch()
                      setDeleted(true)
                    }}
                    onEdit={() => {
                      touch()
                      inputRef.current?.focus()
                      inputRef.current?.select()
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Off the dots, on plain paper: the sentence is read, the stage is looked at. */}
        <p aria-live="polite" className="relative mt-4 min-h-10 text-pretty text-body-sm font-semibold text-ink">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={change ?? "idle"}
              className="block"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { duration: DURATION_UI, ease: EASE_OUT_EXPO } }}
              exit={{ opacity: 0, y: reduce ? 0 : -8, transition: { duration: DURATION_FAST, ease: EASE_EXIT } }}
            >
              {explainerFor(change)}
            </motion.span>
          </AnimatePresence>
        </p>
      </div>

      {/* ── The controls. ── */}
      <div className="flex flex-col gap-7 lg:col-start-1 lg:row-span-2 lg:row-start-1">
        <Field label="Task">
          {(field) => (
            <Input
              {...field}
              ref={inputRef}
              value={typed === null ? state.title : DEFAULT_TITLE.slice(0, Math.max(1, typed))}
              maxLength={60}
              autoComplete="off"
              onFocus={touch}
              onChange={(e) => update({ title: e.target.value }, "title")}
            />
          )}
        </Field>

        <Group label="How much it matters" id="tb-priority">
          <div className="flex gap-2">
            {LEVELS.map((level) => (
              <motion.button
                key={level}
                type="button"
                whileTap={reduce ? undefined : TAP_PRESS}
                onClick={() => update({ level }, level === 5 ? "urgent" : "priority")}
                aria-pressed={state.level === level}
                aria-label={`Priority ${level} of 5, ${PRIORITY_NAME[level]}`}
                className={cn(
                  "inline-flex h-control w-control items-center justify-center rounded-md border text-body-sm font-bold tabular-nums transition-colors duration-fast",
                  state.level === level
                    ? "border-ink bg-ink text-paper"
                    : "border-line-strong bg-paper text-ink hover:bg-paper-sunken"
                )}
              >
                {level}
              </motion.button>
            ))}
          </div>
          <p className="mt-2 text-caption font-semibold text-ink-muted">{PRIORITY_NAME[state.level]}</p>
        </Group>

        <Group label="When" id="tb-when">
          <div className="flex flex-wrap gap-2">
            {when.map((option) => (
              <Chip
                key={option.id}
                on={state.when === option.id}
                onClick={() => update({ when: option.id }, option.id === "today" ? "today" : "when")}
                // Reserved to the longest weekday so the label resolving after mount moves nothing.
                className={option.id === "soon" ? "min-w-32 justify-center" : undefined}
              >
                {option.label}
              </Chip>
            ))}
          </div>
        </Group>

        <Group label="Category" id="tb-category">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => {
              const Icon = c.icon ? ICON_MAP[c.icon] : null
              return (
                <Chip key={c.id} on={state.category === c.id} onClick={() => update({ category: c.id }, "category")}>
                  {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
                  {c.name ?? "No category"}
                </Chip>
              )
            })}
          </div>
        </Group>

        <Group label="Who sees it" id="tb-share">
          <div className="flex flex-wrap gap-2">
            {SHARE_PEOPLE.map((p) => {
              const on = state.share.includes(p.id)
              return (
                <Chip
                  key={p.id}
                  on={on}
                  onClick={() => update((s) => togglePerson(s, p.id), "share")}
                  label={`Share with ${p.firstName}`}
                  className="pl-1.5"
                >
                  <span aria-hidden="true" className="inline-flex">
                    <Avatar firstName={p.firstName} lastName={p.lastName} size={24} />
                  </span>
                  {p.firstName}
                  {on ? <Check className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                </Chip>
              )
            })}
            <Chip on={state.allFriends} onClick={() => update(toggleAllFriends, state.allFriends ? "share" : "public")}>
              <Globe2 className="h-4 w-4" aria-hidden="true" />
              All friends
            </Chip>
          </div>
        </Group>

        <Group label="Where it stands" id="tb-status">
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <Chip key={s.id} on={state.status === s.id} onClick={() => setStatus(s.id)}>
                {s.label}
              </Chip>
            ))}
          </div>
        </Group>

        <Group label="Note" id="tb-note">
          <Chip on={state.note} onClick={() => update((s) => ({ note: !s.note }), "note")}>
            {state.note ? <Check className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            Add a note
          </Chip>
        </Group>

        <p className="text-caption text-ink-muted">
          Nothing here is saved. The card is the app&rsquo;s own, on your made-up task.
        </p>
      </div>

      {/* The legend. Every row is always there — the block's height never depends on the
          card — and the rows the card is showing now are lit. */}
      <div className="lg:col-start-2 lg:row-start-2">
        <p className={FIELD_LABEL_CLASS}>What the card is telling you</p>
        <ul className="mt-3 flex flex-col gap-2">
          {SIGNALS.map((signal) => (
            <SignalRow key={signal.id} name={signal.name} line={signal.line} lit={lit[signal.id]}>
              <SignalMark id={signal.id} state={state} />
            </SignalRow>
          ))}
        </ul>
      </div>
    </div>
  )
}

/**
 * One legend row. Lit rows get the same left bar as the ring legend in block 2, so "this is
 * the one that applies" is drawn one way across the page. Several can be lit at once here,
 * so each bar grows on its own rather than travelling between rows.
 */
function SignalRow({ name, line, lit, children }: { name: string; line: string; lit: boolean; children: ReactNode }) {
  const reduce = useReducedMotion() ?? false
  return (
    <li
      className={cn(
        "relative flex items-center gap-4 overflow-hidden rounded-md border px-4 py-3 transition-colors duration-fast",
        lit ? "border-ink bg-paper" : "border-line"
      )}
    >
      <motion.span
        aria-hidden="true"
        className="absolute inset-y-2 left-0 w-1 origin-center rounded-r-full bg-ink"
        initial={false}
        animate={{ scaleY: lit ? 1 : 0, opacity: lit ? 1 : 0 }}
        transition={reduce ? { duration: 0 } : { duration: DURATION_UI, ease: EASE_OUT_EXPO }}
      />
      <span
        aria-hidden="true"
        className={cn(
          "grid w-10 flex-shrink-0 place-items-center transition-opacity duration-fast",
          lit ? "opacity-100" : "opacity-50"
        )}
      >
        {children}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-sm font-bold text-ink">
          {name}
          {lit && <span className="sr-only"> (on the card now)</span>}
        </span>
        <span className="mt-0.5 block text-pretty text-body-sm text-ink-muted">{line}</span>
      </span>
    </li>
  )
}

/** Each signal drawn the way the card draws it, small. */
function SignalMark({ id, state }: { id: SignalId; state: BuilderState }) {
  const tint = CATEGORIES.find((c) => c.id === state.category)?.color ?? null
  switch (id) {
    case "frame":
      return <span className="h-6 w-9 rounded-sm border-2 border-alert bg-paper" />
    case "meter":
      return <PriorityMeter value={state.level} size="sm" showValue={false} />
    case "ring":
      return state.allFriends ? (
        <RedactionBadge audience="public" showLabel={false} />
      ) : (
        <RedactionBadge audience="shared" viewerCount={Math.max(1, state.share.length)} showLabel={false} />
      )
    case "work":
      return (
        // The card's own in-progress control: a ring and a still dot, in the category's
        // colour when it has one — the colour is the user's data, so it arrives inline.
        <span
          className={cn("grid h-6 w-6 place-items-center rounded-full border-2", !tint && "border-ink text-ink")}
          style={tint ? { borderColor: tint, color: tint } : undefined}
        >
          <span className="h-2 w-2 rounded-full bg-current" />
        </span>
      )
    case "done":
      return <InkCheck size={20} />
  }
}

function Group({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div role="group" aria-labelledby={id}>
      <p id={id} className={FIELD_LABEL_CLASS}>
        {label}
      </p>
      <div className="mt-3">{children}</div>
    </div>
  )
}

function Chip({
  on,
  onClick,
  label,
  className,
  children,
}: {
  on: boolean
  onClick: () => void
  /** An explicit name, when the visible words alone would not say what pressing does. */
  label?: string
  className?: string
  children: ReactNode
}) {
  const reduce = useReducedMotion() ?? false
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
      whileTap={reduce ? undefined : TAP_PRESS}
      className={cn(
        "inline-flex min-h-control items-center gap-2 rounded-full border px-4 text-body-sm font-semibold transition-colors duration-fast",
        on ? "border-ink bg-ink text-paper" : "border-line-strong bg-paper text-ink hover:bg-paper-sunken",
        className
      )}
    >
      {children}
    </motion.button>
  )
}
