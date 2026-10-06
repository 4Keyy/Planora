import { describe, expect, it } from "vitest"
import {
  incompleteSubtaskWord,
  incompleteSubtaskDescription,
  INCOMPLETE_SUBTASK_DIALOG,
} from "@/lib/subtask-warning"

describe("subtask-warning copy", () => {
  it("agrees the noun with the count", () => {
    expect(incompleteSubtaskWord(1)).toBe("subtask")
    expect(incompleteSubtaskWord(2)).toBe("subtasks")
    // Zero is plural in English — "0 unfinished subtasks", never "0 subtask".
    expect(incompleteSubtaskWord(0)).toBe("subtasks")
    expect(incompleteSubtaskWord(11)).toBe("subtasks")
    expect(incompleteSubtaskWord(21)).toBe("subtasks")
  })

  it("builds a description that includes the count and the agreeing noun", () => {
    expect(incompleteSubtaskDescription(5)).toContain("5 unfinished subtasks")
    expect(incompleteSubtaskDescription(1)).toContain("1 unfinished subtask")
  })

  it("keeps the whole dialog in the product's language", () => {
    const copy = [
      INCOMPLETE_SUBTASK_DIALOG.title,
      INCOMPLETE_SUBTASK_DIALOG.confirmText,
      INCOMPLETE_SUBTASK_DIALOG.cancelText,
      INCOMPLETE_SUBTASK_DIALOG.dontAskAgainLabel,
      incompleteSubtaskDescription(3),
    ].join(" ")
    expect(copy).not.toMatch(/[\u0400-\u04FF]/)
  })

  it("exposes stable button + checkbox labels", () => {
    expect(INCOMPLETE_SUBTASK_DIALOG.title).toBe("Some subtasks are still open")
    expect(INCOMPLETE_SUBTASK_DIALOG.confirmText).toBe("Complete anyway")
    expect(INCOMPLETE_SUBTASK_DIALOG.cancelText).toBe("Keep working")
    expect(INCOMPLETE_SUBTASK_DIALOG.dontAskAgainLabel).toBe("Don't ask me again")
  })
})
