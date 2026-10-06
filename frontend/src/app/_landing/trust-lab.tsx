"use client"

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import {
  ArrowDown,
  Fingerprint,
  KeyRound,
  Lock,
  MonitorSmartphone,
  Radio,
  RefreshCw,
  RotateCw,
  Server,
  ShieldCheck,
  Smartphone,
  EyeOff,
  Database,
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
  SPRING_STANDARD,
} from "@/lib/animations"
import {
  cookieNames,
  formatMs,
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
 * It replaces a cookie probe that proved little: on `/` the refresh cookie is scoped to the
 * auth path and an anonymous visitor has none, so "refresh_token is not readable" was true
 * for reasons that had nothing to do with `HttpOnly`. The owner asked instead for
 * reliability and privacy, told plainly, in something you can poke.
 *
 * Six proofs, each something the visitor can run or watch rather than a badge to believe:
 *
 * - **Live, with the product's own code:** the undo that sends nothing (`useUndoableAction`,
 *   counting what it would send) and the autosave (`useAutosave`, against a pretend server).
 * - **Live, from the visitor's own browser:** a SHA-256 fingerprint computed on the spot,
 *   the list of every origin this page has contacted and the cookie names scripts can read,
 *   and one PBKDF2 guess timed at the product's real cost.
 * - **An illustration:** delivery across a server restart. Its caption says so, because a
 *   picture of a guarantee is not a trace of one.
 *
 * Every claim is from the verified list in the landing-page plan; nothing here says
 * "encrypted", "backed up", "never lost" or "no third parties at all", because none of those
 * is true of the code today.
 *
 * `crypto`, `performance` and `document` are touched only in handlers and effects — this
 * page is server-rendered, and reading them during render would make the server and the
 * client disagree. Both tab panels stay in one grid cell (the inactive one invisible and
 * inert), so the block holds the height of the taller tab and switching moves nothing.
 */

type TabId = "put" | "yours"

const TABS: { id: TabId; label: string }[] = [
  { id: "put", label: "Stays put" },
  { id: "yours", label: "Stays yours" },
]

export function TrustLab() {
  const [tab, setTab] = useState<TabId>("put")
  const base = useId()
  const refs = useRef<Record<TabId, HTMLButtonElement | null>>({ put: null, yours: null })

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.findIndex((t) => t.id === tab)
    let next = -1
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length
    else if (e.key === "Home") next = 0
    else if (e.key === "End") next = TABS.length - 1
    if (next === -1) return
    e.preventDefault()
    const id = TABS[next].id
    setTab(id)
    refs.current[id]?.focus()
  }

  return (
    <div className="rounded-xl border border-line bg-paper-raised p-5 shadow-lg sm:p-10">
      <div
        role="tablist"
        aria-label="Reliability and privacy"
        className="inline-flex rounded-full border border-line bg-paper-sunken p-1"
      >
        {TABS.map((t) => {
          const selected = t.id === tab
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={onKeyDown}
              className={cn(
                "relative inline-flex min-h-control items-center rounded-full px-5 text-body-sm font-semibold transition-colors duration-fast",
                selected ? "text-paper" : "text-ink-muted hover:text-ink"
              )}
            >
              {selected && (
                <motion.span
                  layoutId={`${base}-pill`}
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full bg-ink"
                  transition={SPRING_STANDARD}
                />
              )}
              <span className="relative">{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* Both panels share one grid cell: the block keeps the taller one's height. */}
      <div className="mt-8 grid">
        <Panel id="put" active={tab === "put"} base={base}>
          <Cards>
            <UndoProof />
            <AutosaveProof />
            <DeliveryProof />
          </Cards>
          <AlsoTrue
            items={[
              { icon: RefreshCw, text: "An expired sign-in renews itself once and picks up where you were." },
              { icon: Radio, text: "Live updates reconnect on their own. An open branch also checks for news every 9 seconds." },
              { icon: Database, text: "A brief database hiccup is retried, up to three times." },
            ]}
          />
        </Panel>
        <Panel id="yours" active={tab === "yours"} base={base}>
          <Cards>
            <FingerprintProof />
            <OriginsProof />
            <PasswordProof />
          </Cards>
          <AlsoTrue
            items={[
              { icon: EyeOff, text: "Hide a shared task and the server stops sending you its title." },
              { icon: Lock, text: "Five wrong passwords lock the account for 30 minutes." },
              { icon: KeyRound, text: "If a stolen session key is reused, every session on the account is signed out." },
              { icon: MonitorSmartphone, text: "You can see where you're signed in and end any session." },
              { icon: Smartphone, text: "Two-step sign-in works with any authenticator app. The QR code is drawn on our server." },
            ]}
          />
        </Panel>
      </div>
    </div>
  )
}

function Panel({ id, active, base, children }: { id: TabId; active: boolean; base: string; children: ReactNode }) {
  return (
    <div
      role="tabpanel"
      id={`${base}-panel-${id}`}
      aria-labelledby={`${base}-tab-${id}`}
      aria-hidden={!active}
      inert={!active}
      className={cn("[grid-area:1/1]", !active && "invisible")}
    >
      {active && <PanelIn>{children}</PanelIn>}
      {!active && children}
    </div>
  )
}

/** The incoming panel's cards arrive from below, 40ms apart. */
function PanelIn({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion() ?? false
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.04 } } }}
      data-reduce={reduce || undefined}
    >
      {children}
    </motion.div>
  )
}

function Cards({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">{children}</div>
}

function ProofCard({
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
  const reduce = useReducedMotion() ?? false
  return (
    <motion.article
      variants={{
        hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 8 },
        visible: { opacity: 1, y: 0, transition: { duration: DURATION_UI, ease: EASE_OUT_EXPO } },
      }}
      className="flex flex-col rounded-lg border border-line bg-paper p-5"
    >
      <p className={FIELD_LABEL_CLASS}>{kicker}</p>
      <h3 className="mt-2 text-title-sm font-bold tracking-tight text-ink">{title}</h3>
      <p className="mt-2 text-body-sm text-ink-muted">{body}</p>
      {/* The well: a reserved height, so no widget's result moves the page. */}
      <div className="mt-5 flex min-h-48 flex-1 flex-col justify-center rounded-md bg-paper-sunken p-4">
        {children}
      </div>
      <p className="mt-3 text-caption text-ink-muted">{caption}</p>
    </motion.article>
  )
}

function AlsoTrue({ items }: { items: { icon: typeof Lock; text: string }[] }) {
  return (
    <div className="mt-8 border-t border-line pt-6">
      <p className={FIELD_LABEL_CLASS}>Also true</p>
      <ul className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {items.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-3 text-body-sm text-ink-muted">
            <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-subtle" aria-hidden="true" />
            {text}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ─────────────────────────────── Stays put ─────────────────────────────── */

function UndoProof() {
  const reduce = useReducedMotion() ?? false
  const { pending, run, undo } = useUndoableAction()
  const [present, setPresent] = useState(true)
  const [sent, setSent] = useState(0)
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
    setPresent(false)
    setOutcome("idle")
    run({
      label: "Task deleted",
      commit: () => {
        setSent((n) => n + 1)
        setOutcome("sent")
      },
      rollback: () => {
        setPresent(true)
        setOutcome("undone")
      },
    })
  }

  return (
    <ProofCard
      kicker="Undo"
      title="Undo sends nothing"
      body="A delete waits five seconds in your browser before it goes anywhere. Undo inside that window and the server never hears about it."
      caption="The app's own undo. The counter shows every request it would send."
    >
      <div className="flex h-12 items-center">
        <AnimatePresence mode="wait" initial={false}>
          {present ? (
            <motion.div
              key="row"
              className="flex w-full items-center gap-3 rounded-md border border-line bg-paper px-3 py-2"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, transition: { duration: DURATION_FAST, ease: EASE_EXIT } }}
              transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO }}
            >
              <span aria-hidden="true" className="h-4 w-4 rounded-full border-2 border-line-strong" />
              <span className="flex-1 truncate text-body-sm font-semibold text-ink">Feed the cat</span>
              <Button variant="outline" size="sm" onClick={remove}>
                Delete
              </Button>
            </motion.div>
          ) : pending ? (
            <motion.div
              key="pending"
              className="flex w-full items-center gap-3 rounded-md bg-ink px-3 py-2 text-paper"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: DURATION_FAST } }}
              transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO }}
            >
              <Countdown seconds={left} reduce={reduce} />
              <span className="flex-1 text-body-sm font-semibold">Deleted</span>
              <button
                type="button"
                onClick={undo}
                className="inline-flex min-h-control items-center rounded-md px-3 text-body-sm font-bold text-paper underline underline-offset-4"
              >
                Undo
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="gone"
              className="flex w-full items-center justify-between gap-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: DURATION_UI }}
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

      <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-line pt-4">
        <span className="text-caption font-semibold uppercase tracking-wider text-ink-muted">Requests sent</span>
        <span className="text-title font-bold tabular-nums text-ink">
          <NumberRoll value={sent} minDigits={2} />
        </span>
      </div>
      <p aria-live="polite" className="mt-1 min-h-5 text-caption font-semibold text-ink-muted">
        {outcome === "undone" ? "Undone. Nothing was sent." : outcome === "sent" ? "The window closed, so the delete went out." : ""}
      </p>
    </ProofCard>
  )
}

/** The seconds left, in a ring that empties — the one sanctioned progress-ring use of `pathLength`. */
function Countdown({ seconds, reduce }: { seconds: number; reduce: boolean }) {
  return (
    <span className="relative grid h-7 w-7 place-items-center">
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

function AutosaveProof() {
  const [value, setValue] = useState("Call the landlord")
  const [keys, setKeys] = useState(0)
  const [saves, setSaves] = useState(0)
  const { status } = useAutosave({
    value,
    onSave: async () => {
      // A pretend server: a round trip's worth of waiting, then a save counted.
      await new Promise((r) => setTimeout(r, 350))
      setSaves((n) => n + 1)
    },
  })

  const pill =
    status === "saving"
      ? { text: "Saving…", cls: "bg-paper text-ink-muted" }
      : status === "saved"
        ? { text: "Saved", cls: "bg-positive-surface text-positive" }
        : status === "error"
          ? { text: "Not saved", cls: "bg-alert-surface text-alert" }
          : { text: "Up to date", cls: "bg-paper text-ink-muted" }

  return (
    <ProofCard
      kicker="Autosave"
      title="It saves while you type"
      body="Edits save 600 ms after you stop typing, one save at a time. Close the editor mid-word and the last change still goes."
      caption="The app's own autosave, talking to a pretend server."
    >
      <label className="sr-only" htmlFor="trust-autosave">
        Task title
      </label>
      <Input
        id="trust-autosave"
        value={value}
        maxLength={60}
        autoComplete="off"
        onChange={(e) => {
          setValue(e.target.value)
          setKeys((n) => n + 1)
        }}
      />
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="flex items-baseline gap-4 text-caption font-semibold uppercase tracking-wider text-ink-muted">
          <span className="flex items-baseline gap-1.5">
            Keys
            <span className="text-body font-bold normal-case tracking-normal text-ink">
              <NumberRoll value={keys} minDigits={2} align="start" />
            </span>
          </span>
          <span className="flex items-baseline gap-1.5">
            Saves
            <span className="text-body font-bold normal-case tracking-normal text-ink">
              <NumberRoll value={saves} minDigits={2} align="start" />
            </span>
          </span>
        </span>
        <span
          role="status"
          className={cn("inline-flex min-w-24 justify-center rounded-full px-2.5 py-1 text-caption font-semibold transition-colors duration-fast", pill.cls)}
        >
          {pill.text}
        </span>
      </div>
      <p className="mt-3 text-caption text-ink-muted">Type fast. Watch how few saves it takes.</p>
    </ProofCard>
  )
}

type DeliveryPhase = "idle" | "to-server" | "restarting" | "to-circle" | "delivered"

function DeliveryProof() {
  const reduce = useReducedMotion() ?? false
  const [phase, setPhase] = useState<DeliveryPhase>("idle")
  const [run, setRun] = useState(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const start = () => {
    timers.current.forEach(clearTimeout)
    setRun((n) => n + 1)
    setPhase("to-server")
    const at = (ms: number, p: DeliveryPhase) => timers.current.push(setTimeout(() => setPhase(p), ms))
    timers.current = []
    at(560, "restarting")
    at(1400, "to-circle")
    at(1960, "delivered")
  }

  const reached = (p: DeliveryPhase) => {
    const order: DeliveryPhase[] = ["idle", "to-server", "restarting", "to-circle", "delivered"]
    return order.indexOf(phase) >= order.indexOf(p)
  }

  return (
    <ProofCard
      kicker="Delivery"
      title="A change and its notice travel together"
      body="When you change a shared task, the change and the notice to your circle are saved in one step. If a server restarts halfway, the notice still goes out once it's back."
      caption="An illustration of how delivery works, not a live trace."
    >
      <div aria-hidden="true" className="relative flex items-center justify-between px-1">
        <span className="absolute left-6 right-6 top-4 h-px bg-line-strong" />
        <Node label="You">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-ink text-caption font-bold text-paper">You</span>
        </Node>
        <Node label={phase === "restarting" ? "Restarting" : "Planora"}>
          <motion.span
            className="grid h-8 w-8 place-items-center rounded-md border border-line-strong bg-paper"
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
            <span className="grid h-8 w-8 place-items-center rounded-full bg-ink text-caption font-bold text-paper ring-2 ring-paper">V</span>
            <span className="-ml-2 grid h-8 w-8 place-items-center rounded-full bg-ink text-caption font-bold text-paper ring-2 ring-paper">T</span>
          </motion.span>
        </Node>

        {/* The dot rides a wrapper exactly as wide as the track, moved by x in percent of
            its own width — a transform, so the travel costs no layout. */}
        {!reduce && (phase === "to-server" || phase === "to-circle") && (
          <motion.span
            key={`${run}-${phase}`}
            className="pointer-events-none absolute left-6 right-6 top-4 h-0"
            initial={{ x: phase === "to-server" ? "0%" : "50%" }}
            animate={{ x: phase === "to-server" ? "50%" : "100%" }}
            transition={{ duration: DURATION_DELIBERATE, ease: EASE_STANDARD }}
          >
            <span className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-ink" />
          </motion.span>
        )}
      </div>

      {/* What the server kept through the restart. Reserved, so it appears without shifting. */}
      <div className="mt-4 flex min-h-7 justify-center gap-2">
        <AnimatePresence>
          {reached("restarting") && (
            <motion.span
              className="flex gap-2"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO }}
            >
              <Tag>Change ✓</Tag>
              <Tag>Notice ✓</Tag>
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p aria-live="polite" className="min-h-5 text-caption font-semibold text-ink-muted">
          {phase === "delivered"
            ? "Delivered after the restart."
            : phase === "restarting"
              ? "Saved together. Server restarting…"
              : phase === "to-server" || phase === "to-circle"
                ? "On its way…"
                : ""}
        </p>
        <Button variant="outline" size="sm" onClick={start}>
          {phase === "delivered" ? "Again" : "Restart the server mid-save"}
        </Button>
      </div>
    </ProofCard>
  )
}

function Node({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="relative flex w-20 flex-col items-center gap-1.5">
      {children}
      <span className="text-caption font-semibold text-ink-muted">{label}</span>
    </span>
  )
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-line-strong bg-paper px-2.5 py-0.5 text-caption font-semibold text-ink">
      {children}
    </span>
  )
}

/* ────────────────────────────── Stays yours ────────────────────────────── */

function subtleAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.crypto?.subtle?.digest === "function"
}

function FingerprintProof() {
  const reduce = useReducedMotion() ?? false
  const [pair, setPair] = useState<{ key: string; hash: string; n: number } | null>(null)
  const [available, setAvailable] = useState(true)

  useEffect(() => setAvailable(subtleAvailable()), [])

  const make = async () => {
    const bytes = new Uint8Array(32)
    window.crypto.getRandomValues(bytes)
    const key = toBase64Url(bytes)
    const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))
    setPair((p) => ({ key, hash: toHex(new Uint8Array(digest)), n: (p?.n ?? 0) + 1 }))
  }

  return (
    <ProofCard
      kicker="Sessions"
      title="We keep a fingerprint, not the key"
      body="Your long-lived session key sits in a cookie that page scripts can't read. The server stores only its SHA-256 fingerprint, so a copy of our database is not a copy of your session."
      caption="Computed in your browser. Nothing is sent."
    >
      <div aria-live="polite" className="min-h-28">
        {pair ? (
          <motion.div
            key={pair.n}
            className="flex flex-col items-stretch"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO }}
          >
            <span className="text-caption font-semibold uppercase tracking-wider text-ink-muted">Sample key</span>
            <span className="mt-1 block break-all text-caption font-semibold tabular-nums text-ink">{truncateMiddle(pair.key, 12)}</span>
            <ArrowDown className="my-2 h-4 w-4 self-center text-ink-subtle" aria-hidden="true" />
            <span className="text-caption font-semibold uppercase tracking-wider text-ink-muted">What we keep</span>
            <span className="mt-1 block break-all text-caption font-semibold tabular-nums text-ink">{truncateMiddle(pair.hash, 12)}</span>
          </motion.div>
        ) : (
          <p className="text-body-sm text-ink-muted">
            {available
              ? "Make a sample key and watch what the server would store instead."
              : "Your browser only allows this on a secure page."}
          </p>
        )}
      </div>
      <Button variant="outline" size="sm" className="mt-3 self-start" onClick={() => void make()} disabled={!available}>
        <Fingerprint className="h-4 w-4" aria-hidden="true" />
        {pair ? "Make another" : "Make a sample key"}
      </Button>
    </ProofCard>
  )
}

function OriginsProof() {
  const reduce = useReducedMotion() ?? false
  const [rows, setRows] = useState<OriginRow[] | null>(null)
  const [cookies, setCookies] = useState<string[]>([])
  const [n, setN] = useState(0)

  const read = () => {
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
    <ProofCard
      kicker="Trackers"
      title="No trackers on the line"
      body="No ad or analytics scripts, and fonts come from our own domain. Scripts, fonts and data only come from Planora."
      caption="Read live from your browser's own records."
    >
      <div aria-live="polite" className="min-h-28">
        {rows ? (
          <motion.div key={n} initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.04 } } }}>
            <p className="text-caption font-semibold uppercase tracking-wider text-ink-muted">
              This page talked to {rows.length} {rows.length === 1 ? "place" : "places"}
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {rows.map((r) => (
                <motion.li
                  key={r.origin}
                  variants={{
                    hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 8 },
                    visible: { opacity: 1, y: 0, transition: { duration: DURATION_UI, ease: EASE_OUT_EXPO } },
                  }}
                  className="flex items-center justify-between gap-2 text-caption"
                >
                  <span className="truncate font-semibold text-ink">{r.origin.replace(/^https?:\/\//, "")}</span>
                  {r.label && <span className="flex-shrink-0 text-ink-muted">{r.label}</span>}
                </motion.li>
              ))}
            </ul>
            <p className="mt-3 text-caption text-ink-muted">
              Cookies page scripts can read:{" "}
              <span className="font-semibold text-ink">{cookies.length > 0 ? cookies.join(", ") : "none"}</span>
            </p>
          </motion.div>
        ) : (
          <p className="text-body-sm text-ink-muted">Ask your browser which websites this page has contacted.</p>
        )}
      </div>
      <Button variant="outline" size="sm" className="mt-3 self-start" onClick={read}>
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        {rows ? "Check again" : "Show who this page talked to"}
      </Button>
    </ProofCard>
  )
}

const ROUNDS = 210_000

function PasswordProof() {
  const [ms, setMs] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [available, setAvailable] = useState(true)

  useEffect(() => setAvailable(subtleAvailable()), [])

  const time = async () => {
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
    <ProofCard
      kicker="Passwords"
      title="Every guess costs 210,000 rounds"
      body="Passwords are stored as PBKDF2-SHA512 with 210,000 rounds and a random salt. Checking one guess means doing all of them."
      caption="Timed on your device with a made-up password. Nothing is sent."
    >
      <div aria-live="polite" className="flex min-h-28 flex-col justify-center">
        {ms === null ? (
          <p className="text-body-sm text-ink-muted">
            {available
              ? "Time what one guess costs, on this device, at the real setting."
              : "Your browser only allows this on a secure page."}
          </p>
        ) : (
          <div>
            <p className="flex items-baseline gap-1.5 text-ink">
              <span className="text-display-sm font-bold tracking-tight">
                <NumberRoll value={Number(formatMs(ms))} minDigits={3} align="start" />
              </span>
              <span className="text-body-sm font-semibold text-ink-muted">ms for one guess</span>
            </p>
            <p className="mt-1 text-caption text-ink-muted">210,000 rounds · SHA-512 · random salt</p>
          </div>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="mt-3 self-start"
        loading={busy}
        onClick={() => void time()}
        disabled={!available}
      >
        {ms === null ? "Time one guess on this device" : "Time it again"}
      </Button>
    </ProofCard>
  )
}
