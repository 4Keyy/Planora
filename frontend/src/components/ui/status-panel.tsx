"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The one shape every "there is nothing here" and "this did not load" panel takes.
 *
 * Before this existed the product had six of them, hand-built per page, and they
 * had drifted: the icon plate was 56px on /tasks and 64px on /tasks/completed, the
 * icon inside it 28px and 32px; the title was a `<p>` in one place and an `<h2>` in
 * another, which put a hole in the heading outline on one screen and not the other;
 * the gaps below the title were mb-3 in one and mb-4 in the next. None of that is
 * visible while reading a single file, which is exactly why it drifted.
 *
 * Two tones, two sizes, and that is the whole API:
 *
 * - `tone="neutral"` — nothing here yet. The panel is quiet and the action is an
 *   invitation ("Create task").
 * - `tone="alert"` — something failed. The panel is announced to assistive tech
 *   (`role="status"`, polite) because it replaces content the user was waiting for,
 *   and the action is a retry.
 *
 * - `size="compact"` — a small dashed placeholder inside an already-titled sub-panel
 *   (the profile page's session list, friend requests, search results). Always pair
 *   it with `as="p"`: the panel it sits in owns the heading.
 * - `size="panel"` — inline, replacing a section's content: a dashed outline that
 *   reads as a placeholder in the flow of a page.
 * - `size="page"` — the whole viewport is this panel: no outline, more air.
 *
 * The title is a real heading by default (`as="h2"`), because these panels replace
 * content that had one. Pass `as="p"` only where the surrounding markup already
 * provides the heading and a second one would duplicate it.
 */

export interface StatusPanelAction {
  label: string
  /** A button action. Mutually exclusive with `href`. */
  onClick?: () => void
  /** A navigation action. Mutually exclusive with `onClick`. */
  href?: string
  /** Shows a spinner and blocks re-entry. Only meaningful with `onClick`. */
  loading?: boolean
}

export interface StatusPanelProps {
  icon?: LucideIcon
  title: string
  description?: ReactNode
  /** The prominent action. */
  action?: StatusPanelAction
  /** The quiet way out — "Back to dashboard", "Clear filter". */
  secondaryAction?: StatusPanelAction
  tone?: "neutral" | "alert"
  size?: "compact" | "panel" | "page"
  /** Heading element for the title. `p` only where a heading already exists above. */
  as?: "h1" | "h2" | "h3" | "p"
  /**
   * An opaque id a user can quote in a bug report. Never put the error message
   * itself here: a raw server message can carry a stack trace or another user's
   * data, and it means nothing to the person reading it.
   */
  referenceId?: string
  className?: string
}

function ActionButton({ action, variant }: { action: StatusPanelAction; variant: "default" | "outline" }) {
  if (action.href) {
    return (
      <Button asChild variant={variant}>
        <Link href={action.href}>{action.label}</Link>
      </Button>
    )
  }
  return (
    <Button variant={variant} onClick={action.onClick} loading={action.loading}>
      {action.label}
    </Button>
  )
}

export function StatusPanel({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  tone = "neutral",
  size = "panel",
  as: Heading = "h2",
  referenceId,
  className,
}: StatusPanelProps) {
  const isPage = size === "page"
  const isCompact = size === "compact"

  return (
    <div
      // A failure replaces content the user was waiting for, so it has to be
      // announced. An empty state is just the page's normal content and is not.
      role={tone === "alert" ? "status" : undefined}
      aria-live={tone === "alert" ? "polite" : undefined}
      className={cn(
        "text-center",
        isPage && "mx-auto w-full max-w-2xl px-6 py-16",
        size === "panel" && "rounded-xl border border-dashed border-line bg-paper px-6 py-10",
        isCompact && "rounded-lg border border-dashed border-line bg-paper-sunken px-4 py-8",
        className,
      )}
    >
      {Icon ? (
        <div
          className={cn(
            "mx-auto flex items-center justify-center",
            isCompact ? "mb-3 h-11 w-11 rounded-lg border border-line bg-paper" : "mb-4 rounded-xl",
            isPage ? "h-16 w-16" : isCompact ? "" : "h-14 w-14",
            // `ink-faint` is 2.52:1 and reserved for dividers; even a decorative
            // icon at that contrast reads as a rendering fault rather than a choice.
            tone === "alert"
              ? "bg-alert-surface text-alert"
              : cn("text-ink-subtle", !isCompact && "bg-paper-sunken"),
          )}
        >
          <Icon className={isPage ? "h-8 w-8" : isCompact ? "h-5 w-5" : "h-7 w-7"} aria-hidden="true" />
        </div>
      ) : null}

      <Heading className={cn("font-bold text-ink", isPage ? "text-title" : isCompact ? "text-body-sm" : "text-title-sm")}>
        {title}
      </Heading>

      {description ? (
        <p className={cn(
          "mx-auto mt-2 max-w-prose font-medium text-ink-subtle",
          isCompact ? "text-caption" : "text-body-sm",
        )}>
          {description}
        </p>
      ) : null}

      {referenceId ? (
        <p className="mt-3 text-caption text-ink-subtle">
          Reference id: <code className="font-mono">{referenceId}</code>
        </p>
      ) : null}

      {action || secondaryAction ? (
        <div className={cn("flex flex-wrap items-center justify-center gap-3", isPage ? "mt-8" : "mt-6")}>
          {action ? <ActionButton action={action} variant="default" /> : null}
          {secondaryAction ? <ActionButton action={secondaryAction} variant="outline" /> : null}
        </div>
      ) : null}
    </div>
  )
}
