"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion"
import { Check, Plus } from "lucide-react"
import { TodoCard } from "@/components/todos/todo-card"
import { Field, FIELD_LABEL_CLASS } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Avatar } from "@/components/ui/avatar"
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
  PRIORITY_NAME,
  SHARE_PEOPLE,
  whenOptions,
  type BuilderState,
  type Change,
  type ShareId,
} from "@/lib/landing-task-builder"
import { cn } from "@/lib/utils"

/**
 * Block 5 — make one.
 *
 * The visitor names a task and dresses it, and the product's own `TodoCard` assembles itself
 * beside the controls. It replaces a list of what a task can hold: a list of features is a
 * brochure, and the card is the product.
 *
 * Every handler on the card is live. Its circle ticks the task off (and back); a press on its
 * body puts you in the title field, which is what editing is; its delete takes it away and
 * offers another. The explainer under the card says what the last change means, in one
 * sentence, and it is the block's one live region.
 *
 * Dates are computed from the moment of the click (`lib/landing-task-builder.ts`), because a
 * fixed date goes overdue and an overdue card is framed in the product's alarm colour. Until
 * the clock is known the near option reads "In three days" rather than a weekday, so the
 * server and the first client render agree.
 *
 * The greyscale switch keeps the point the old block made — priority is a length, never a
 * colour — as something you check rather than read. It swaps a class instantly: `filter` is
 * not an animatable property in this system.
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
  const [grey, setGrey] = useState(false)
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

  const update = (patch: Partial<BuilderState>, what: Change) => {
    touch()
    setState((s) => ({ ...s, ...patch }))
    setChange(what)
  }

  const todo = useMemo(
    () =>
      buildTodo(
        typed === null ? state : { ...state, title: DEFAULT_TITLE.slice(0, Math.max(1, typed)) },
        now
      ),
    [state, typed, now]
  )
  const when = whenOptions(now)

  const toggleShare = (id: ShareId) =>
    update(
      { share: state.share.includes(id) ? state.share.filter((x) => x !== id) : [...state.share, id] },
      "share"
    )

  return (
    <div
      ref={rootRef}
      className="grid grid-cols-1 gap-10 rounded-xl border border-line bg-paper-raised p-6 shadow-lg sm:p-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-14"
    >
      {/* ── The stage. First in the DOM on phones would bury the controls, so the grid
          orders it second there and first on wide screens. ── */}
      <div className="order-first lg:order-last">
        <div className="lg:sticky lg:top-24">
          <div
            className={cn(
              "relative rounded-lg bg-paper-sunken p-5 sm:p-8",
              "bg-[radial-gradient(var(--pl-ink-faint)_1px,transparent_1px)] [background-size:16px_16px]"
            )}
          >
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                role="switch"
                aria-checked={grey}
                onClick={() => {
                  setGrey((g) => !g)
                  setChange("priority")
                }}
                className="inline-flex min-h-control items-center gap-2 rounded-full px-3 text-caption font-semibold text-ink-muted transition-colors duration-fast hover:text-ink"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "relative h-5 w-9 rounded-full border transition-colors duration-fast",
                    grey ? "border-ink bg-ink" : "border-line-strong bg-paper"
                  )}
                >
                  <motion.span
                    className={cn("absolute left-0 top-0.5 h-3.5 w-3.5 rounded-full", grey ? "bg-paper" : "bg-ink-subtle")}
                    initial={false}
                    animate={{ x: grey ? 18 : 2 }}
                    transition={{ duration: DURATION_FAST, ease: EASE_OUT_EXPO }}
                  />
                </span>
                Greyscale
              </button>
            </div>

            {/* Reserved for the largest card (every option on), so the page never moves. */}
            <div className={cn("min-h-56", grey && "grayscale")}>
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
                  // The product card is translucent by design (it sits on the app's background
                  // layer); on the dotted stage it gets a solid paper backing.
                  <motion.div
                    key="card"
                    className="rounded-xl bg-paper"
                    exit={{ opacity: 0, transition: { duration: DURATION_FAST } }}
                  >
                    <TodoCard
                      todo={todo}
                      viewerId={BUILDER_OWNER_ID}
                      variant={state.done ? "completed" : "default"}
                      onComplete={() => update({ done: !state.done }, state.done ? "undone" : "done")}
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

            <p aria-live="polite" className="relative mt-5 min-h-10 text-body-sm text-ink-muted">
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
        </div>
      </div>

      {/* ── The controls. ── */}
      <div className="flex flex-col gap-7">
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
                onClick={() => update({ level }, "priority")}
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
                onClick={() => update({ when: option.id }, "when")}
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

        <Group label="Share with" id="tb-share">
          <div className="flex flex-wrap gap-2">
            {SHARE_PEOPLE.map((p) => {
              const on = state.share.includes(p.id)
              return (
                <Chip key={p.id} on={on} onClick={() => toggleShare(p.id)} className="pl-1.5">
                  <span aria-hidden="true" className="inline-flex">
                    <Avatar firstName={p.firstName} lastName={p.lastName} size={24} />
                  </span>
                  <span className="sr-only">Share with </span>
                  {p.firstName}
                  {on ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  )}
                </Chip>
              )
            })}
          </div>
        </Group>

        <Group label="Note" id="tb-note">
          <Chip on={state.note} onClick={() => update({ note: !state.note }, "note")}>
            {state.note ? <Check className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            Add a note
          </Chip>
        </Group>

        <p className="text-caption text-ink-muted">
          Nothing here is saved. The card is the app&rsquo;s own, on your made-up task.
        </p>
      </div>
    </div>
  )
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
  className,
  children,
}: {
  on: boolean
  onClick: () => void
  className?: string
  children: ReactNode
}) {
  const reduce = useReducedMotion() ?? false
  return (
    <motion.button
      type="button"
      onClick={onClick}
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
