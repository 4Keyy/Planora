"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { useInView, useReducedMotion } from "framer-motion"
import { motion } from "@/components/ui/motion"
import { Check, ChevronLeft, ChevronRight, FileText, Play, RotateCcw } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { RedactionBadge } from "@/components/ui/redaction-badge"
import { FIELD_LABEL_CLASS } from "@/components/ui/field-label"
import { DURATION_UI, EASE_OUT_EXPO, SPRING_RESPONSIVE, SPRING_STANDARD, TAP_PRESS } from "@/lib/animations"
import {
  branchStage,
  chapterAfterPress,
  CHAPTERS,
  LAST_CHAPTER,
  stepActionLabel,
  type StepState,
} from "@/lib/landing-branch"
import { cn } from "@/lib/utils"

/** How long each chapter holds while the story plays itself. */
const CHAPTER_MS = 2600
/** The pause between the block coming into view and the first step. */
const FIRST_STEP_MS = 900

/**
 * Block 6 — a branch, told in six chapters.
 *
 * It used to be a still frame: three lines of text in a white box, and a sentence under it
 * admitting that it was a still frame. The branch is the part of Planora nothing else has —
 * talk on one rail, steps forking off it, replies hanging under what they answer — and the
 * picture never forked, never hung anything under anything, and had no steps.
 *
 * Now the chapters on the left build the branch on the right, one fact at a time, in the
 * order things happen in a real branch, so every chapter adds at the bottom or changes the
 * step already there and nothing moves above the reader's eye. The step's circle is a real
 * control with the product's own cycle: press it once to take the step into work, again to
 * finish it for everyone, and once more to reopen it.
 *
 * Motion, and its limits:
 *
 * - **The story plays once.** On first sight it steps through the chapters and stops at the
 *   last; any press hands it over for good. Nothing moves at rest after that.
 * - **Rails are drawn, not faded.** A rail segment grows from the node above it (`scaleY`
 *   from the top), so the branch visibly extends toward what arrives next.
 * - **Every row's space is reserved.** Rows not yet in the story are laid out and hidden
 *   (`visibility: hidden`, so they are neither seen nor read), which is why the block's
 *   height never changes while it plays.
 * - **Reduced motion** skips the playback and opens on the finished branch; the chapters
 *   still step it, instantly.
 *
 * Geometry: the main rail runs through x = 16 (the centre of a 32px avatar at the left
 * edge), and a step's own rail and a reply's through x = 60 (a 24px marker 48px in). Rails
 * are 2px and sit at x − 1, so their centre is the marker's centre.
 */
export function BranchStory() {
  const reduce = useReducedMotion() ?? false
  const [chapter, setChapter] = useState(1)
  const [playing, setPlaying] = useState(true)
  const rootRef = useRef<HTMLDivElement>(null)
  const seen = useInView(rootRef, { once: true, amount: 0.35 })
  const stage = branchStage(chapter)

  // Reduced motion opens on the finished branch instead of playing it.
  useEffect(() => {
    if (reduce && seen && playing) {
      setPlaying(false)
      setChapter(LAST_CHAPTER)
    }
  }, [reduce, seen, playing])

  // The playback: one chapter at a time, stopping for good at the last.
  useEffect(() => {
    if (!seen || !playing || reduce) return
    if (chapter >= LAST_CHAPTER) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setChapter((c) => c + 1), chapter === 1 ? FIRST_STEP_MS + CHAPTER_MS / 2 : CHAPTER_MS)
    return () => clearTimeout(t)
  }, [seen, playing, reduce, chapter])

  const go = (n: number) => {
    setPlaying(false)
    setChapter(Math.max(1, Math.min(LAST_CHAPTER, n)))
  }

  const replay = () => {
    setChapter(1)
    setPlaying(!reduce)
  }

  const current = CHAPTERS[chapter - 1]

  return (
    <div ref={rootRef} className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
      {/* ── The chapters. A list you can press on wide screens… ── */}
      <div>
        <ol className="hidden flex-col gap-1 lg:flex">
          {CHAPTERS.map((c, i) => {
            const n = i + 1
            const active = n === chapter
            return (
              <li key={c.title}>
                <button
                  type="button"
                  onClick={() => go(n)}
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "relative flex w-full items-start gap-4 overflow-hidden rounded-md px-4 py-3 text-left transition-colors duration-fast",
                    active ? "bg-paper/10" : "hover:bg-paper/5"
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="branch-chapter-bar"
                      aria-hidden="true"
                      className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-paper"
                      transition={SPRING_STANDARD}
                    />
                  )}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "w-6 flex-shrink-0 pt-px text-body-sm font-bold tabular-nums transition-colors duration-fast",
                      n <= chapter ? "text-paper" : "text-paper-subtle"
                    )}
                  >
                    {String(n).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block text-body-sm font-bold transition-colors duration-fast",
                        n <= chapter ? "text-paper" : "text-paper-subtle"
                      )}
                    >
                      {c.title}
                    </span>
                    <span className="mt-0.5 block text-pretty text-body-sm text-paper-subtle">{c.line}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>

        {/* …and one chapter at a time on a phone, where six of them would push the picture
            a screen away. Reserved at the longest chapter, so stepping moves nothing. */}
        <div className="lg:hidden">
          <div className="flex items-center justify-between gap-4">
            <p className="text-caption font-semibold uppercase tracking-wider text-paper-subtle">
              Step {chapter} of {LAST_CHAPTER}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="icon" onClick={() => go(chapter - 1)} disabled={chapter === 1} aria-label="Previous step">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              {chapter < LAST_CHAPTER ? (
                <Button variant="outline" size="icon" onClick={() => go(chapter + 1)} aria-label="Next step">
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : (
                <Button variant="outline" size="icon" onClick={replay} aria-label="Play it again">
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
          {/* Announced when the reader steps, not while the story plays itself: six
              sentences read out on a timer is noise, not narration. */}
          <div aria-live={playing ? "off" : "polite"} className="mt-3 grid">
            {/* Every chapter in one cell, all but the current one invisible: the cell takes
                the tallest, so the picture below never moves. */}
            {CHAPTERS.map((c, i) => (
              <div key={c.title} className={cn("[grid-area:1/1]", i + 1 === chapter ? "visible" : "invisible")} aria-hidden={i + 1 !== chapter}>
                <p className="text-balance text-title-sm font-bold tracking-tight text-paper">{c.title}</p>
                <p className="mt-1 text-pretty text-body-sm text-paper-subtle">{c.line}</p>
              </div>
            ))}
          </div>
          <div aria-hidden="true" className="mt-4 flex gap-1.5">
            {CHAPTERS.map((c, i) => (
              <span
                key={c.title}
                className={cn("h-1 flex-1 rounded-full transition-colors duration-base", i < chapter ? "bg-paper" : "bg-paper/20")}
              />
            ))}
          </div>
        </div>

        <div className="mt-6 hidden lg:block">
          <Button variant="outline" size="sm" onClick={replay} disabled={playing && chapter < LAST_CHAPTER}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Play it again
          </Button>
        </div>
      </div>

      {/* ── The branch. ── */}
      <figure aria-label={`The branch of a task, at step ${chapter}: ${current.title}`} className="rounded-lg bg-paper p-5 shadow-xl sm:p-7 lg:self-center">
        <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
          <p className="text-title-sm font-bold tracking-tight text-ink">Book the flights</p>
          <RedactionBadge audience="shared" viewerCount={2} size="sm" />
        </div>

        <ol className="mt-6">
          {/* 1 · The author's note, first on the main rail. */}
          <Row show={stage.note}>
            <RailMarker>
              <span className="grid h-8 w-8 place-items-center rounded-full bg-ink text-paper">
                <FileText className="h-4 w-4" aria-hidden="true" />
              </span>
            </RailMarker>
            <Rail show={stage.message} className="left-[15px] top-8 -bottom-6" reduce={reduce} />
            <div className="pl-12">
              <p className={FIELD_LABEL_CLASS}>Author&rsquo;s note</p>
              <p className="mt-1 text-body-sm text-ink">Two seats for the spring trip. Cheapest day wins.</p>
            </div>
          </Row>

          {/* 2 · A message on the main rail. */}
          <Row show={stage.message} className="mt-6">
            <RailMarker>
              <Avatar firstName="Victoria" lastName="Whitfield" size={32} />
            </RailMarker>
            <Rail show={stage.reply} className="left-[15px] top-8 -bottom-6" reduce={reduce} />
            <div className="pl-12">
              <Byline name="Victoria" time="09:12" />
              <p className="mt-1 text-body-sm text-ink">Outbound is cheapest on the Tuesday. Shall I hold two seats?</p>
            </div>
          </Row>

          {/* 3 · A reply, hanging under the message it answers on a rail of its own. */}
          <Row show={stage.reply} className="mt-6">
            {/* The main rail carries on past the thread once there is something below it. */}
            <Rail show={stage.step !== null} className="left-[15px] top-0 -bottom-6" reduce={reduce} />
            <Elbow show={stage.reply} className="left-[15px] top-0 h-[13px] w-[33px] border-line-strong" reduce={reduce} />
            <span className="absolute left-12 top-0">
              <Avatar firstName="Mira" lastName="Sandoval" size={24} />
            </span>
            <div className="pl-[84px]">
              <Byline name="Mira" time="09:20" />
              <p className="mt-1 text-body-sm text-ink">Tuesday works. Not the early flight, though.</p>
            </div>
          </Row>

          {/* 4–6 · A step, forked off the main rail, with its circle as its only marker. */}
          <Row show={stage.step !== null} className="mt-6">
            <Step
              state={stage.step ?? "idle"}
              reduce={reduce}
              onPress={(s) => go(chapterAfterPress(s))}
              completion={stage.completion}
            />
          </Row>

          {/* 6 · Who finished it, on the step's own rail. */}
          <Row show={stage.completion} className="mt-4">
            <Elbow show={stage.completion} className="left-[59px] top-0 h-[9px] w-[17px] border-positive" reduce={reduce} />
            <p className="pl-[84px] text-caption text-ink-muted">
              <span className="font-semibold text-ink">You</span> completed the step ·{" "}
              <span className="tabular-nums">09:41</span>
            </p>
          </Row>
        </ol>
      </figure>
    </div>
  )
}

/** A row of the branch: laid out from the start, shown when the story reaches it. */
function Row({ show, className, children }: { show: boolean; className?: string; children: ReactNode }) {
  const reduce = useReducedMotion() ?? false
  return (
    <motion.li
      className={cn("relative", className)}
      initial={false}
      animate={
        show
          ? { opacity: 1, y: 0, visibility: "visible" }
          : { opacity: 0, y: reduce ? 0 : 8, transitionEnd: { visibility: "hidden" } }
      }
      style={show ? undefined : { visibility: "hidden" }}
      transition={reduce ? { duration: 0 } : { duration: DURATION_UI, ease: EASE_OUT_EXPO }}
    >
      {children}
    </motion.li>
  )
}

/** Whatever sits on the main rail for a row: the note's mark or an avatar, centred on x = 16. */
function RailMarker({ children }: { children: ReactNode }) {
  return <span className="absolute left-0 top-0 grid h-8 w-8 place-items-center">{children}</span>
}

/** A straight run of rail that grows down from the node above it. */
function Rail({ show, className, reduce }: { show: boolean; className: string; reduce: boolean }) {
  return (
    <motion.span
      aria-hidden="true"
      className={cn("absolute w-0.5 origin-top rounded-full bg-line-strong", className)}
      initial={false}
      animate={{ scaleY: show ? 1 : 0 }}
      transition={reduce ? { duration: 0 } : { duration: DURATION_UI, ease: EASE_OUT_EXPO }}
    />
  )
}

/** The └ that forks a thread or a step off a rail: down, then a soft turn to the right. */
function Elbow({ show, className, reduce }: { show: boolean; className: string; reduce: boolean }) {
  return (
    <motion.span
      aria-hidden="true"
      className={cn("absolute rounded-bl-lg border-b-2 border-l-2 transition-colors duration-base", className)}
      initial={false}
      animate={{ opacity: show ? 1 : 0 }}
      transition={reduce ? { duration: 0 } : { duration: DURATION_UI, ease: EASE_OUT_EXPO }}
    />
  )
}

function Byline({ name, time }: { name: string; time: string }) {
  return (
    <p className="flex items-baseline gap-2">
      <span className="text-body-sm font-semibold text-ink">{name}</span>
      <span className="text-caption tabular-nums text-ink-muted">{time}</span>
    </p>
  )
}

const STEP_TONE: Record<StepState, { line: string; rail: string }> = {
  idle: { line: "border-line-strong", rail: "bg-line-strong" },
  working: { line: "border-warn", rail: "bg-warn" },
  done: { line: "border-positive", rail: "bg-positive" },
}

/**
 * The step: a fork from the main rail to its circle, set at the card's vertical centre, and
 * the card beside it. The fork and the step's own rail take the step's state colour — grey
 * while nobody is on it, amber while you are, green once it is finished — as the branch does.
 */
function Step({
  state,
  reduce,
  onPress,
  completion,
}: {
  state: StepState
  reduce: boolean
  onPress: (state: StepState) => void
  completion: boolean
}) {
  const tone = STEP_TONE[state]
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-[15px] top-0 h-[calc(50%+1px)] w-[33px] rounded-bl-xl border-b-2 border-l-2 transition-colors duration-base",
          tone.line
        )}
      />
      {/* The step's own rail, down to who finished it. */}
      <motion.span
        aria-hidden="true"
        className={cn("absolute -bottom-4 left-[59px] top-[calc(50%+12px)] w-0.5 origin-top rounded-full", tone.rail)}
        initial={false}
        animate={{ scaleY: completion ? 1 : 0 }}
        transition={reduce ? { duration: 0 } : { duration: DURATION_UI, ease: EASE_OUT_EXPO }}
      />
      {/* Centred by this wrapper, pressed on the button inside: a scale on the centred node
          itself would replace its translate on the first frame. */}
      <span className="absolute left-12 top-1/2 -translate-y-1/2">
        <motion.button
          type="button"
          onClick={() => onPress(state)}
          aria-label={stepActionLabel(state)}
          whileTap={reduce ? undefined : TAP_PRESS}
          className={cn(
            "touch-target grid h-6 w-6 place-items-center rounded-full border-2 transition-colors duration-fast",
            state === "idle" && "border-line-strong bg-paper hover:border-ink",
            state === "working" && "border-warn bg-warn-surface",
            state === "done" && "border-positive bg-positive text-paper"
          )}
        >
          <motion.span
            key={state}
            className="grid place-items-center"
            initial={reduce ? false : { scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={SPRING_RESPONSIVE}
          >
            {state === "working" && <span className="h-2 w-2 rounded-full bg-warn" />}
            {state === "done" && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />}
          </motion.span>
        </motion.button>
      </span>

      <div className="pl-[84px]">
        <div className="rounded-md border border-line bg-paper px-4 py-3 shadow-sm">
          <p
            className={cn(
              "text-body-sm transition-colors duration-fast",
              state === "done" ? "text-ink-muted line-through decoration-line-strong" : "text-ink"
            )}
          >
            Hold two seats on the 10:40
          </p>
          <div className="mt-3 flex min-h-7 items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-caption font-semibold text-ink-muted">
              <Avatar firstName="Victoria" lastName="Whitfield" size={20} />
              Victoria
            </span>
            {state === "idle" && (
              <button
                type="button"
                onClick={() => onPress("idle")}
                className="touch-target inline-flex h-7 items-center gap-1.5 rounded-full border border-line-strong px-3 text-caption font-semibold text-ink transition-colors duration-fast hover:border-ink hover:bg-ink hover:text-paper"
              >
                <Play className="h-3 w-3" aria-hidden="true" />
                Take into work
              </button>
            )}
            {state === "working" && (
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-warn-surface px-3 text-caption font-semibold text-warn">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warn" />
                Working
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
