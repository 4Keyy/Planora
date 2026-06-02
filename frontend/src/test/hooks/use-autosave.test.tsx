import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAutosave, type UseAutosaveOptions } from "@/hooks/use-autosave"

/**
 * Drive the hook with mutable options so a single render can change `value`
 * (mirroring how a form's state feeds the hook) and assert the resulting saves.
 */
function setup<T>(initial: UseAutosaveOptions<T>) {
  const onSave = vi.fn(initial.onSave)
  const { result, rerender, unmount } = renderHook(
    (props: UseAutosaveOptions<T>) => useAutosave(props),
    { initialProps: { ...initial, onSave } as UseAutosaveOptions<T> },
  )
  return {
    result,
    onSave,
    unmount,
    update: (next: Partial<UseAutosaveOptions<T>>) =>
      rerender({ ...initial, onSave, ...next } as UseAutosaveOptions<T>),
  }
}

describe("useAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it("does not save the initial value (the baseline is the opening state)", async () => {
    const { onSave } = setup({ value: "hello", onSave: vi.fn().mockResolvedValue(undefined), delay: 300 })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(onSave).not.toHaveBeenCalled()
  })

  it("debounces a burst of changes into a single save of the latest value", async () => {
    const { onSave, update } = setup<string>({ value: "a", onSave: vi.fn().mockResolvedValue(undefined), delay: 300 })

    update({ value: "ab" })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    update({ value: "abc" })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    update({ value: "abcd" })
    expect(onSave).not.toHaveBeenCalled() // still within the debounce window

    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith("abcd")
  })

  it("reports status transitions idle → saving → saved", async () => {
    let resolve!: () => void
    const onSave = vi.fn().mockImplementation(() => new Promise<void>((r) => { resolve = () => r() }))
    const { result, update } = setup<string>({ value: "a", onSave, delay: 100 })

    expect(result.current.status).toBe("idle")
    update({ value: "b" })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(result.current.status).toBe("saving")

    await act(async () => { resolve() })
    expect(result.current.status).toBe("saved")
  })

  it("never re-saves a value that reverts back to the baseline", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { update } = setup<string>({ value: "a", onSave, delay: 100 })

    update({ value: "b" })
    update({ value: "a" }) // reverted before the debounce fired
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(onSave).not.toHaveBeenCalled()
  })

  it("skips saving when validate() rejects the value", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { update } = setup<string>({
      value: "ok",
      onSave,
      delay: 100,
      validate: (v) => v.trim().length > 0,
    })

    update({ value: "   " }) // fails validation
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(onSave).not.toHaveBeenCalled()
  })

  it("does nothing while disabled, then resumes once enabled", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { update } = setup<string>({ value: "a", onSave, delay: 100, enabled: false })

    update({ value: "b", enabled: false })
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(onSave).not.toHaveBeenCalled()

    update({ value: "c", enabled: true })
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(onSave).toHaveBeenCalledWith("c")
  })

  it("surfaces an error status when the save rejects", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("boom"))
    const { result, update } = setup<string>({ value: "a", onSave, delay: 100 })

    update({ value: "b" })
    await act(async () => { await vi.advanceTimersByTimeAsync(150) })
    expect(result.current.status).toBe("error")
  })

  it("flush() persists a pending change immediately, cancelling the debounce", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { result, update } = setup<string>({ value: "a", onSave, delay: 1000 })

    update({ value: "b" })
    await act(async () => { await result.current.flush() })
    expect(onSave).toHaveBeenCalledWith("b")
  })

  it("flush() is a no-op when nothing changed", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { result } = setup<string>({ value: "a", onSave, delay: 100 })

    await act(async () => { await result.current.flush() })
    expect(onSave).not.toHaveBeenCalled()
  })

  it("reset() re-anchors the baseline so the new value is not seen as dirty", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { result, update } = setup<string>({ value: "a", onSave, delay: 100 })

    // Re-anchor to "b", then feed "b" as the value — must NOT trigger a save.
    act(() => { result.current.reset("b") })
    update({ value: "b" })
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(onSave).not.toHaveBeenCalled()
  })

  it("re-persists a change that arrives while a save is in flight (single-flight)", async () => {
    const resolvers: Array<() => void> = []
    const onSave = vi.fn().mockImplementation(
      () => new Promise<void>((r) => resolvers.push(() => r())),
    )
    const { update } = setup<string>({ value: "a", onSave, delay: 100 })

    update({ value: "b" })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenLastCalledWith("b")

    // Change again mid-flight, then let the first save settle.
    update({ value: "c" })
    await act(async () => { resolvers[0]() })

    // The newer value is persisted right after the in-flight save settles — no overlap.
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave).toHaveBeenLastCalledWith("c")
    await act(async () => { resolvers[1]?.() })
  })

  it("flushes a pending change on unmount so nothing is lost", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { update, unmount } = setup<string>({ value: "a", onSave, delay: 1000 })

    update({ value: "b" })
    await act(async () => { unmount() })
    expect(onSave).toHaveBeenCalledWith("b")
  })
})
