import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ensurePermission,
  notificationPermission,
  notifySystem,
} from "@/lib/notifications/web-notifications"

const TASK = "11111111-1111-1111-1111-111111111111"
const EMPTY_GUID = "00000000-0000-0000-0000-000000000000"

class MockNotification {
  static permission: NotificationPermission = "granted"
  static requestPermission = vi.fn(async () => MockNotification.permission)
  static last: MockNotification | null = null
  static shouldThrow = false
  onclick: (() => void) | null = null
  close = vi.fn()
  constructor(public title: string, public options?: NotificationOptions) {
    if (MockNotification.shouldThrow) throw new Error("blocked")
    MockNotification.last = this
  }
}

let visState = "hidden"
let hasFocusVal = false
const originalLocation = window.location

function installNotification() {
  MockNotification.permission = "granted"
  MockNotification.last = null
  MockNotification.shouldThrow = false
  MockNotification.requestPermission.mockClear()
  ;(window as unknown as { Notification: unknown }).Notification = MockNotification
}

beforeEach(() => {
  visState = "hidden"
  hasFocusVal = false
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visState })
  document.hasFocus = vi.fn(() => hasFocusVal)
  window.focus = vi.fn()
  Object.defineProperty(window, "location", { configurable: true, writable: true, value: { href: "" } })
})

afterEach(() => {
  delete (window as unknown as { Notification?: unknown }).Notification
  Object.defineProperty(window, "location", { configurable: true, writable: true, value: originalLocation })
  vi.restoreAllMocks()
})

describe("notificationPermission", () => {
  it("reports unsupported when the API is absent", () => {
    expect(notificationPermission()).toBe("unsupported")
  })
  it("reports the current permission when supported", () => {
    installNotification()
    expect(notificationPermission()).toBe("granted")
  })
})

describe("ensurePermission", () => {
  it("returns unsupported when the API is absent", async () => {
    expect(await ensurePermission()).toBe("unsupported")
  })
  it("returns an already-decided permission without prompting", async () => {
    installNotification()
    MockNotification.permission = "denied"
    expect(await ensurePermission()).toBe("denied")
    expect(MockNotification.requestPermission).not.toHaveBeenCalled()
  })
  it("prompts when permission is still default", async () => {
    installNotification()
    MockNotification.permission = "default"
    MockNotification.requestPermission.mockResolvedValueOnce("granted")
    expect(await ensurePermission()).toBe("granted")
    expect(MockNotification.requestPermission).toHaveBeenCalledOnce()
  })
})

describe("notifySystem", () => {
  it("does nothing when unsupported", () => {
    notifySystem({ title: "t", body: "b" })
    expect(MockNotification.last).toBeNull()
  })

  it("does nothing when permission is not granted", () => {
    installNotification()
    MockNotification.permission = "default"
    notifySystem({ title: "t", body: "b" })
    expect(MockNotification.last).toBeNull()
  })

  it("does nothing when the tab is focused (no double-notify)", () => {
    installNotification()
    visState = "visible"
    hasFocusVal = true
    notifySystem({ title: "t", body: "b" })
    expect(MockNotification.last).toBeNull()
  })

  it("fires when backgrounded and routes to the branch on click", () => {
    installNotification()
    notifySystem({ title: "Ready for review", body: "All done", taskId: TASK })

    const n = MockNotification.last
    expect(n).not.toBeNull()
    expect(n!.title).toBe("Ready for review")
    expect(n!.options?.tag).toBe(`planora-task-${TASK}`)

    n!.onclick?.()
    expect(window.focus).toHaveBeenCalled()
    expect(window.location.href).toBe(`/branch/${TASK}`)
    expect(n!.close).toHaveBeenCalled()
  })

  it("fires without navigation when there is no task", () => {
    installNotification()
    notifySystem({ title: "t", body: "b", taskId: EMPTY_GUID })
    MockNotification.last!.onclick?.()
    expect(window.location.href).toBe("")
  })

  it("swallows a constructor failure", () => {
    installNotification()
    MockNotification.shouldThrow = true
    expect(() => notifySystem({ title: "t", body: "b", taskId: TASK })).not.toThrow()
  })
})
