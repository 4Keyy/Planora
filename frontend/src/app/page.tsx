import type { Metadata } from "next"
import Link from "next/link"
import dynamic from "next/dynamic"
import { LandingNav } from "./_landing/landing-nav"
import { AudienceConsole } from "./_landing/audience-console"
import { DemoSandbox } from "./_landing/demo-sandbox"
import { AudienceSpine } from "./_landing/audience-spine"
import { Parallax } from "./_landing/parallax"
import { Reveal } from "./_landing/reveal"
import { FIELD_LABEL_CLASS } from "@/components/ui/field"
import { RedactionBadge } from "@/components/ui/redaction-badge"
import { InkCheck } from "@/components/ui/ink-check"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The landing page.
 *
 * This shell is a SERVER component, and that is the one change here that makes the page
 * faster rather than slower. The previous version was `"use client"` end to end, which
 * put the `h1` — the LCP element — inside a tree waiting on hydration. `"use client"`
 * now lives in the islands below, so the text that decides LCP is in the first byte of
 * the `force-dynamic` response.
 *
 * The heavy blocks are code-split with `ssr` left ON. Turning SSR off would swap a
 * placeholder for content after hydration, which is a layout shift, and the CLS
 * invariant on this route (0.0000–0.0014) is not something to spend on a loading
 * flicker.
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
    what: "Publish anything to the open internet",
    how: "Sharing resolves against your accepted friends before a single row is read, and the editor writes isPublic: false on every save.",
  },
  {
    what: "A dark theme",
    how: "One palette, defined on :root. There is no .dark block and no dark: utility anywhere in the product.",
  },
  {
    what: "Restore a deleted task",
    how: "Delete is final once the five-second window closes. There is no restore endpoint, so there is no restore button.",
  },
  {
    what: "Nested subtasks",
    how: "The tree is exactly two levels. A subtask cannot have subtasks, and the domain throws if you try.",
  },
  {
    what: "Recurring tasks and reminders",
    how: "A task has dates, not a schedule. No recurrence rule and no due-date notifier exists.",
  },
  {
    what: "File attachments",
    how: "The only upload in the product is your avatar.",
  },
  {
    what: "Category hierarchies",
    how: "Categories are a flat list.",
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
    detail: "A SHA-256 hash, never the token itself. A copy of our database is not a copy of your session.",
  },
  {
    claim: "Sign-in and account changes are CSRF-protected",
    detail: "A double-submit token guards the Auth API. That is the scope today, and we would rather name it than imply more.",
  },
]

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="max-w-2xl">
      <p className={FIELD_LABEL_CLASS}>{eyebrow}</p>
      <h2 className="mt-3 text-display-sm font-bold tracking-tight text-ink">{title}</h2>
    </div>
  )
}

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-transparent">
      <LandingNav />

      <main id="main" className="flex-1">
        {/* ── Block 1 — the thesis, and the control that carries it ───────────── */}
        <section className="container-app py-16 sm:py-24">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <h1 className="text-display-sm font-bold tracking-tight text-ink lg:text-display">
                Every task carries the list of people who can see it.
              </h1>
              <p className="mt-6 max-w-xl text-body text-ink-muted">
                Press the ring. This is the app&rsquo;s own control, on three invented friends —
                not a picture of it. Private means you and nobody else. Add a friend and the ring
                cuts open a little wider.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
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

        {/* ── Block 2 — the ceiling ───────────────────────────────────────────── */}
        <section className="border-t border-line bg-paper-sunken">
          <div className="container-app py-16 sm:py-20">
            <Reveal>
              <Parallax>
                <SectionHeading
                  eyebrow="How far it reaches"
                  title="Sharing stops at the friends you named."
                />
                </Parallax>
            </Reveal>
            <Reveal step={1} className="mt-10">
              <SharingCeiling />
            </Reveal>
          </div>
        </section>

        {/* ── Block 3 — the viewer's side ─────────────────────────────────────── */}
        <section className="border-t border-line">
          <div className="container-app py-16 sm:py-20">
            <Reveal>
              <Parallax>
                <SectionHeading
                  eyebrow="When someone shares with you"
                  title="A shared task is in your list, not in charge of it."
                />
                </Parallax>
            </Reveal>
            <Reveal step={1} className="mt-10">
              <ViewerSide />
            </Reveal>
          </div>
        </section>

        {/* ── Block 4 — the keyboard ──────────────────────────────────────────── */}
        <section className="border-t border-line bg-paper-sunken">
          <div className="container-app py-16 sm:py-20">
            <Reveal>
              <Parallax>
                <SectionHeading eyebrow="The real thing" title="Press ? right now." />
                <p className="mt-4 max-w-2xl text-body text-ink-muted">
                Then press <kbd className="text-body-sm">⌘K</kbd> and search. Then move with
                <kbd className="text-body-sm">J</kbd>/<kbd className="text-body-sm">K</kbd> and hit
                <kbd className="text-body-sm">⏎</kbd>. None of that is a picture: the cards below
                are the product&rsquo;s own, the palette is the product&rsquo;s own, and the branch
                that opens is the product&rsquo;s own — running against the product&rsquo;s own data
                layer, in your browser, on invented people. Delete is a five-second question: undo
                cancels a timer, so the request is never sent. After five seconds it is sent, and
                there is no restore. We would rather say that than offer a button that does not
                  exist.
                </p>
              </Parallax>
            </Reveal>
            <Reveal step={1} className="mt-10">
              {/* The sandbox seeds a session and swaps the transport before the console
                  mounts. The palette and the list both guard on isAuthenticated, so
                  rendering them first would give one frame where every key is dead. */}
              <DemoSandbox>
                <KeyboardConsole />
              </DemoSandbox>
            </Reveal>
          </div>
        </section>

        {/* ── Block 5 — what a task holds ─────────────────────────────────────── */}
        <section className="border-t border-line">
          <div className="container-app py-16 sm:py-20">
            <Reveal>
              <Parallax>
                <SectionHeading
                  eyebrow="What a task holds"
                  title="Priority is a length, never a colour."
                />
                </Parallax>
            </Reveal>
            <Reveal step={1} className="mt-10">
              <PriorityDemo />
            </Reveal>
          </div>
        </section>

        {/* ── Block 6 — the branch ────────────────────────────────────────────── */}
        <section className="border-t border-line bg-paper-sunken">
          <div className="container-app py-16 sm:py-20">
            <Reveal>
              <Parallax>
                <SectionHeading
                  eyebrow="Where the talking happens"
                  title="Every task has a timeline of its own."
                />
                </Parallax>
            </Reveal>
            <Reveal step={1} className="mt-10 max-w-2xl">
              <div className="rounded-lg border border-line bg-paper-raised p-6 shadow-sm">
                <div className="flex items-baseline gap-3">
                  <h3 className="text-title-sm font-bold tracking-tight text-ink">
                    Book the flights for the spring trip
                  </h3>
                  <RedactionBadge audience="shared" viewerCount={2} size="sm" />
                </div>

                <ol className="mt-6 flex flex-col gap-5 border-l border-line pl-6">
                  <li>
                    <p className="text-body-sm font-semibold text-ink">Dana</p>
                    <p className="mt-1 text-body-sm text-ink-muted">
                      Outbound looks cheapest on the Tuesday. Shall I hold two seats?
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

                <p className="mt-6 text-caption text-ink-subtle">
                  A rendering of one moment, not a live demo — a branch is a feed, a poll, access
                  checks over gRPC and presence. An honest still beats an interactive that lies
                  about the complexity.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── Block 7 — the session ───────────────────────────────────────────── */}
        <section className="border-t border-line">
          <div className="container-app py-16 sm:py-20">
            <Reveal>
              <Parallax>
                <SectionHeading
                  eyebrow="Your session"
                  title="Three claims, and one you can check without trusting us."
                />
                </Parallax>
            </Reveal>

            <div className="mt-10 grid gap-8 lg:grid-cols-2 lg:gap-12">
              <Reveal step={1}>
                <ul className="flex flex-col gap-6">
                  {SECURITY.map(({ claim, detail }) => (
                    <li key={claim}>
                      <p className="text-body font-semibold text-ink">{claim}</p>
                      <p className="mt-1 text-body-sm text-ink-muted">{detail}</p>
                    </li>
                  ))}
                </ul>
              </Reveal>
              <Reveal step={2}>
                <SessionProbe />
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── Block 8 — the refusals ──────────────────────────────────────────── */}
        <section className="border-t border-line bg-paper-sunken">
          <div className="container-app py-16 sm:py-20">
            <Reveal>
              <Parallax>
                <SectionHeading
                  eyebrow="Before you find out later"
                  title="What Planora deliberately does not do."
                />
                <p className="mt-4 max-w-2xl text-body text-ink-muted">
                  Each of these is a decision you can see in the code, not a gap waiting to be
                  filled. The first one is the whole product.
                </p>
              </Parallax>
            </Reveal>

            <Reveal step={1} className="mt-10">
              <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                {NOT_DOING.map(({ what, how }) => (
                  <li key={what} className="border-t border-line-strong pt-4">
                    <p className="text-body-sm font-semibold text-ink">{what}</p>
                    <p className="mt-2 text-caption text-ink-subtle">{how}</p>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>

        {/* ── Block 9 — one action, one name ──────────────────────────────────── */}
        <section className="border-t border-line">
          <div className="container-app py-16 text-center sm:py-24">
            <Reveal>
              <h2 className="mx-auto max-w-2xl text-display-sm font-bold tracking-tight text-ink">
                Decide who sees what, and see the circle you decided on.
              </h2>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
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
              <p className="mt-6 text-body-sm text-ink-subtle">
                No card, no trial clock. The product is young and we would rather say so.
              </p>
            </Reveal>
          </div>
        </section>
      </main>

      {/* Outside <main> and outside every animated wrapper: this is position: fixed, and
          a transform on an ancestor re-parents a fixed node silently. */}
      <AudienceSpine />

      <footer className="border-t border-line">
        <div className="container-app py-8 text-center">
          <p className="text-caption text-ink-subtle">
            Planora — private coordination for people you trust.
          </p>
        </div>
      </footer>
    </div>
  )
}
