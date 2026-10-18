"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from "react"
import { AnimatePresence, useReducedMotion } from "framer-motion"
import { motion } from "@/components/ui/motion"
import {
  ArrowDown,
  ArrowRight,
  Check,
  Database,
  EyeOff,
  Fingerprint,
  Globe,
  KeyRound,
  Lock,
  MonitorSmartphone,
  PenLine,
  Radio,
  RefreshCw,
  RotateCw,
  Send,
  Server,
  ShieldCheck,
  Smartphone,
  Timer,
  Undo2,
  User,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NumberRoll } from "@/components/ui/number-roll"
import { FIELD_LABEL_CLASS } from "@/components/ui/field"
import { UNDO_WINDOW_MS, useUndoableAction } from "@/components/ui/undo-bar"
import { useAutosave } from "@/hooks/use-autosave"
import { getApiBaseUrl } from "@/lib/config"
import {
  DURATION_DELIBERATE,
  DURATION_FAST,
  DURATION_UI,
  EASE_EXIT,
  EASE_OUT_EXPO,
  EASE_STANDARD,
  SPRING_RESPONSIVE,
  SPRING_STANDARD,
} from "@/lib/animations"
import {
  cookieNames,
  formatMs,
  formatSpan,
  secondsLeft,
  toBase64Url,
  toHex,
  truncateMiddle,
  uniqueOrigins,
  type OriginRow,
} from "@/lib/landing-trust"
import { cn } from "@/lib/utils"

/**
 * Block 7 — your work stays put, and it stays yours.
 *
 * Six proofs, each something the visitor can run or watch rather than a badge to believe:
 * the product's own undo and autosave, an illustration of delivery across a server restart
 * (captioned as one), a SHA-256 fingerprint computed on the spot, the browser's own list of
 * the origins this page contacted, and one PBKDF2 guess timed at the product's real cost.
 * Every claim is from the verified list in the landing-page plan; nothing here says
 * "encrypted", "backed up", "never lost" or "no third parties at all".
 *
 * ## One proof at a time
 *
 * It used to be two tabs of three cards side by side, every card carrying a kicker, a title,
 * a paragraph, a demo well and a caption at a third of the width — the demos ran out of room
 * ("Feed t…", a status pill hanging out of its well) and the eye had nine things to read
 * before it could press one. Now:
 *
 * - **An index of six** on the left (a row of pills on a phone), grouped under "Stays put"
 *   and "Stays yours". The selection is one surface that springs from row to row.
 * - **One stage** on the right, at full width, with room for each demo to say its point in a
 *   picture: undo shows the request that never leaves, autosave draws every key against the
 *   few saves, the fingerprint shows the key on one side and what is kept on the other.
 * - **Progress the visitor makes**: a proof you run gets a check in the index, and the stage
 *   offers the next one. Nothing advances by itself.
 *
 * All six stages share one grid cell, the inactive ones invisible and inert, so the block
 * holds the tallest stage's height and switching moves nothing on the page. `crypto`,
 * `performance` and `document` are touched only in handlers and effects — this page is
 * server-rendered, and reading them during render would make the server and client disagree.
 */

type ProofId = "undo" | "autosave" | "delivery" | "fingerprint" | "trackers" | "passwords"
type GroupId = "put" | "yours"

const PROOFS: { id: ProofId; group: GroupId; short: string; icon: LucideIcon }[] = [
  { id: "undo", group: "put", short: "Undo sends nothing", icon: Undo2 },
  { id: "autosave", group: "put", short: "Saves as you type", icon: PenLine },
  { id: "delivery", group: "put", short: "Survives a restart", icon: Send },
  { id: "fingerprint", group: "yours", short: "A fingerprint, not the key", icon: Fingerprint },
  { id: "trackers", group: "yours", short: "No trackers", icon: ShieldCheck },
  { id: "passwords", group: "yours", short: "Guessing is slow", icon: Timer },
]

const GROUP_LABEL: Record<GroupId, string> = { put: "Stays put", yours: "Stays yours" }

const ALSO_TRUE: { icon: LucideIcon; text: string }[] = [
  { icon: RefreshCw, text: "An expired sign-in renews itself once and picks up where you were." },
  { icon: Radio, text: "Live updates reconnect on their own. An open branch also checks for news every 9 seconds." },
  { icon: Database, text: "A brief database hiccup is retried, up to three times." },
  { icon: EyeOff, text: "Hide a shared task and the server stops sending you its title." },
  { icon: Lock, text: "Five wrong passwords lock the account for 30 minutes." },
  { icon: KeyRound, text: "If a stolen session key is reused, every session on the account is signed out." },
  { icon: MonitorSmartphone, text: "You can see where you're signed in and end any session." },
  { icon: Smartphone, text: "Two-step sign-in works with any authenticator app. The QR code is drawn on our server." },
]

/** A proof says it was run through this, and the index puts a check by it. */
const TriedContext = createContext<(id: ProofId) => void>(() => {})

/** What a stage knows about its place: whether it is showing, its number, and what comes next. */
const StageContext = createContext<{ active: boolean; step: number; next: string; onNext: () => void }>({
  active: true,
  step: 1,
  next: "",
  onNext: () => {},
})

function useTried(id: ProofId): () => void {
  const mark = useContext(TriedContext)
  return useCallback(() => mark(id), [mark, id])
}

export function TrustLab() {
  const [active, setActive] = useState<ProofId>("undo")
  const [tried, setTried] = useState<ReadonlySet<ProofId>>(() => new Set())
  const base = useId()
  const tabs = useRef<Partial<Record<ProofId, HTMLButtonElement | null>>>({})

  const markTried = useCallback((id: ProofId) => {
    setTried((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }, [])

  const select = useCallback((id: ProofId, focus = false) => {
    setActive(id)
    // The tab takes focus without moving the page: on a phone the index is above the stage.
    if (focus) tabs.current[id]?.focus({ preventScroll: true })
  }, [])

  return (
    <TriedContext.Provider value={markTried}>
      <div className="overflow-hidden rounded-xl border border-line bg-paper-raised shadow-lg">
        <div className="grid grid-cols-1 lg:grid-cols-[18.5rem_minmax(0,1fr)]">
          <ProofIndex base={base} active={active} tried={tried} tabs={tabs} onSelect={select} />

          <div className="min-w-0 p-5 sm:p-8 lg:p-10">
            {/* Every stage in one cell: the block keeps the tallest one's height. */}
            <div className="grid">
              {PROOFS.map((proof, i) => {
                const next = PROOFS[(i + 1) % PROOFS.length]
                return (
                  <div
                    key={proof.id}
                    role="tabpanel"
                    id={`${base}-panel-${proof.id}`}
                    aria-labelledby={`${base}-tab-${proof.id}`}
                    aria-hidden={proof.id !== active}
                    inert={proof.id !== active}
                    className={cn("min-w-0 [grid-area:1/1]", proof.id !== active && "invisible")}
                  >
                    <StageContext.Provider
                      value={{
                        active: proof.id === active,
                        step: i + 1,
                        next: next.short,
                        onNext: () => select(next.id, true),
                      }}
                    >
                      <ProofBody id={proof.id} />
                    </StageContext.Provider>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <AlsoTrue />
      </div>
    </TriedContext.Provider>
  )
}

function ProofBody({ id }: { id: ProofId }) {
  switch (id) {
    case "undo":
      return <UndoProof />
    case "autosave":
      return <AutosaveProof />
    case "delivery":
      return <DeliveryProof />
    case "fingerprint":
      return <FingerprintProof />
    case "trackers":
      return <TrackersProof />
    case "passwords":
      return <PasswordProof />
  }
}

/* ───────────────────────────────── The index ───────────────────────────────── */

function ProofIndex({
  base,
  active,
  tried,
  tabs,
  onSelect,
}: {
  base: string
  active: ProofId
  tried: ReadonlySet<ProofId>
  tabs: MutableRefObject<Partial<Record<ProofId, HTMLButtonElement | null>>>
  onSelect: (id: ProofId, focus?: boolean) => void
}) {
  const reduce = useReducedMotion() ?? false
  const row = useRef<HTMLDivElement>(null)

  // On a phone the index is a row that scrolls sideways: keep the chosen pill in view, by
  // scrolling the row itself — never the page.
  useEffect(() => {
    const strip = row.current
    const tab = tabs.current[active]
    if (!strip || !tab || strip.scrollWidth <= strip.clientWidth) return
    const left = tab.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2
    strip.scrollTo({ left: Math.max(0, left), behavior: reduce ? "auto" : "smooth" })
  }, [active, reduce, tabs])

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const i = PROOFS.findIndex((p) => p.id === active)
    let next = -1
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (i + 1) % PROOFS.length
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (i - 1 + PROOFS.length) % PROOFS.length
    else if (event.key === "Home") next = 0
    else if (event.key === "End") next = PROOFS.length - 1
    if (next === -1) return
    event.preventDefault()
    onSelect(PROOFS[next].id, true)
  }

  return (
    <div className="min-w-0 border-b border-line lg:border-b-0 lg:border-r">
      {/* Side by side over the phone's row of pills; stacked in the narrow desktop column. */}
      <div className="flex items-center justify-between gap-4 px-5 pt-5 sm:px-8 sm:pt-7 lg:flex-col lg:items-start lg:gap-2 lg:px-7 lg:pt-9">
        <p className="text-body-sm font-semibold text-ink">Try them yourself</p>
        <Progress count={tried.size} />
      </div>

      <div
        ref={row}
        role="tablist"
        aria-label="Reliability and privacy"
        className={cn(
          "flex gap-2 overflow-x-auto px-5 pb-5 pt-4 [scrollbar-width:none] sm:px-8 sm:pb-7",
          "lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-4 lg:pb-8 lg:pt-3",
        )}
      >
        {PROOFS.map((proof, i) => {
          const selected = proof.id === active
          const Icon = proof.icon
          const startsGroup = i === 0 || PROOFS[i - 1].group !== proof.group
          return (
            <div key={proof.id} className="contents">
              {startsGroup && (
                <p aria-hidden="true" className={cn(FIELD_LABEL_CLASS, "hidden px-3 pb-2 lg:block", i === 0 ? "pt-3" : "pt-6")}>
                  {GROUP_LABEL[proof.group]}
                </p>
              )}
              <button
                ref={(el) => {
                  tabs.current[proof.id] = el
                }}
                type="button"
                role="tab"
                id={`${base}-tab-${proof.id}`}
                aria-selected={selected}
                aria-controls={`${base}-panel-${proof.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => onSelect(proof.id)}
                onKeyDown={onKeyDown}
                className={cn(
                  "group relative flex min-h-11 flex-shrink-0 items-center gap-3 rounded-lg py-1.5 pl-1.5 pr-4 text-left transition-colors duration-fast",
                  "max-lg:ring-1 max-lg:ring-inset max-lg:ring-line lg:w-full lg:py-2 lg:pl-2",
                  selected ? "text-ink" : "text-ink-muted hover:text-ink",
                )}
              >
                {selected && (
                  // One surface that springs from row to row — the selection, not a highlight
                  // that blinks off in one place and on in another.
                  <motion.span
                    layoutId={`${base}-mark`}
                    aria-hidden="true"
                    className="absolute inset-0 rounded-lg bg-paper shadow-sm ring-1 ring-inset ring-line"
                    transition={reduce ? { duration: 0 } : SPRING_STANDARD}
                  />
                )}
                <span
                  aria-hidden="true"
                  className={cn(
                    "relative grid h-8 w-8 flex-shrink-0 place-items-center rounded-md transition-colors duration-base",
                    selected ? "bg-ink text-paper" : "bg-paper-sunken text-ink-muted group-hover:text-ink",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <TriedMark on={tried.has(proof.id)} reduce={reduce} />
                </span>
                <span className="relative whitespace-nowrap text-body-sm font-semibold">{proof.short}</span>
                {tried.has(proof.id) && <span className="sr-only">, tried</span>}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** A small green check on the icon's corner — on the icon, so the row never changes width. */
function TriedMark({ on, reduce }: { on: boolean; reduce: boolean }) {
  return (
    <AnimatePresence initial={false}>
      {on && (
        <motion.span
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={reduce ? { duration: 0 } : SPRING_RESPONSIVE}
          className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-positive text-paper ring-2 ring-paper-raised"
        >
          <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
        </motion.span>
      )}
    </AnimatePresence>
  )
}

function Progress({ count }: { count: number }) {
  return (
    <p className="flex items-center gap-2.5 whitespace-nowrap text-caption font-semibold tabular-nums text-ink-muted">
      <span aria-hidden="true" className="flex gap-1">
        {PROOFS.map((proof, i) => (
          <span
            key={proof.id}
            className={cn("h-1.5 w-1.5 rounded-full transition-colors duration-base", i < count ? "bg-positive" : "bg-line-strong")}
          />
        ))}
      </span>
      {count} of {PROOFS.length} tried
    </p>
  )
}

/* ───────────────────────────────── The stage ───────────────────────────────── */

/**
 * One proof at full width: what it claims, the demo in a roomy well, and what the demo is.
 * A stage that becomes active arrives in three beats — the words, the well, the footer —
 * and one that leaves simply stops being shown.
 */
function ProofStage({
  kicker,
  title,
  body,
  caption,
  children,
}: {
  kicker: string
  title: string
  body: string
  caption: string
  children: ReactNode
}) {
  const { active, step, next, onNext } = useContext(StageContext)
  const reduce = useReducedMotion() ?? false
  const beat = (delay: number) => ({
    hidden: { opacity: 0, y: reduce ? 0 : 10, transition: { duration: 0 } },
    visible: {
      opacity: 1,
      y: 0,
      transition: reduce ? { duration: 0 } : { duration: DURATION_UI, ease: EASE_OUT_EXPO, delay },
    },
  })

  return (
    <motion.article initial={false} animate={active ? "visible" : "hidden"} className="flex h-full flex-col">
      <motion.div variants={beat(0)}>
        <div className="flex items-center justify-between gap-4">
          <p className={FIELD_LABEL_CLASS}>{kicker}</p>
          <p className="text-caption font-semibold tabular-nums text-ink-muted">
            <span className="sr-only">Proof </span>
            {step} / {PROOFS.length}
          </p>
        </div>
        <h3 className="mt-3 text-balance text-title font-bold tracking-tight text-ink">{title}</h3>
        <p className="mt-3 max-w-2xl text-pretty text-body text-ink-muted">{body}</p>
      </motion.div>

      {/* The well: a reserved height, so no demo's result moves the page. */}
      <motion.div
        variants={beat(0.06)}
        className="mt-7 flex min-h-[17rem] flex-1 flex-col justify-center rounded-lg border border-line bg-paper p-5 sm:p-7"
      >
        {children}
      </motion.div>

      <motion.div
        variants={beat(0.1)}
        className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
      >
        <p className="text-caption text-ink-muted">{caption}</p>
        <Button variant="ghost" size="sm" onClick={onNext} className="-ml-4 self-start sm:-mr-4 sm:ml-0 sm:self-auto">
          <span className="text-ink-muted">Next:</span> {next}
          <ArrowRight className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5" aria-hidden="true" />
        </Button>
      </motion.div>
    </motion.article>
  )
}

/** What a demo shows before it is run: one icon and one sentence, in the middle of the well. */
function Invitation({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-2 text-center">
      <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-full bg-paper-sunken text-ink-muted">
        <Icon className="h-5 w-5" />
      </span>
      <p className="max-w-xs text-pretty text-body-sm text-ink-muted">{children}</p>
    </div>
  )
}

function AlsoTrue() {
  return (
    <div className="border-t border-line px-5 py-7 sm:px-8 sm:py-9 lg:px-10">
      <p className={FIELD_LABEL_CLASS}>Also true</p>
      <ul className="mt-5 grid gap-x-10 gap-y-4 md:grid-cols-2">
        {ALSO_TRUE.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-3 text-body-sm text-ink-muted">
            <span aria-hidden="true" className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md bg-paper-sunken text-ink-muted">
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="pt-0.5">{text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * A line between two places, and a dot that crosses it each time `flight` changes. The dot
 * rides a wrapper exactly as long as the line, moved by its own length in percent — a
 * transform, so the travel costs no layout. Drawn twice: down on a phone, across from `sm`.
 */
function Wire({ flight, reduce }: { flight: number; reduce: boolean }) {
  const dot = (axis: "x" | "y") =>
    !reduce && flight > 0 ? (
      <motion.span
        key={flight}
        className="pointer-events-none absolute inset-0"
        initial={{ [axis]: "0%", opacity: 1 }}
        animate={{ [axis]: "100%", opacity: [1, 1, 0] }}
        transition={{ duration: DURATION_DELIBERATE, ease: EASE_STANDARD }}
      >
        <span
          className={cn(
            "absolute h-2.5 w-2.5 rounded-full bg-ink",
            axis === "x" ? "-left-1 top-1/2 -translate-y-1/2" : "-top-1 left-1/2 -translate-x-1/2",
          )}
        />
      </motion.span>
    ) : null

  return (
    <span aria-hidden="true" className="relative flex justify-center sm:block">
      <span className="relative block h-8 w-px bg-line-strong sm:hidden">{dot("y")}</span>
      <span className="relative hidden h-px w-14 bg-line-strong sm:block lg:w-20">{dot("x")}</span>
    </span>
  )
}

/* ──────────────────────────────── Stays put ──────────────────────────────── */

function UndoProof() {
  const reduce = useReducedMotion() ?? false
  const tried = useTried("undo")
  const { pending, run, undo } = useUndoableAction()
  const [present, setPresent] = useState(true)
  const [sent, setSent] = useState(0)
  const [flight, setFlight] = useState(0)
  const [outcome, setOutcome] = useState<"idle" | "undone" | "sent">("idle")
  const [left, setLeft] = useState(5)
  const startedAt = useRef(0)

  // A seconds readout while the window is open, for everyone, and the ring's only
  // substitute under reduced motion.
  useEffect(() => {
    if (!pending) return
    startedAt.current = performance.now()
    setLeft(secondsLeft(UNDO_WINDOW_MS, 0))
    const id = setInterval(() => setLeft(secondsLeft(UNDO_WINDOW_MS, performance.now() - startedAt.current)), 200)
    return () => clearInterval(id)
  }, [pending])

  const remove = () => {
    tried()
    setPresent(false)
    setOutcome("idle")
    run({
      label: "Task deleted",
      commit: () => {
        setSent((n) => n + 1)
        setFlight((n) => n + 1)
        setOutcome("sent")
      },
      rollback: () => {
        setPresent(true)
        setOutcome("undone")
      },
    })
  }

  const rowMotion = {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: DURATION_UI, ease: EASE_OUT_EXPO },
  }

  return (
    <ProofStage
      kicker="Undo"
      title="Undo sends nothing"
      body="A delete waits five seconds in your browser before it goes anywhere. Undo inside that window and the server never hears about it."
      caption="The app's own undo. The counter shows every request it would send."
    >
      {/* Labels on one row and the things they name on the next, so the wire meets the
          task row and the counter at their middles. */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto_7.5rem] sm:items-center">
        <p className={FIELD_LABEL_CLASS}>In your browser</p>
        <span aria-hidden="true" className="hidden sm:block" />
        <p className={cn(FIELD_LABEL_CLASS, "hidden sm:block")}>Planora</p>

        <div className="flex h-14 min-w-0 items-center">
          <AnimatePresence mode="wait" initial={false}>
            {present ? (
              <motion.div
                key="row"
                {...rowMotion}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, transition: { duration: DURATION_FAST, ease: EASE_EXIT } }}
                className="flex h-14 w-full items-center gap-3 rounded-lg border border-line bg-paper pl-4 pr-2 shadow-sm"
              >
                <span aria-hidden="true" className="h-4 w-4 flex-shrink-0 rounded-full border-2 border-line-strong" />
                <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-ink">Feed the cat</span>
                <Button variant="outline" size="sm" onClick={remove}>
                  Delete
                </Button>
              </motion.div>
            ) : pending ? (
              <motion.div
                key="pending"
                {...rowMotion}
                exit={{ opacity: 0, transition: { duration: DURATION_FAST } }}
                className="flex h-14 w-full items-center gap-3 rounded-lg bg-ink pl-3 pr-2 text-paper"
              >
                <Countdown seconds={left} reduce={reduce} />
                <span className="min-w-0 flex-1 truncate text-body-sm font-semibold">Deleted</span>
                <button
                  type="button"
                  onClick={undo}
                  className="inline-flex min-h-control items-center rounded-md px-3 text-body-sm font-bold text-paper underline underline-offset-4 transition-opacity duration-fast hover:opacity-80"
                >
                  Undo
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="gone"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: DURATION_UI }}
                className="flex h-14 w-full items-center justify-between gap-3 rounded-lg border border-dashed border-line pl-4 pr-2"
              >
                <span className="text-body-sm text-ink-muted">Gone for good.</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPresent(true)
                    setOutcome("idle")
                  }}
                >
                  Put it back
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <Wire flight={flight} reduce={reduce} />

        <div className="flex items-center justify-between gap-4">
          <p className={cn(FIELD_LABEL_CLASS, "sm:hidden")}>Planora</p>
          <p className="flex items-baseline gap-2">
            <span className="text-display-sm font-bold tracking-tight text-ink">
              <NumberRoll value={sent} minDigits={1} align="start" />
            </span>
            <span className="text-caption font-semibold text-ink-muted">{sent === 1 ? "request" : "requests"}</span>
          </p>
        </div>
      </div>

      <p aria-live="polite" className="mt-6 min-h-5 text-body-sm font-semibold text-ink-muted">
        {outcome === "undone"
          ? "Undone. Nothing was sent."
          : outcome === "sent"
            ? "The five seconds ran out, so the delete went out."
            : pending
              ? "Undo now and the counter stays where it is."
              : "Delete the task, then undo it before the ring runs out."}
      </p>
    </ProofStage>
  )
}

/** The seconds left, in a ring that empties — the one sanctioned progress-ring use of `pathLength`. */
function Countdown({ seconds, reduce }: { seconds: number; reduce: boolean }) {
  return (
    <span className="relative grid h-8 w-8 flex-shrink-0 place-items-center">
      {!reduce && (
        <svg viewBox="0 0 28 28" className="absolute inset-0 -rotate-90" aria-hidden="true">
          <circle cx="14" cy="14" r="12" fill="none" strokeWidth="2" className="stroke-paper/25" />
          <motion.circle
            cx="14"
            cy="14"
            r="12"
            fill="none"
            strokeWidth="2"
            className="stroke-paper"
            initial={{ pathLength: 1 }}
            animate={{ pathLength: 0 }}
            transition={{ duration: UNDO_WINDOW_MS / 1000, ease: "linear" }}
          />
        </svg>
      )}
      <span className="relative text-caption font-bold tabular-nums">{seconds}</span>
    </span>
  )
}

/** How many of the latest keys and saves the strip draws; older ones slide off its left edge. */
const STRIP_LENGTH = 44

function AutosaveProof() {
  const reduce = useReducedMotion() ?? false
  const tried = useTried("autosave")
  const [value, setValue] = useState("Call the landlord")
  const [keys, setKeys] = useState(0)
  const [saves, setSaves] = useState(0)
  const [marks, setMarks] = useState<{ id: number; kind: "key" | "save" }[]>([])
  const nextMark = useRef(0)
  const mark = (kind: "key" | "save") =>
    setMarks((prev) => [...prev, { id: nextMark.current++, kind }].slice(-STRIP_LENGTH))

  const { status } = useAutosave({
    value,
    onSave: async () => {
      // A pretend server: a round trip's worth of waiting, then a save counted.
      await new Promise((r) => setTimeout(r, 350))
      setSaves((n) => n + 1)
      mark("save")
    },
  })

  const pill =
    status === "saving"
      ? { text: "Saving…", cls: "bg-paper-sunken text-ink-muted" }
      : status === "saved"
        ? { text: "Saved", cls: "bg-positive-surface text-positive" }
        : status === "error"
          ? { text: "Not saved", cls: "bg-alert-surface text-alert" }
          : { text: "Up to date", cls: "bg-paper-sunken text-ink-muted" }

  return (
    <ProofStage
      kicker="Autosave"
      title="It saves while you type"
      body="Edits save 600 ms after you stop typing, one save at a time. Close the editor mid-word and the last change still goes."
      caption="The app's own autosave, talking to a pretend server."
    >
      <label className={FIELD_LABEL_CLASS} htmlFor="trust-autosave">
        Task title
      </label>
      <div className="mt-2 flex items-center gap-3">
        <Input
          id="trust-autosave"
          value={value}
          maxLength={60}
          autoComplete="off"
          className="min-w-0 flex-1"
          onChange={(e) => {
            tried()
            setValue(e.target.value)
            setKeys((n) => n + 1)
            mark("key")
          }}
        />
        <span
          role="status"
          className={cn(
            "inline-flex w-24 flex-shrink-0 justify-center rounded-full px-2.5 py-1 text-caption font-semibold transition-colors duration-fast sm:w-28",
            pill.cls,
          )}
        >
          {pill.text}
        </span>
      </div>

      {/* Every key as a short grey stroke, every save as a tall green one, on one line. */}
      <div aria-hidden="true" className="mt-6 flex h-7 items-end justify-end gap-1 overflow-hidden border-b border-line pb-1">
        {marks.length === 0 ? (
          <span className="self-center text-caption text-ink-subtle">Type, and each key lands here.</span>
        ) : (
          marks.map((m) => (
            <motion.span
              key={m.id}
              initial={reduce ? false : { scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={SPRING_RESPONSIVE}
              className={cn(
                "w-1 flex-shrink-0 origin-bottom rounded-full",
                m.kind === "key" ? "h-2.5 bg-line-strong" : "h-6 bg-positive",
              )}
            />
          ))
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <Count label="Keys pressed" value={keys} tone="bg-line-strong" />
        <Count label="Saves sent" value={saves} tone="bg-positive" />
      </div>
    </ProofStage>
  )
}

function Count({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <p className="flex items-baseline gap-2">
      <span aria-hidden="true" className={cn("h-2.5 w-1 self-center rounded-full", tone)} />
      <span className="text-caption font-semibold text-ink-muted">{label}</span>
      <span className="text-title-sm font-bold text-ink">
        <NumberRoll value={value} minDigits={1} align="start" />
      </span>
    </p>
  )
}

type DeliveryPhase = "idle" | "to-server" | "restarting" | "to-circle" | "delivered"
const DELIVERY_ORDER: DeliveryPhase[] = ["idle", "to-server", "restarting", "to-circle", "delivered"]

function DeliveryProof() {
  const reduce = useReducedMotion() ?? false
  const tried = useTried("delivery")
  const [phase, setPhase] = useState<DeliveryPhase>("idle")
  const [run, setRun] = useState(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const start = () => {
    tried()
    timers.current.forEach(clearTimeout)
    timers.current = []
    setRun((n) => n + 1)
    setPhase("to-server")
    const at = (ms: number, p: DeliveryPhase) => timers.current.push(setTimeout(() => setPhase(p), ms))
    at(560, "restarting")
    at(1400, "to-circle")
    at(1960, "delivered")
  }

  const reached = (p: DeliveryPhase) => DELIVERY_ORDER.indexOf(phase) >= DELIVERY_ORDER.indexOf(p)
  const busy = phase !== "idle" && phase !== "delivered"

  return (
    <ProofStage
      kicker="Delivery"
      title="A change and its notice travel together"
      body="When you change a shared task, the change and the notice to your circle are saved in one step. If a server restarts halfway, the notice still goes out once it's back."
      caption="An illustration of how delivery works, not a live trace."
    >
      <div aria-hidden="true" className="relative mx-auto flex w-full max-w-md items-start justify-between">
        <span className="absolute left-10 right-10 top-5 h-px bg-line-strong" />
        <Node label="You">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-ink text-paper">
            <User className="h-4 w-4" />
          </span>
        </Node>
        <Node label={phase === "restarting" ? "Restarting…" : "Planora"}>
          <motion.span
            className={cn(
              "grid h-10 w-10 place-items-center rounded-lg border bg-paper transition-colors duration-base",
              phase === "restarting" ? "border-ink" : "border-line-strong",
            )}
            animate={phase === "restarting" && !reduce ? { rotate: 360 } : { rotate: 0 }}
            transition={phase === "restarting" ? { duration: 0.6, ease: EASE_STANDARD } : { duration: 0 }}
          >
            {phase === "restarting" ? <RotateCw className="h-4 w-4 text-ink" /> : <Server className="h-4 w-4 text-ink" />}
          </motion.span>
        </Node>
        <Node label="Your circle">
          <motion.span
            className="flex"
            animate={phase === "delivered" && !reduce ? { scale: [1, 1.12, 1] } : { scale: 1 }}
            transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO }}
          >
            <span className="grid h-10 w-10 place-items-center rounded-full bg-ink text-caption font-bold text-paper ring-2 ring-paper">V</span>
            <span className="-ml-3 grid h-10 w-10 place-items-center rounded-full bg-ink text-caption font-bold text-paper ring-2 ring-paper">T</span>
          </motion.span>
        </Node>

        {/* The dot rides a wrapper exactly as wide as the track, moved by x in percent of
            its own width — a transform, so the travel costs no layout. */}
        {!reduce && (phase === "to-server" || phase === "to-circle") && (
          <motion.span
            key={`${run}-${phase}`}
            className="pointer-events-none absolute left-10 right-10 top-5 h-0"
            initial={{ x: phase === "to-server" ? "0%" : "50%" }}
            animate={{ x: phase === "to-server" ? "50%" : "100%" }}
            transition={{ duration: DURATION_DELIBERATE, ease: EASE_STANDARD }}
          >
            <span className="absolute -left-1.5 -top-1.5 h-3 w-3 rounded-full bg-ink ring-4 ring-paper" />
          </motion.span>
        )}
      </div>

      {/* What the server kept through the restart. Reserved, so it appears without shifting. */}
      <div className="mt-5 flex min-h-8 items-center justify-center">
        <AnimatePresence>
          {reached("restarting") && (
            <motion.span
              key={run}
              className="flex items-center gap-2"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO }}
            >
              <Tag>Change</Tag>
              <Tag>Notice</Tag>
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p aria-live="polite" className="min-h-5 text-body-sm font-semibold text-ink-muted">
          {phase === "delivered"
            ? "Delivered after the restart."
            : phase === "restarting"
              ? "Saved together. Server restarting…"
              : phase === "to-server" || phase === "to-circle"
                ? "On its way…"
                : "Send a change and pull the plug halfway."}
        </p>
        <Button variant="outline" size="sm" className="self-start sm:self-auto" onClick={start} disabled={busy}>
          <RotateCw className="h-4 w-4" aria-hidden="true" />
          {phase === "delivered" ? "Again" : "Restart the server mid-save"}
        </Button>
      </div>
    </ProofStage>
  )
}

function Node({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="relative flex w-24 flex-col items-center gap-2">
      {children}
      <span className="text-caption font-semibold text-ink-muted">{label}</span>
    </span>
  )
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line-strong bg-paper px-3 text-caption font-semibold text-ink">
      <span>{children}</span>
      <Check className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      <span className="sr-only"> saved</span>
    </span>
  )
}

/* ─────────────────────────────── Stays yours ─────────────────────────────── */

function subtleAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.crypto?.subtle?.digest === "function"
}

/**
 * Text that settles into `value` from the left, each character cycling through hex digits
 * until its turn — the look of a hash being worked out. Under reduced motion it is just text.
 */
function Settle({ value, reduce }: { value: string; reduce: boolean }) {
  const [shown, setShown] = useState(value)
  useEffect(() => {
    if (reduce) {
      setShown(value)
      return
    }
    const started = performance.now()
    const length = value.length
    let frame = 0
    const tick = (now: number) => {
      const fixed = Math.min(length, Math.floor(((now - started) / 420) * length))
      let next = value.slice(0, fixed)
      for (let i = fixed; i < length; i++) {
        next += value[i] === "…" ? "…" : "0123456789abcdef"[Math.floor(Math.random() * 16)]
      }
      setShown(next)
      if (fixed < length) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, reduce])
  return <>{shown}</>
}

function FingerprintProof() {
  const reduce = useReducedMotion() ?? false
  const tried = useTried("fingerprint")
  const [pair, setPair] = useState<{ key: string; hash: string } | null>(null)
  const [available, setAvailable] = useState(true)

  useEffect(() => setAvailable(subtleAvailable()), [])

  const make = async () => {
    tried()
    const bytes = new Uint8Array(32)
    window.crypto.getRandomValues(bytes)
    const key = toBase64Url(bytes)
    const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))
    setPair({ key, hash: toHex(new Uint8Array(digest)) })
  }

  return (
    <ProofStage
      kicker="Sessions"
      title="We keep a fingerprint, not the key"
      body="Your long-lived session key sits in a cookie that page scripts can't read. The server stores only its SHA-256 fingerprint, so a copy of our database is not a copy of your session."
      caption="Computed in your browser. Nothing is sent."
    >
      <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-4">
        <Keeps icon={KeyRound} label="Your browser holds">
          {pair ? truncateMiddle(pair.key, 9) : "—"}
        </Keeps>
        <span aria-hidden="true" className="flex flex-col items-center gap-1 text-ink-subtle">
          <ArrowDown className="h-4 w-4 sm:hidden" />
          <ArrowRight className="hidden h-4 w-4 sm:block" />
          <span className="text-caption font-semibold text-ink-muted">SHA-256</span>
        </span>
        <Keeps icon={Database} label="Our database keeps">
          {pair ? <Settle value={truncateMiddle(pair.hash, 9)} reduce={reduce} /> : "—"}
        </Keeps>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p aria-live="polite" className="min-h-5 text-body-sm font-semibold text-ink-muted">
          {!available
            ? "Your browser only allows this on a secure page."
            : pair
              ? "Two different strings. Only the right one is ever stored."
              : "Make a sample key and see what the server would keep instead."}
        </p>
        <Button variant="outline" size="sm" className="self-start sm:self-auto" onClick={() => void make()} disabled={!available}>
          <Fingerprint className="h-4 w-4" aria-hidden="true" />
          {pair ? "Make another" : "Make a sample key"}
        </Button>
      </div>
    </ProofStage>
  )
}

function Keeps({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-paper-sunken p-4">
      <p className="flex items-center gap-2 text-caption font-semibold text-ink-muted">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </p>
      <p className="mt-2 truncate text-body-sm font-semibold tabular-nums text-ink">{children}</p>
    </div>
  )
}

function TrackersProof() {
  const reduce = useReducedMotion() ?? false
  const tried = useTried("trackers")
  const [rows, setRows] = useState<OriginRow[] | null>(null)
  const [cookies, setCookies] = useState<string[]>([])
  const [n, setN] = useState(0)

  const read = () => {
    tried()
    const urls = [
      ...performance.getEntriesByType("navigation").map((e) => e.name),
      ...performance.getEntriesByType("resource").map((e) => e.name),
    ]
    let api: string | null = null
    try {
      api = new URL(getApiBaseUrl(), window.location.origin).origin
    } catch {
      api = null
    }
    setRows(uniqueOrigins(urls, window.location.origin, api))
    setCookies(cookieNames(document.cookie))
    setN((x) => x + 1)
  }

  return (
    <ProofStage
      kicker="Trackers"
      title="No trackers on the line"
      body="No ad or analytics scripts, and fonts come from our own domain. Scripts, fonts and data only come from Planora."
      caption="Read live from your browser's own records."
    >
      <div aria-live="polite">
        {rows ? (
          <motion.div key={n} initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.05 } } }}>
            <p className="text-body-sm font-semibold text-ink">
              This page talked to {rows.length} {rows.length === 1 ? "place" : "places"}.
            </p>
            <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line">
              {rows.map((r) => (
                <motion.li
                  key={r.origin}
                  variants={{
                    hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 6 },
                    visible: { opacity: 1, y: 0, transition: { duration: DURATION_UI, ease: EASE_OUT_EXPO } },
                  }}
                  className="flex items-center gap-3 bg-paper px-4 py-2.5 text-body-sm"
                >
                  {r.label ? (
                    <ShieldCheck className="h-4 w-4 flex-shrink-0 text-positive" aria-hidden="true" />
                  ) : (
                    <Globe className="h-4 w-4 flex-shrink-0 text-ink-muted" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink">{r.origin.replace(/^https?:\/\//, "")}</span>
                  {r.label && <span className="flex-shrink-0 text-caption text-ink-muted">{r.label}</span>}
                </motion.li>
              ))}
            </ul>
            <p className="mt-3 text-caption text-ink-muted">
              Cookies page scripts can read:{" "}
              <span className="font-semibold text-ink">{cookies.length > 0 ? cookies.join(", ") : "none"}</span>
            </p>
          </motion.div>
        ) : (
          <Invitation icon={Globe}>Ask your browser which websites this page has contacted.</Invitation>
        )}
      </div>
      <Button variant="outline" size="sm" className="mt-5 self-center" onClick={read}>
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        {rows ? "Check again" : "Show who this page talked to"}
      </Button>
    </ProofStage>
  )
}

const ROUNDS = 210_000

function PasswordProof() {
  const tried = useTried("passwords")
  const [ms, setMs] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [available, setAvailable] = useState(true)

  useEffect(() => setAvailable(subtleAvailable()), [])

  const time = async () => {
    tried()
    setBusy(true)
    try {
      const enc = new TextEncoder()
      const salt = new Uint8Array(16)
      window.crypto.getRandomValues(salt)
      const key = await window.crypto.subtle.importKey("raw", enc.encode("correct horse"), "PBKDF2", false, ["deriveBits"])
      const t0 = performance.now()
      await window.crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-512", salt, iterations: ROUNDS }, key, 512)
      setMs(performance.now() - t0)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ProofStage
      kicker="Passwords"
      title="Every guess costs 210,000 rounds"
      body="Passwords are stored as PBKDF2-SHA512 with 210,000 rounds and a random salt. Checking one guess means doing all of them."
      caption="Timed on your device with a made-up password. Nothing is sent."
    >
      <div aria-live="polite">
        {ms === null ? (
          <Invitation icon={Timer}>
            {available
              ? "Time what one guess costs, on this device, at the real setting."
              : "Your browser only allows this on a secure page."}
          </Invitation>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-line bg-paper-sunken p-4">
              <p className="text-caption font-semibold text-ink-muted">One guess, here</p>
              <p className="mt-1 flex items-baseline gap-1.5 text-ink">
                <span className="text-display-sm font-bold tracking-tight">
                  <NumberRoll value={Number(formatMs(ms))} minDigits={3} align="start" />
                </span>
                <span className="text-body-sm font-semibold text-ink-muted">ms</span>
              </p>
            </div>
            <div className="rounded-lg border border-line bg-paper-sunken p-4">
              <p className="text-caption font-semibold text-ink-muted">A million guesses, here</p>
              <p className="mt-1 text-title font-bold tracking-tight text-ink">{formatSpan(ms * 1_000_000)}</p>
            </div>
          </div>
        )}
      </div>
      <div className="mt-5 flex flex-col items-center gap-2">
        <Button variant="outline" size="sm" loading={busy} onClick={() => void time()} disabled={!available}>
          <Timer className="h-4 w-4" aria-hidden="true" />
          {ms === null ? "Time one guess on this device" : "Time it again"}
        </Button>
        {ms !== null && <p className="text-caption text-ink-muted">210,000 rounds · SHA-512 · random salt</p>}
      </div>
    </ProofStage>
  )
}
