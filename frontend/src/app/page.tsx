import type { Metadata } from "next"
import Link from "next/link"
import dynamic from "next/dynamic"
import { LandingNav } from "./_landing/landing-nav"
import { AudienceConsole } from "./_landing/audience-console"
import { DemoSandbox } from "./_landing/demo-sandbox"
import { AudienceSpine } from "./_landing/audience-spine"
import { Parallax } from "./_landing/parallax"
import { HorizontalBand, StaggerItem } from "./_landing/scroll-kit"
import { FIELD_LABEL_CLASS } from "@/components/ui/field"
import { RedactionBadge } from "@/components/ui/redaction-badge"
import { InkCheck } from "@/components/ui/ink-check"
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
const PriorityDemo = dynamic(() => import("./_landing/priority-demo").then((m) => m.PriorityDemo))
const SessionProbe = dynamic(() => import("./_landing/session-probe").then((m) => m.SessionProbe))

/** Straight from docs/overview.md § What Planora Deliberately Does Not Do. */
const NOT_DOING: { what: string; how: string }[] = [
  {
    what: "Publish to the open internet",
    how: "Sharing resolves against your accepted friends before a single row is read, and the editor writes isPublic: false on every save.",
  },
  {
    what: "Restore a deleted task",
    how: "Delete is final once the five-second window closes. There is no restore endpoint, so there is no restore button.",
  },
  {
    what: "A dark theme",
    how: "One palette, defined on :root. There is no .dark block and no dark: utility anywhere in the product.",
  },
  {
    what: "Nested subtasks",
    how: "The tree is exactly two levels. A subtask cannot have subtasks, and the domain throws if you try.",
  },
  {
    what: "Recurring tasks or reminders",
    how: "A task has dates, not a schedule. No recurrence rule and no due-date notifier exists anywhere.",
  },
  {
    what: "File attachments",
    how: "The only upload in the whole product is your avatar.",
  },
  {
    what: "Category hierarchies",
    how: "Categories are a flat list, and the frontend has no parent field to set.",
  },
  {
    what: "Third-party analytics",
    how: "Events are allowlisted and logged on our own servers. There is no SDK to load.",
  },
]

const SECURITY: { claim: string; detail: string }[] = [
  {
    claim: "Your access token lives in memory",
    detail: "It is never written to disk, and it goes away when you close the tab.",
  },
  {
    claim: "The server keeps only a hash of your refresh token",
    detail:
      "A SHA-256 hash, never the token itself. A copy of our database is not a copy of your session.",
  },
  {
    claim: "Sign-in and account changes are CSRF-protected",
    detail:
      "A double-submit token guards the Auth API. That is the scope today, and we would rather name it than imply more.",
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
            "mt-3 font-bold tracking-tight",
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
          <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
            <div>
              <p className={FIELD_LABEL_CLASS}>Private shared tasks</p>
              {/* The one `hero` on the page. It steps down at narrow widths because 64px
                  at 390 is about six characters a line — a heading that has become a
                  column of hyphens. */}
              <h1 className="mt-5 text-display-sm font-bold tracking-tight text-ink sm:text-display lg:text-hero">
                Every task carries the list of people who can see it.
              </h1>
              <p className="mt-7 max-w-xl text-body text-ink-muted">
                Press the ring. This is the app&rsquo;s own control, on three invented friends —
                not a picture of it. Private means you and nobody else. Add a friend and the ring
                cuts open a little wider.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
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

            <AudienceConsole />
          </div>
        </section>

        {/* ── 02 · The ceiling ─────────────────────────────────────────────── */}
        <section className="border-t border-line bg-paper-sunken">
          <div className="container-app py-20 sm:py-28">
            <Parallax>
              <SectionHead
                n="02"
                eyebrow="How far it reaches"
                title="Sharing stops at the friends you named."
                size="display"
              />
            </Parallax>
            <StaggerItem className="mt-12">
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
            <StaggerItem className="mt-12">
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
                eyebrow="Not a picture of the product"
                title="Press ? right now."
                size="display"
              />
            </Parallax>
            <StaggerItem className="mt-7 max-w-2xl">
              <p className="text-body text-ink-muted">
                Then press <kbd className="text-body-sm font-semibold">⌘K</kbd> and search. Then
                move with <kbd className="text-body-sm font-semibold">J</kbd>/
                <kbd className="text-body-sm font-semibold">K</kbd> and hit{" "}
                <kbd className="text-body-sm font-semibold">⏎</kbd>. None of it is a mock-up: the
                cards are the product&rsquo;s own, the palette is the product&rsquo;s own, and the
                branch that opens is the product&rsquo;s own — running against the
                product&rsquo;s own data layer, in your browser, on invented people.
              </p>
            </StaggerItem>
            <StaggerItem index={1} className="mt-12">
              {/* The sandbox seeds a session and swaps the transport before the console
                  mounts. The palette and the list both guard on isAuthenticated, so
                  rendering them first would give one frame where every key is dead. */}
              <DemoSandbox>
                <KeyboardConsole />
              </DemoSandbox>
            </StaggerItem>
          </div>
        </section>

        {/* ── 05 · What a task holds ───────────────────────────────────────── */}
        <section className="border-t border-line">
          <div className="container-app py-20 sm:py-28">
            <Parallax>
              <SectionHead
                n="05"
                eyebrow="What a task holds"
                title="Priority is a length, never a colour."
              />
            </Parallax>
            <StaggerItem className="mt-12">
              <PriorityDemo />
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

            <StaggerItem className="mt-12 max-w-2xl">
              <div className="rounded-lg bg-paper p-6 shadow-xl sm:p-8">
                <div className="flex items-baseline gap-3">
                  <h3 className="text-title font-bold tracking-tight text-ink">
                    Book the flights
                  </h3>
                  <RedactionBadge audience="shared" viewerCount={2} size="sm" />
                </div>

                <ol className="mt-7 flex flex-col gap-6 border-l border-line pl-6">
                  <li>
                    <p className="text-body-sm font-semibold text-ink">Dana</p>
                    <p className="mt-1 text-body-sm text-ink-muted">
                      Outbound is cheapest on the Tuesday. Shall I hold two seats?
                    </p>
                  </li>
                  <li>
                    <p className="text-body-sm font-semibold text-ink">Mira</p>
                    <p className="mt-1 text-body-sm text-ink-muted">
                      Tuesday works. I cannot do the early flight though.
                    </p>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5">
                      <InkCheck size={16} />
                    </span>
                    <p className="text-body-sm text-ink-muted">
                      <span className="font-semibold text-ink">Dana</span> completed a step ·
                      09:41
                    </p>
                  </li>
                </ol>
              </div>
            </StaggerItem>

            <StaggerItem index={1} className="mt-8 max-w-2xl">
              <p className="text-body-sm text-paper-subtle">
                A rendering of one moment, not a live demo — a branch is a feed, a poll, access
                checks over gRPC and presence. Open a real one in section 04, where it runs.
              </p>
            </StaggerItem>
          </div>
        </section>

        {/* ── 07 · The session ─────────────────────────────────────────────── */}
        <section className="border-t border-line">
          <div className="container-app py-20 sm:py-28">
            <Parallax>
              <SectionHead
                n="07"
                eyebrow="Your session"
                title="Three claims, and one you can check without trusting us."
              />
            </Parallax>

            <div className="mt-12 grid gap-10 lg:grid-cols-2 lg:gap-16">
              <ul className="flex flex-col gap-8">
                {SECURITY.map(({ claim, detail }, i) => (
                  <StaggerItem key={claim} index={i}>
                    <li>
                      <p className="text-title-sm font-bold tracking-tight text-ink">{claim}</p>
                      <p className="mt-2 text-body-sm text-ink-muted">{detail}</p>
                    </li>
                  </StaggerItem>
                ))}
              </ul>
              <StaggerItem index={1}>
                <SessionProbe />
              </StaggerItem>
            </div>
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
                <p className="text-body text-ink-muted">
                  Each of these is a decision you can see in the code, not a gap waiting to be
                  filled. The first one is the whole product.
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

        {/* ── 09 · One action, one name ────────────────────────────────────── */}
        <section className="border-t border-line">
          <div className="container-app py-24 sm:py-32">
            <StaggerItem>
              <h2 className="max-w-3xl text-display-sm font-bold tracking-tight text-ink sm:text-display">
                Decide who sees what, and see the circle you decided on.
              </h2>
            </StaggerItem>
            <StaggerItem index={1}>
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
                No card, no trial clock. The product is young and we would rather say so.
              </p>
            </StaggerItem>
          </div>
        </section>
      </main>

      {/* Outside <main> and outside every animated wrapper: this is position: fixed, and
          a transform on an ancestor re-parents a fixed node silently. */}
      <AudienceSpine />

      <footer className="border-t border-line">
        <div className="container-app py-10">
          <p className="text-caption text-ink-subtle">
            Planora — private coordination for people you trust.
          </p>
        </div>
      </footer>
    </div>
  )
}
