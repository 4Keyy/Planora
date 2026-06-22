import { afterEach, describe, expect, it } from "vitest"
import {
  getBoolPreference,
  setBoolPreference,
  SUPPRESS_INCOMPLETE_SUBTASK_WARNING,
} from "@/lib/ui-preferences"

describe("ui-preferences", () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it("defaults to false when a preference was never set", () => {
    expect(getBoolPreference(SUPPRESS_INCOMPLETE_SUBTASK_WARNING)).toBe(false)
  })

  it("persists a true preference and reads it back", () => {
    setBoolPreference(SUPPRESS_INCOMPLETE_SUBTASK_WARNING, true)
    expect(getBoolPreference(SUPPRESS_INCOMPLETE_SUBTASK_WARNING)).toBe(true)
    // Stored under the namespaced key, not the bare one.
    expect(window.localStorage.getItem("planora:pref:" + SUPPRESS_INCOMPLETE_SUBTASK_WARNING)).toBe("1")
  })

  it("removes the key when set to false so storage stays tidy", () => {
    setBoolPreference(SUPPRESS_INCOMPLETE_SUBTASK_WARNING, true)
    setBoolPreference(SUPPRESS_INCOMPLETE_SUBTASK_WARNING, false)
    expect(getBoolPreference(SUPPRESS_INCOMPLETE_SUBTASK_WARNING)).toBe(false)
    expect(window.localStorage.getItem("planora:pref:" + SUPPRESS_INCOMPLETE_SUBTASK_WARNING)).toBeNull()
  })
})
