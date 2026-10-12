import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  PRIORITY_SETTLE_MS,
  priorityFields,
  priorityLevel,
  usePriorityWriter,
  type PriorityWriterOptions,
} from "@/hooks/use-priority-writer"
import type { Todo } from "@/types/todo"

const task = (patch: Partial<Todo> = {}): Todo => ({
  id: "t-1",
  userId: "me",
  title: "Book the flights",
  status: "Todo",
  priority: "Medium",
  isPublic: false,
  isCompleted: false,
  tags: [],
  createdAt: "2026-10-01T09:00:00.000Z",
  ...patch,
})

/** A page's list, as the writer sees it: read and patch, nothing else. */
function harness(initial: Todo[], save: PriorityWriterOptions["save"]) {
  const store = new Map(initial.map((t) => [t.id, t]))
  const patches: Array<[string, Partial<Todo>]> = []
  const onError = vi.fn()
  const view = renderHook(() =>
    usePriorityWriter({
      read: (id) => store.get(id),
      patch: (id, fields) => {
        patches.push([id, fields])
        const current = store.get(id)
        if (current) store.set(id, { ...current, ...fields })
      },
      save,
      onError,
    }),
  )
  return { write: view.result.current, store, patches, onError, unmount: view.unmount }
}

/** A save the test resolves or rejects by hand. */
function deferredSaves() {
  const calls: Array<{ id: string; level: number; resolve: (t: Todo) => void; reject: (e: unknown) => void }> = []
  const save = vi.fn((id: string, level: number) =>
    new Promise<Todo>((resolve, reject) => {
      calls.push({ id, level, resolve, reject })
    }),
  )
  return { save, calls }
}

const settle = async () => {
  await act(async () => {
    vi.advanceTimersByTime(PRIORITY_SETTLE_MS)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  document.querySelectorAll("[role='status']").forEach((n) => n.remove())
})

describe("priorityLevel", () => {
  it("reads every spelling the API and the UI use", () => {
    expect(priorityLevel("VeryLow")).toBe(1)
    expect(priorityLevel("High")).toBe(4)
    expect(priorityLevel("Critical")).toBe(5)
    expect(priorityLevel(2)).toBe(2)
    expect(priorityLevel("5")).toBe(5)
  })

  it("reads anything else as Medium", () => {
    expect(priorityLevel("")).toBe(3)
    expect(priorityLevel(undefined)).toBe(3)
  })
})

describe("priorityFields", () => {
  const today = new Date("2026-10-12T12:00:00.000Z")

  it("names the level the way the server does", () => {
    expect(priorityFields(task(), 1, today).priority).toBe("VeryLow")
    expect(priorityFields(task(), 4, today).priority).toBe("High")
  })

  it("frames an Urgent task in red whatever its date", () => {
    expect(priorityFields(task(), 5, today).isVisuallyUrgent).toBe(true)
  })

  it("keeps the red for a task due today or earlier on the server's calendar", () => {
    expect(priorityFields(task({ dueDate: "2026-10-12T00:00:00.000Z" }), 2, today).isVisuallyUrgent).toBe(true)
    expect(priorityFields(task({ dueDate: "2026-10-01T00:00:00.000Z" }), 2, today).isVisuallyUrgent).toBe(true)
  })

  it("drops it for a later date or none", () => {
    expect(priorityFields(task({ dueDate: "2026-10-20T00:00:00.000Z" }), 4, today).isVisuallyUrgent).toBe(false)
    expect(priorityFields(task(), 4, today).isVisuallyUrgent).toBe(false)
  })
})

describe("usePriorityWriter", () => {
  it("shows the level on the keypress and saves the last of a burst once", async () => {
    const save = vi.fn(async (_id: string, level: number) => task({ priority: level === 4 ? "High" : "Urgent" }))
    const { write, store } = harness([task()], save)

    act(() => write("t-1", 5))
    expect(store.get("t-1")?.priority).toBe("Urgent")
    act(() => write("t-1", 4))
    expect(store.get("t-1")?.priority).toBe("High")
    expect(save).not.toHaveBeenCalled()

    await settle()

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith("t-1", 4)
  })

  it("merges the server's answer — the level, the frame and the timestamp only", async () => {
    const save = vi.fn(async () =>
      task({ priority: "High", isVisuallyUrgent: false, updatedAt: "2026-10-12T10:00:00.000Z", title: "Renamed elsewhere", hidden: false }),
    )
    const { write, store, patches } = harness([task({ hidden: true })], save)

    act(() => write("t-1", 4))
    await settle()

    expect(patches.at(-1)).toEqual(["t-1", { priority: "High", isVisuallyUrgent: false, updatedAt: "2026-10-12T10:00:00.000Z" }])
    // A field the key did not touch is never written back from the answer.
    expect(store.get("t-1")?.title).toBe("Book the flights")
    expect(store.get("t-1")?.hidden).toBe(true)
  })

  it("never has two saves in flight, and the newer level goes next", async () => {
    const { save, calls } = deferredSaves()
    const { write, store } = harness([task()], save)

    act(() => write("t-1", 5))
    await settle()
    expect(save).toHaveBeenCalledTimes(1)

    act(() => write("t-1", 2))
    await settle()
    expect(save).toHaveBeenCalledTimes(1)

    await act(async () => calls[0].resolve(task({ priority: "Urgent" })))
    // The first answer arrived after a newer press: it must not repaint the card.
    expect(store.get("t-1")?.priority).toBe("Low")
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith("t-1", 2)

    await act(async () => calls[1].resolve(task({ priority: "Low" })))
    expect(store.get("t-1")?.priority).toBe("Low")
  })

  it("puts the server's level back when the save fails, and says so", async () => {
    const save = vi.fn(async () => {
      throw new Error("offline")
    })
    const { write, store, onError } = harness([task({ priority: "Medium" })], save)

    act(() => write("t-1", 5))
    expect(store.get("t-1")?.priority).toBe("Urgent")
    await settle()

    expect(store.get("t-1")?.priority).toBe("Medium")
    expect(store.get("t-1")?.isVisuallyUrgent).toBe(false)
    expect(onError).toHaveBeenCalledWith("t-1")
  })

  it("does not roll back a failure a newer press has already replaced", async () => {
    const { save, calls } = deferredSaves()
    const { write, store, onError } = harness([task()], save)

    act(() => write("t-1", 5))
    await settle()
    act(() => write("t-1", 1))
    await act(async () => calls[0].reject(new Error("timeout")))

    expect(onError).not.toHaveBeenCalled()
    expect(store.get("t-1")?.priority).toBe("VeryLow")
    // The newer press still settles on its own clock, then goes.
    await settle()
    expect(save).toHaveBeenLastCalledWith("t-1", 1)
  })

  it("sends nothing when the burst ends where the server already is", async () => {
    const save = vi.fn(async () => task())
    const { write, store } = harness([task({ priority: "Medium" })], save)

    act(() => write("t-1", 5))
    act(() => write("t-1", 3))
    await settle()

    expect(save).not.toHaveBeenCalled()
    expect(store.get("t-1")?.priority).toBe("Medium")
  })

  it("answers a key for the level the task already has without a request", async () => {
    const save = vi.fn(async () => task())
    const { write, patches } = harness([task({ priority: "Medium" })], save)

    act(() => write("t-1", 3))
    await settle()
    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(save).not.toHaveBeenCalled()
    expect(patches).toEqual([])
    expect(document.querySelector("[role='status']")?.textContent).toBe("Priority 3 of 5, Medium")
  })

  it("announces the new level for a screen reader", async () => {
    const { write } = harness([task()], vi.fn(async () => task({ priority: "High" })))

    act(() => write("t-1", 4))
    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(document.querySelector("[role='status'][aria-live='polite']")?.textContent).toBe("Priority 4 of 5, High")
  })

  it("does not lose a press that was still settling when the page goes", async () => {
    const save = vi.fn(async () => task({ priority: "High" }))
    const { write, unmount } = harness([task()], save)

    act(() => write("t-1", 4))
    unmount()

    expect(save).toHaveBeenCalledWith("t-1", 4)
  })

  it("ignores a level out of range and a task it cannot find", async () => {
    const save = vi.fn(async () => task())
    const { write, patches } = harness([task()], save)

    act(() => {
      write("t-1", 0)
      write("t-1", 6)
      write("t-1", 2.5)
      write("missing", 4)
    })
    await settle()

    expect(patches).toEqual([])
    expect(save).not.toHaveBeenCalled()
  })

  it("keeps each task's burst to itself", async () => {
    const save = vi.fn(async (id: string) => task({ id }))
    const { write } = harness([task(), task({ id: "t-2" })], save)

    act(() => {
      write("t-1", 5)
      write("t-2", 1)
    })
    await settle()

    expect(save).toHaveBeenCalledWith("t-1", 5)
    expect(save).toHaveBeenCalledWith("t-2", 1)
  })
})
