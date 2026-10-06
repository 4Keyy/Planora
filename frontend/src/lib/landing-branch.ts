/**
 * The landing page's branch story, as data.
 *
 * Block 6 tells how a task's branch works in six chapters, and each chapter only ever adds to
 * the bottom of the picture or changes the step already there — the order below is the order
 * things happen in a branch, so nothing is inserted above what the reader is looking at.
 *
 * Every line is a fact of the product (docs/features.md § Subtasks, § Branch Replies):
 *
 * - the branch opens on the author's note, and messages share one rail in time order;
 * - a reply hangs under the message it answers, on a small rail of its own;
 * - anyone in the branch can add a subtask, which forks off the main rail, and its circle is
 *   its only marker;
 * - the first press on that circle takes the step into work — per person, and shown to
 *   everyone else as an anonymous count — and the second finishes it for everyone, with a
 *   line on the step's own rail saying who and when.
 */

export interface Chapter {
  title: string
  line: string
}

export const CHAPTERS: readonly Chapter[] = [
  {
    title: "It starts with a note",
    line: "The author's note says what the task is. Everything after it is conversation.",
  },
  {
    title: "Everyone talks on one rail",
    line: "Whoever can see the task writes on the same rail, in the order it happened.",
  },
  {
    title: "A reply hangs under what it answers",
    line: "It forks onto a small rail of its own, so a side conversation never buries the main one.",
  },
  {
    title: "A step forks off",
    line: "Anyone in the branch can add a subtask. It branches to the side, and its circle is its only marker.",
  },
  {
    title: "Press once to take it",
    line: "The circle puts you on it. Everyone else sees a count of who's working, never a name.",
  },
  {
    title: "Press again to finish",
    line: "The step is done for everyone, and its own rail says who finished it, and when.",
  },
]

export const LAST_CHAPTER = CHAPTERS.length

/** Where the step stands for the reader: nobody on it, the reader on it, or finished. */
export type StepState = "idle" | "working" | "done"

export interface BranchStage {
  note: boolean
  message: boolean
  reply: boolean
  step: StepState | null
  completion: boolean
}

/** What the picture shows at a chapter (1-based). Anything out of range is clamped. */
export function branchStage(chapter: number): BranchStage {
  const c = Math.max(1, Math.min(LAST_CHAPTER, Math.floor(Number.isFinite(chapter) ? chapter : 1)))
  return {
    note: true,
    message: c >= 2,
    reply: c >= 3,
    step: c < 4 ? null : c === 4 ? "idle" : c === 5 ? "working" : "done",
    completion: c >= 6,
  }
}

/**
 * The chapter a press on the step's circle leads to — the product's own cycle: an idle step
 * is taken into work, a step you are on is finished, and a finished one reopens.
 */
export function chapterAfterPress(step: StepState): number {
  if (step === "idle") return 5
  if (step === "working") return 6
  return 4
}

/** What the circle does when pressed, for its accessible name. */
export function stepActionLabel(step: StepState): string {
  if (step === "idle") return "Take the step into work"
  if (step === "working") return "Finish the step"
  return "Reopen the step"
}
