"use client"

import { useState } from "react"
import { TodoCard } from "@/components/todos/todo-card"
import { FIELD_LABEL_CLASS } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { FIXTURE_OWNER_ID, SHARED_TASK } from "./fixtures"

const VIEWER_ID = "fx-viewer"

/**
 * Block 3 — the honest half of the word "redaction".
 *
 * What the product actually implements is a viewer-side story:
 * `UserTodoViewPreference` carries per-viewer hiding and per-viewer completion, and
 * `HiddenTodoDtoFactory` swaps the title for "Hidden task" **on the server**, so the
 * text never reaches the viewer's browser at all (INV-AZ-3). Owner-controlled
 * field-level redaction does not exist; block 2 carries the roadmap marker for it.
 *
 * Both cards are the shipped `TodoCard` on one fixture, differing only in who is
 * looking — which is the whole demonstration. The owner's copy is passed
 * `viewerId={FIXTURE_OWNER_ID}`, the viewer's `viewerId={VIEWER_ID}`.
 */
export function ViewerSide() {
  const [hiddenForViewer, setHiddenForViewer] = useState(false)
  const [doneForViewer, setDoneForViewer] = useState(false)

  const ownerCopy = { ...SHARED_TASK }
  const viewerCopy = {
    ...SHARED_TASK,
    hidden: hiddenForViewer,
    title: hiddenForViewer ? "Hidden task" : SHARED_TASK.title,
    isCompletedByViewer: doneForViewer,
  }

  const noop = () => {}

  return (
    <div>
      <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
        <div>
          <p className={FIELD_LABEL_CLASS}>What the owner sees</p>
          <div className="mt-3">
            <TodoCard
              todo={ownerCopy}
              viewerId={FIXTURE_OWNER_ID}
              onComplete={noop}
              onDelete={noop}
              onEdit={noop}
            />
          </div>
        </div>

        <div>
          <p className={FIELD_LABEL_CLASS}>What you see</p>
          <div className="mt-3">
            <TodoCard
              todo={viewerCopy}
              viewerId={VIEWER_ID}
              onComplete={noop}
              onDelete={noop}
              onEdit={noop}
            />
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={() => setHiddenForViewer((v) => !v)}
          aria-pressed={hiddenForViewer}
        >
          {hiddenForViewer ? "Show it again" : "Hide it for me"}
        </Button>
        <Button
          variant="outline"
          onClick={() => setDoneForViewer((v) => !v)}
          aria-pressed={doneForViewer}
        >
          {doneForViewer ? "Mark it open again" : "Tick it off for me"}
        </Button>
      </div>

      <p className="mt-5 max-w-2xl text-body text-ink-muted">
        The owner&rsquo;s copy on the left never changes. Hiding is the server&rsquo;s doing, so the
        title of a task you have put out of sight does not reach your browser. Ticking it off marks
        it done for you and leaves the owner&rsquo;s list alone.
      </p>
      <p className="mt-3 max-w-2xl text-body-sm text-ink-subtle">
        One limit worth knowing before you meet it: a viewer can finish a shared task for
        themselves but cannot reopen it. That is the owner&rsquo;s to do. Your way forward on a
        finished task is Duplicate.
      </p>
    </div>
  )
}
