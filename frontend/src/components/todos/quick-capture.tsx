"use client"

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react"
import { motion } from "framer-motion"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SPRING_RESPONSIVE, TWEEN_FAST } from "@/lib/animations"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

/**
 * Capture in six seconds: one field, one key, nothing else.
 *
 * The full create panel asks for priority, due date, category and audience before
 * it will accept a task. Every one of those is a decision, and a decision at the
 * moment of capture is the reason a thought stops being written down at all — the
 * user is standing at a bus stop, not planning. So the first step takes a title
 * and nothing else. This is the Things 3 mechanism: capture is cheap and
 * unstructured, and structure is added later from the card or the branch, where
 * the user is already sitting down and looking at the work.
 *
 * Deliberately absent, and not an oversight to be "fixed" later: priority, due
 * date, category, audience, description, attachments. Adding any selector here
 * puts the decision back in front of the thought.
 *
 * The circle does not fade into the bar — it IS the bar. Both surfaces share one
 * `layoutId`, so framer-motion projects the 56px circle into the pill and back.
 * A crossfade between two separate elements would read as "one thing vanished,
 * another appeared", which is exactly the wrong story: the user pressed a button
 * and it opened, it did not get replaced.
 *
 * CALLER: this is `position: fixed`. It sits over the bottom of the scroll
 * container, so the list behind it needs room or its last card is permanently
 * half-covered — the item people complain they "cannot tap". Give the scrolling
 * region roughly `pb-28` (112px = the 56px bubble + its 16px gutter + 16px of
 * breathing room + the home indicator), and hand `hidden` to this component
 * whenever a modal, overlay or sheet owns the screen.
 */

/** Matches the create panel's own title limit, so capture cannot produce a task the editor would reject. */
const TITLE_MAX_LENGTH = 200

export interface QuickCaptureProps {
  /** Resolves when the task exists. Reject to keep the text and show the error. */
  onCapture: (title: string) => Promise<void>
  /** Hidden while a modal/overlay owns the screen. */
  hidden?: boolean
  /**
   * Where the control sits. `responsive` (the default) is a corner bubble in the
   * phone's thumb zone and a centred bar from `sm` up, because on a 1440px desktop
   * a bottom-right bubble is the furthest point from where the eye already is,
   * while on a 390x844 phone it is the only comfortable place to reach.
   */
  placement?: "responsive" | "corner" | "center"
  className?: string
}

/** True for anything that is already eating keystrokes, so the `c` shortcut must not. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
}

export function QuickCapture({ onCapture, hidden = false, placement = "responsive", className }: QuickCaptureProps) {
  const [expanded, setExpanded] = useState(false)
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState("")
  const [pending, setPending] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  /**
   * The real double-submit guard. `pending` drives the spinner, but a second Enter
   * can land in the same tick as the first, before React has re-rendered and before
   * the submit button is disabled — both handlers would then read `pending === false`
   * and two identical tasks would be created. A ref is written synchronously inside
   * the handler, so the second one is refused.
   */
  const inFlight = useRef(false)

  const uid = useId()
  const surfaceId = `${uid}-surface`
  const inputId = `${uid}-title`
  const errorId = `${uid}-error`

  const collapse = useCallback(() => {
    /**
     * Collapsing DISCARDS the draft rather than parking it.
     *
     * A half-typed line that reappears the next time the bubble is pressed is a
     * surprise the user has to read, understand and then delete before they can
     * capture the thing they actually opened it for. Six words are cheaper to
     * retype than a stale draft is to notice. The same rule applies to Escape, to
     * the cancel control, and to `hidden` flipping on.
     */
    setExpanded(false)
    setValue("")
    setError(null)
    setStatus("")
  }, [])

  const open = useCallback(() => {
    haptic("tap")
    setExpanded(true)
    setStatus("Quick capture open. Type a task, then press Enter.")
  }, [])

  // The input is the whole point of expanding; landing anywhere else costs a tap.
  useEffect(() => {
    if (expanded) inputRef.current?.focus()
  }, [expanded])

  useEffect(() => {
    if (hidden) collapse()
  }, [hidden, collapse])

  /**
   * `c` for capture, on any device with a keyboard.
   *
   * Not gated behind a breakpoint: a phone with a Bluetooth keyboard deserves the
   * shortcut too, and a breakpoint check would only make the binding lie on
   * resize. It is gated on the three things that actually break it — a modifier
   * (Ctrl+C is copy), an IME composition in progress, and a target that is already
   * a text field, which includes this component's own input once it is open.
   */
  useEffect(() => {
    if (hidden) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "c" && event.key !== "C") return
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return
      if (isTypingTarget(event.target)) return
      event.preventDefault()
      open()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [hidden, open])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const title = value.trim()
    // Whitespace is not a task. Enter on an empty field is a no-op rather than an
    // error, because the user has not done anything wrong yet.
    if (!title || inFlight.current) return

    inFlight.current = true
    setPending(true)
    setError(null)
    try {
      await onCapture(title)
      haptic("success")
      collapse()
      setStatus("Task added.")
    } catch (err) {
      /**
       * A rejection keeps the typed text on screen. Clearing the field on failure
       * would destroy the only copy of something the user cannot get back — the
       * server has nothing, and neither would they.
       */
      haptic("error")
      setError(err instanceof Error && err.message ? err.message : "Could not add that task. Try again.")
      inputRef.current?.focus()
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  if (hidden) return null

  const align =
    placement === "corner" ? "items-end" : placement === "center" ? "items-center" : "items-end sm:items-center"

  return (
    <div
      className={cn(
        // `sticky` and not `toast`: an undo bar or a toast must be able to cover
        // this, never the other way round.
        "pointer-events-none fixed inset-x-0 bottom-0 z-sticky pb-safe",
        className,
      )}
    >
      {/*
       * One live region for the whole control, mounted for the component's whole
       * life. Announcing from a node that mounts at the same moment its text
       * appears is a coin flip in most screen readers; this one is already there
       * when the text changes.
       */}
      <span className="sr-only" role="status" aria-live="polite">
        {status}
      </span>

      <div className={cn("flex flex-col gap-2 px-4 pb-4", align)}>
        {/*
          `role="alert"` announces it once when it appears. The `id` is what makes
          it survivable after that: a live region is heard and then gone, so a user
          who tabs away and comes back to the field would have no way to find out
          why their task was refused. `aria-describedby` on the input below re-reads
          it on every return to the field — the same association `Field` enforces
          for every other input in the product, which is why this one cannot be an
          exception.
        */}
        {error && (
          <p
            id={errorId}
            role="alert"
            className="pointer-events-auto max-w-md rounded-md bg-alert-surface px-3 py-1.5 text-caption font-semibold text-alert shadow-md"
          >
            {error}
          </p>
        )}

        {expanded ? (
          <motion.form
            layoutId={surfaceId}
            transition={SPRING_RESPONSIVE}
            onSubmit={handleSubmit}
            aria-label="Quick capture"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return
              // Stop it here so a parent sheet does not close as well: the user
              // aimed Escape at the field they are typing in.
              event.stopPropagation()
              collapse()
            }}
            onBlur={(event) => {
              // Leaving with text in the field does NOT collapse. A tap that lands
              // just outside the pill — easy on a 390px screen — would otherwise
              // throw away the sentence the user is halfway through typing.
              if (value.trim()) return
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
              collapse()
            }}
            // The pill carries the circle's 56px content box (p-1.5 + a 44px
            // control), so the morph reads as the circle stretching sideways
            // rather than growing.
            className="pointer-events-auto flex w-full max-w-md items-center gap-1.5 rounded-full border border-line bg-paper-raised p-1.5 shadow-xl"
          >
            <motion.div
              className="flex w-full items-center gap-1.5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={TWEEN_FAST}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={collapse}
                aria-label="Cancel new task"
                className="h-11 w-11 flex-shrink-0 rounded-full"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>

              <label htmlFor={inputId} className="sr-only">
                New task
              </label>
              <input
                id={inputId}
                ref={inputRef}
                value={value}
                onChange={(event) => {
                  setValue(event.target.value)
                  // The message described the text that was there a keystroke ago.
                  if (error) setError(null)
                }}
                type="text"
                placeholder="What needs doing?"
                maxLength={TITLE_MAX_LENGTH}
                autoComplete="off"
                enterKeyHint="done"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className="min-w-0 flex-1 bg-transparent text-body font-medium text-ink placeholder:font-normal placeholder:text-ink-subtle"
              />

              <Button
                type="submit"
                size="icon"
                loading={pending}
                disabled={!value.trim()}
                aria-label="Add task"
                className="h-11 w-11 flex-shrink-0 rounded-full bg-accent text-accent-ink hover:bg-accent"
              >
                <Plus className="h-5 w-5" aria-hidden="true" />
              </Button>
            </motion.div>
          </motion.form>
        ) : (
          <motion.button
            type="button"
            layoutId={surfaceId}
            transition={SPRING_RESPONSIVE}
            onClick={open}
            aria-label="New task"
            /*
             * Deliberately no `aria-expanded`. This button does not stay put and
             * toggle a region beside it — it is REPLACED by the form, and focus
             * moves into the field. `aria-expanded={false}` on a control that can
             * never report `true` is a promise the widget does not keep; a screen
             * reader would offer a collapse action that no longer has anything to
             * act on. The disclosure is announced by focus arriving in a labelled
             * field inside a named form, which is what actually happened.
             */
            // 56x56 in the bottom-right gutter: blueprint 10.1 puts the thumb's
            // comfortable arc at y 560-844 of 844, and this is the only corner a
            // right-handed grip reaches without the phone moving in the hand.
            className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-ink shadow-lg transition-transform duration-fast active:scale-[0.94]"
          >
            <Plus className="h-6 w-6" aria-hidden="true" strokeWidth={2.5} />
          </motion.button>
        )}
      </div>
    </div>
  )
}
