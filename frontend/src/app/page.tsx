import type { Metadata } from "next"
import Link from "next/link"
import { Wordmark } from "@/components/ui/wordmark"
import dynamic from "next/dynamic"
import { LandingNav } from "./_landing/landing-nav"
import { AudienceConsole } from "./_landing/audience-console"
import { DemoSandbox } from "./_landing/demo-sandbox"
import { ConsoleSkeleton } from "./_landing/console-skeleton"
import { AudienceSpine } from "./_landing/audience-spine"
import { ClosingRing } from "./_landing/closing-ring"
import { Parallax } from "./_landing/parallax"
import { HorizontalBand, StaggerItem } from "./_landing/scroll-kit"
import { FIELD_LABEL_CLASS } from "@/components/ui/field-label"
import { Kbd } from "@/components/ui/shortcuts-overlay"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The landing page.
 *
 * The shell is a SERVER component, and that is the one thing here that makes the page
 * faster rather than slower. It used to be `"use client"` end to end, which put the `h1`
 * — the LCP element — inside a tree waiting on hydration. `"use client"` now lives in the
 * islands, so the text that decides LCP is in the first byte of the `force-dynamic`
 * response.
 *
 * ## Composition, and why it changed
 *
 * The first version was nine identical centred sections, every heading at `display-sm`,
 * separated by nine identical hairlines. Correct, measurable, and monotonous: eight type
 * sizes exist and it used three, with `hero` and `title` spent nowhere at all.
 *
 * The rhythm now varies on purpose. One `hero` statement, `display` for the three turns
 * in the argument, `display-sm` for the rest, `title` inside the cards. Section numerals
 * in `ink-subtle` and `aria-hidden` — large enough to place you in the page, quiet
 * enough not to compete with the heading beside it. One inverted
 * full-bleed band in the middle, using the reverse ink ramp the design system keeps for
 * exactly this. And one section where the reading direction turns sideways, spent on the
 * page's most unusual claim.
 *
 * None of that touches colour or type scale, because the interesting headroom was never
 * there — it was in composition, scale contrast and motion, all of which the system
 * leaves open.
 *
 * Heavy blocks are code-split with `ssr` left ON. Turning it off would swap a placeholder
 * for content after hydration, which is a layout shift, and this route's CLS invariant
 * (0.0000–0.0014) is not something to spend on a loading flicker.
 */

/** The hero's entrance: y 8 → 0 with a fade, 220ms, held at the first frame through its delay. */
const HERO_IN = "animate-slide-up [animation-fill-mode:both]"

export const metadata: Metadata = {
  // The root layout's `%s · Planora` template applies to child segments, not to the
  // segment that declares it — so this one spells the brand out itself.
  title: "Planora — private shared tasks",
  description:
    "A task carries the list of people who can see it. Share with the friends you name, and nothing reaches the open internet.",
}

const SharingCeiling = dynamic(() =>
  import("./_landing/sharing-ceiling").then((m) => m.SharingCeiling)
)
const ViewerSide = dynamic(() => import("./_landing/viewer-side").then((m) => m.ViewerSide))
const KeyboardConsole = dynamic(() =>
  import("./_landing/keyboard-console").then((m) => m.KeyboardConsole)
)
const CardMoves = dynamic(() => import("./_landing/card-moves").then((m) => m.CardMoves))
const BranchStory = dynamic(() => import("./_landing/branch-story").then((m) => m.BranchStory))
const TrustLab = dynamic(() => import("./_landing/trust-lab").then((m) => m.TrustLab))

/**
 * Straight from docs/overview.md § What Planora Deliberately Does Not Do, in the words a
 * visitor uses. The previous version was accurate and written for a code reviewer —
 * "no .dark block and no dark: utility" is true and means nothing to someone choosing a
 * task app. Every line here is still checkable against the code.
 */
const NOT_DOING: { what: string; how: string }[] = [
  {
    what: "Publish to the open internet",
    how: "A task reaches only friends who accepted your invite. There's no publish button and no public link.",
  },
  {
    what: "Restore a deleted task",
    how: "You get five seconds to undo. After that there's no way back: no trash, no restore button.",
  },
  {
    what: "A dark theme",
    how: "One light palette, tuned for contrast and reading. We'd rather do one well.",
  },
  {
    what: "Nested subtasks",
    how: "A task and its subtasks, two levels. That's where the nesting stops.",
  },
  {
    what: "Recurring tasks or reminders",
    how: "A task has dates, not a schedule. Nothing repeats and nothing pings you.",
  },
  {
    what: "File attachments",
    how: "The only thing you can upload is your profile photo.",
  },
  {
    what: "Folders inside categories",
    how: "Categories are one flat list. You name them and pick their colours.",
  },
  {
    what: "Ad or analytics trackers",
    how: "No tracking scripts load on any page. What the app reports about itself goes to our own servers and nowhere else.",
  },
]

/**
 * A section's opening.
 *
 * The numeral was `ink-faint` on the reasoning that `aria-hidden` made it a decorative
 * stroke. That was wrong, and the scanner said so: 2.42:1 and 2.52:1 against a required
 * 3:1, ninety failures across the matrix. A 32px numeral a sighted reader uses to place
 * themselves in the page is text, whatever the aria attribute says — and the design
 * system is flat about it: "`text-ink-faint` is never correct."
 *
 * `ink-subtle` at 4.74:1 clears the bar. It stays `aria-hidden` because a screen reader
 * gains nothing from hearing "zero two" before every heading; the eyebrow carries the
 * structure either way.
 */
function SectionHead({
  n,
  eyebrow,
  title,
  size = "display-sm",
  tone = "light",
}: {
  n: string
  eyebrow: string
  title: string
  size?: "display-sm" | "display"
  tone?: "light" | "dark"
}) {
  return (
    <div className="flex items-start gap-6 sm:gap-10">
      <span
        aria-hidden="true"
        className={cn(
          "select-none text-display-sm font-bold leading-none tabular-nums sm:text-display",
          tone === "dark" ? "text-paper-subtle" : "text-ink-subtle"
        )}
      >
        {n}
      </span>
      <div className="max-w-2xl">
        <p className={cn(FIELD_LABEL_CLASS, tone === "dark" && "text-paper-subtle")}>{eyebrow}</p>
        <h2
          className={cn(
            "mt-3 text-balance font-bold tracking-tight",
            size === "display" ? "text-display-sm sm:text-display" : "text-display-sm",
            tone === "dark" ? "text-paper" : "text-ink"
          )}
        >
          {title}
        </h2>
      </div>
    </div>
  )
}

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-transparent">
      <LandingNav />

      <main id="main" className="flex-1">
        {/* ── 01 · The thesis, and the control that carries it ─────────────── */}
        <section className="container-app pb-20 pt-16 sm:pb-28 sm:pt-24">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
            <div>
              {/* The words are simply there; only the things you press arrive. The entrance
                  is CSS rather than framer-motion so it runs before hydration, and it never
                  touches text: an element that starts at opacity 0 is not an LCP candidate
                  until it has finished appearing, and at 430px the paragraph below is the
                  largest thing on screen — animating it measured LCP at 1976 ms against
                  ~280 ms everywhere else. `both` holds the first keyframe through each
                  delay; under reduced motion globals.css collapses the animation. */}
              <p className={FIELD_LABEL_CLASS}>Private shared tasks</p>
              {/* The one `hero` on the page. It steps down at narrow widths because 64px
                  at 390 is about six characters a line — a heading that has become a
                  column of hyphens. */}
              <h1 className="mt-5 text-balance text-display-sm font-bold tracking-tight text-ink sm:text-display lg:text-hero">
                Every task carries the list of people who can see it.
              </h1>
              <p className="mt-7 max-w-xl text-pretty text-body text-ink-muted">
                Share a task with the people it&rsquo;s for, and only them. Every person you add
                opens the ring a little wider, so one glance tells you how far a task has gone.
                There is no public link to leak.
              </p>

              <div
                className={cn(
                  "mt-9 flex flex-col gap-3 sm:flex-row sm:items-center",
                  HERO_IN,
                  "[animation-delay:80ms]"
                )}
              >
                <Link
                  href="/auth/register"
                  className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}
                >
                  Start for free
                </Link>
                <Link
                  href="/auth/login"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "lg" }),
                    "w-full sm:w-auto"
                  )}
                >
                  Sign in
                </Link>
              </div>
            </div>

            <div className={cn(HERO_IN, "[animation-delay:160ms]")}>
              <AudienceConsole />
            </div>
          </div>
        </section>

        {/* ── 02 · The ceiling ─────────────────────────────────────────────── */}
        <section className="border-t border-line bg-paper-sunken">
          <div className="container-app py-20 sm:py-28">
            <Parallax>
              <SectionHead
                n="02"
                eyebrow="Reading the ring"
                title="One glance tells you who's in."
                size="display"
              />
            </Parallax>
            <StaggerItem className="mt-7 max-w-2xl">
              <p className="text-pretty text-body text-ink-muted">
                The ring sits on every task you share. Slide along the seats and it opens person
                by person, until it stops widening. It never closes. Here is how to read it.
              </p>
            </StaggerItem>
            <StaggerItem index={1} className="mt-12">
              <SharingCeiling />
            </StaggerItem>
          </div>
        </section>

        {/* ── 03 · The viewer's side ───────────────────────────────────────── */}
        <section className="border-t border-line">
          <div className="container-app py-20 sm:py-28">
            <Parallax>
              <SectionHead
                n="03"
                eyebrow="When someone shares with you"
                title="A shared task is in your list, not in charge of it."
              />
            </Parallax>
            <StaggerItem className="mt-7 max-w-2xl">
              <p className="text-pretty text-body text-ink-muted">
                Victoria shared a task with you. Tick it off, hide it, then let Victoria finish it,
                and watch both lists.
              </p>
            </StaggerItem>
            <StaggerItem index={1} className="mt-12">
              <ViewerSide />
            </StaggerItem>
          </div>
        </section>

        {/* ── 04 · The console — the page's centre of gravity ──────────────── */}
        <section className="border-t border-line bg-paper-sunken">
          <div className="container-app py-20 sm:py-28">
            <Parallax>
              <SectionHead
                n="04"
                eyebrow="Try the keyboard"
                title="Press ? right now."
                size="display"
              />
            </Parallax>
            <StaggerItem className="mt-7 max-w-2xl">
              <p className="text-pretty text-body text-ink-muted">
                Then press <Kbd>Ctrl K</Kbd> or <Kbd>⌘K</Kbd> and search. Move with <Kbd>J</Kbd>{" "}
                and <Kbd>K</Kbd>, open a task with <Kbd>⏎</Kbd>. These are the app&rsquo;s real
                cards, command palette and task editor, running in your browser on made-up tasks.
              </p>
            </StaggerItem>
            <StaggerItem index={1} className="mt-12">
              {/* The sandbox waits for the real session restore, then seeds a session and
                  swaps the transport before the console mounts — the palette and the list
                  both guard on isAuthenticated. The skeleton holds the console's footprint
                  meanwhile, so the swap moves nothing. */}
              <DemoSandbox placeholder={<ConsoleSkeleton />}>
                <KeyboardConsole />
              </DemoSandbox>
            </StaggerItem>
          </div>
        </section>

        {/* ── 05 · What a card tells you ──────────────────────────────────── */}
        <section className="border-t border-line">
          <div className="container-app py-20 sm:py-28">
            <Parallax>
              <SectionHead
                n="05"
                eyebrow="Read a card"
                title="A card says a lot before you open it."
                size="display"
              />
            </Parallax>
            <StaggerItem className="mt-7 max-w-2xl">
              <p className="text-pretty text-body text-ink-muted">
                This is the app&rsquo;s own card. Make five moves on it and watch the colour, the
                frame, the ring and the check change the way they do on your real tasks.
              </p>
            </StaggerItem>
            <StaggerItem index={1} className="mt-12">
              <CardMoves />
            </StaggerItem>
          </div>
        </section>

        {/* ── 06 · The branch, on the one inverted band ────────────────────────
            A SURFACE, not a theme. The reverse ink ramp (`paper-muted` /
            `paper-subtle` on `ink`) exists precisely so text on a dark ground keeps its
            contrast without a `dark:` utility — of which the product ships zero. */}
        <section className="border-t border-line bg-ink">
          <div className="container-app py-20 sm:py-28">
            <Parallax>
              <SectionHead
                n="06"
                eyebrow="Where the talking happens"
                title="Every task has a timeline of its own."
                tone="dark"
              />
            </Parallax>
            <StaggerItem className="mt-7 max-w-2xl">
              <p className="text-pretty text-body text-paper-muted">
                Open a task and it becomes a branch: the talk on one rail, the steps forking off
                it, the replies hanging under what they answer. Here is one, built step by step.
              </p>
            </StaggerItem>
            <StaggerItem index={1} className="mt-12">
              <BranchStory />
            </StaggerItem>
            <StaggerItem index={2} className="mt-10 max-w-2xl">
              <p className="text-pretty text-body-sm text-paper-subtle">
                Steps go one level deep, and finishing a task with steps still open asks you
                first. The branches in section 04 are live: open a task there and reply.
              </p>
            </StaggerItem>
          </div>
        </section>

        {/* ── 07 · Reliability and privacy ─────────────────────────────────── */}
        <section className="border-t border-line">
          <div className="container-app py-20 sm:py-28">
            <Parallax>
              <SectionHead
                n="07"
                eyebrow="Reliability and privacy"
                title="Your work stays put. And it stays yours."
                size="display"
              />
            </Parallax>
            <StaggerItem className="mt-7 max-w-2xl">
              <p className="text-pretty text-body text-ink-muted">
                Six things you can check rather than take on trust. Five of them run right here, in
                your browser.
              </p>
            </StaggerItem>
            <StaggerItem index={1} className="mt-12">
              <TrustLab />
            </StaggerItem>
          </div>
        </section>

        {/* ── 08 · The refusals, travelling sideways ───────────────────────────
            The one moment where the reading direction changes, spent on the page's most
            unusual claim. Under reduced motion the row stacks into a grid, so nothing is
            ever behind the animation. */}
        <section className="border-t border-line bg-paper-sunken">
          <div className="py-20 sm:py-28">
            <div className="container-app">
              <Parallax>
                <SectionHead
                  n="08"
                  eyebrow="Before you find out later"
                  title="What Planora deliberately does not do."
                  size="display"
                />
              </Parallax>
              <StaggerItem className="mt-7 max-w-2xl">
                <p className="text-pretty text-body text-ink-muted">
                  Better you read it here than discover it in week two. The first one is the whole
                  point of the product.
                </p>
              </StaggerItem>
            </div>

            <HorizontalBand className="mt-14 px-4 sm:px-6 lg:px-8">
              {NOT_DOING.map(({ what, how }) => (
                <div key={what} className="w-72 shrink-0 border-t-2 border-ink pt-5 sm:w-80">
                  <p className="text-title-sm font-bold tracking-tight text-ink">{what}</p>
                  <p className="mt-3 text-body-sm text-ink-muted">{how}</p>
                </div>
              ))}
            </HorizontalBand>
          </div>
        </section>

        {/* ── 09 · One action, one name ────────────────────────────────────────
            The page opened on a private ring and closes on a circle of three, drawn as the
            reader arrives: the heading's promise, as a picture. */}
        <section className="border-t border-line">
          <div className="container-app py-24 sm:py-32">
            <StaggerItem>
              <div className="grid grid-cols-1 items-center gap-10 rounded-xl border border-line bg-paper-raised p-8 shadow-xl sm:p-12 lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-16">
                <ClosingRing />
                <div>
                  <h2 className="max-w-3xl text-balance text-display-sm font-bold tracking-tight text-ink sm:text-display">
                    Decide who sees what, and see the circle you decided on.
                  </h2>
                  <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <Link
                      href="/auth/register"
                      className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}
                    >
                      Start for free
                    </Link>
                    <Link
                      href="/auth/login"
                      className={cn(
                        buttonVariants({ variant: "outline", size: "lg" }),
                        "w-full sm:w-auto"
                      )}
                    >
                      Sign in
                    </Link>
                  </div>
                  <p className="mt-7 text-body-sm text-ink-subtle">
                    Free, and no card needed. Planora is young, and we&rsquo;d rather say so up
                    front.
                  </p>
                </div>
              </div>
            </StaggerItem>
          </div>
        </section>
      </main>

      {/* Outside <main> and outside every animated wrapper: this is position: fixed, and
          a transform on an ancestor re-parents a fixed node silently. */}
      <AudienceSpine />

      <footer className="border-t border-line">
        <div className="container-app flex flex-col gap-4 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Wordmark size="sm" />
            {/* ink-muted, not ink-subtle: at 12px the floor is ink-muted (§ 11). */}
            <p className="mt-1 text-caption text-ink-muted">
              Private coordination for people you trust.
            </p>
          </div>
          <nav aria-label="Footer" className="flex items-center gap-2">
            <Link
              href="/auth/login"
              className="inline-flex min-h-control items-center rounded-md px-3 text-body-sm font-semibold text-ink-muted transition-colors duration-fast hover:text-ink"
            >
              Sign in
            </Link>
            <Link
              href="/auth/register"
              className="inline-flex min-h-control items-center rounded-md px-3 text-body-sm font-semibold text-ink-muted transition-colors duration-fast hover:text-ink"
            >
              Create an account
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
