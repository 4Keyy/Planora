import { describe, expect, it } from "vitest"
import {
  incompleteSubtaskWord,
  incompleteSubtaskDescription,
  INCOMPLETE_SUBTASK_DIALOG,
} from "@/lib/subtask-warning"

describe("subtask-warning copy", () => {
  it("agrees the Russian plural with the count", () => {
    expect(incompleteSubtaskWord(1)).toBe("невыполненная под-задача")
    expect(incompleteSubtaskWord(2)).toBe("невыполненные под-задачи")
    expect(incompleteSubtaskWord(4)).toBe("невыполненные под-задачи")
    expect(incompleteSubtaskWord(5)).toBe("невыполненных под-задач")
    expect(incompleteSubtaskWord(0)).toBe("невыполненных под-задач")
    // Teens are always the genitive-plural form despite ending in 1–4.
    expect(incompleteSubtaskWord(11)).toBe("невыполненных под-задач")
    expect(incompleteSubtaskWord(12)).toBe("невыполненных под-задач")
    expect(incompleteSubtaskWord(21)).toBe("невыполненная под-задача")
    expect(incompleteSubtaskWord(22)).toBe("невыполненные под-задачи")
  })

  it("builds a description that includes the count and the agreeing noun", () => {
    expect(incompleteSubtaskDescription(5)).toContain("5 невыполненных под-задач")
    expect(incompleteSubtaskDescription(3)).toContain("3 невыполненные под-задачи")
    expect(incompleteSubtaskDescription(1)).toContain("1 невыполненная под-задача")
  })

  it("exposes stable button + checkbox labels", () => {
    expect(INCOMPLETE_SUBTASK_DIALOG.confirmText).toBe("Выполнить")
    expect(INCOMPLETE_SUBTASK_DIALOG.cancelText).toBe("Продолжить работу")
    expect(INCOMPLETE_SUBTASK_DIALOG.dontAskAgainLabel).toBe("Больше не показывать это окно")
  })
})
