import { beforeEach, describe, expect, it, vi } from "vitest"

// ── Fake @microsoft/signalr ──────────────────────────────────────────────────
// Shared mock state, hoisted so both the module factory and the tests can reach it.
const mock = vi.hoisted(() => {
  class FakeConnection {
    state = "Disconnected"
    handlers = new Map<string, (p: unknown) => void>()
    reconnected: (() => void) | null = null
    invokes: Array<{ method: string; args: unknown[] }> = []
    /** When > 0, the next start() rejects (simulates a transient connect failure). */
    failNextStarts = 0
    on(event: string, cb: (p: unknown) => void) { this.handlers.set(event, cb) }
    onreconnected(cb: () => void) { this.reconnected = cb }
    async start() {
      if (this.failNextStarts > 0) {
        this.failNextStarts -= 1
        throw new Error("WebSocket failed to connect")
      }
      this.state = "Connected"
    }
    async stop() { this.state = "Disconnected" }
    async invoke(method: string, ...args: unknown[]) { this.invokes.push({ method, args }) }
    /** Simulate a server→client push. */
    server(event: string, payload: unknown) { this.handlers.get(event)?.(payload) }
  }
  const built: FakeConnection[] = []
  // Arms the NEXT connection(s) built to fail their first start() — set before realtime.start().
  const state = { nextFailStarts: 0 }
  class FakeBuilder {
    withUrl() { return this }
    withAutomaticReconnect() { return this }
    configureLogging() { return this }
    build() {
      const c = new FakeConnection()
      c.failNextStarts = state.nextFailStarts
      built.push(c)
      return c
    }
  }
  return { built, state, FakeBuilder, FakeConnection }
})

vi.mock("@microsoft/signalr", () => ({
  HubConnectionBuilder: mock.FakeBuilder,
  HubConnectionState: {
    Disconnected: "Disconnected",
    Connecting: "Connecting",
    Connected: "Connected",
    Reconnecting: "Reconnecting",
  },
  HttpTransportType: { WebSockets: 1 },
  LogLevel: { Warning: 3 },
}))

import { realtime } from "@/lib/realtime/client"

describe("realtime client", () => {
  beforeEach(async () => {
    await realtime.stop()
    mock.built.length = 0
    mock.state.nextFailStarts = 0
  })

  it("opens exactly one connection and never rebuilds while connected", async () => {
    await realtime.start()
    await realtime.start()
    await realtime.start()
    expect(mock.built).toHaveLength(1)
    expect(mock.built[0].state).toBe("Connected")
  })

  it("does NOT build a second connection while the socket is reconnecting", async () => {
    await realtime.start()
    expect(mock.built).toHaveLength(1)

    // Simulate an automatic reconnect in progress, then a concurrent start() (e.g. a token refresh
    // or a branch opening). The client must reuse the existing connection, not spawn a duplicate.
    mock.built[0].state = "Reconnecting"
    await realtime.start()

    expect(mock.built).toHaveLength(1)
  })

  it("reference-counts branch rooms: joins once, leaves only on the last leave", async () => {
    await realtime.start()
    const conn = mock.built[0]

    await realtime.joinTask("task-1")
    await realtime.joinTask("task-1") // second subscriber — no extra JoinTask
    expect(conn.invokes.filter((i) => i.method === "JoinTask")).toHaveLength(1)

    await realtime.leaveTask("task-1") // still one subscriber left — no LeaveTask yet
    expect(conn.invokes.filter((i) => i.method === "LeaveTask")).toHaveLength(0)

    await realtime.leaveTask("task-1") // last subscriber leaves — now LeaveTask fires
    expect(conn.invokes.filter((i) => i.method === "LeaveTask")).toHaveLength(1)
  })

  it("re-joins all active rooms after a reconnect", async () => {
    await realtime.start()
    const conn = mock.built[0]
    await realtime.joinTask("task-1")
    conn.invokes.length = 0

    conn.reconnected?.() // SignalR fired onreconnected
    await Promise.resolve()

    expect(conn.invokes.filter((i) => i.method === "JoinTask" && i.args[0] === "task-1")).toHaveLength(1)
  })

  it("dispatches server events to listeners and stops after unsubscribe", async () => {
    await realtime.start()
    const conn = mock.built[0]

    const received: unknown[] = []
    const off = realtime.on("TaskFeedChanged", (p) => received.push(p))

    conn.server("TaskFeedChanged", { action: "task.created", taskId: "x" })
    expect(received).toHaveLength(1)

    off()
    conn.server("TaskFeedChanged", { action: "task.updated", taskId: "x" })
    expect(received).toHaveLength(1) // no further delivery after unsubscribe
  })

  it("retries a failed initial connect with backoff until it succeeds", async () => {
    vi.useFakeTimers()
    try {
      // withAutomaticReconnect only covers post-handshake drops, so the client must retry a
      // start() that never connected. Arm the first connection to fail, then let the retry win.
      mock.state.nextFailStarts = 1
      await realtime.start()
      expect(mock.built).toHaveLength(1)
      expect(mock.built[0].state).toBe("Disconnected")

      mock.state.nextFailStarts = 0
      await vi.advanceTimersByTimeAsync(2_000) // first backoff step

      expect(mock.built).toHaveLength(2)
      expect(mock.built[1].state).toBe("Connected")
    } finally {
      vi.useRealTimers()
    }
  })

  it("cancels a pending connect retry on logout", async () => {
    vi.useFakeTimers()
    try {
      mock.state.nextFailStarts = 1
      await realtime.start() // fails, schedules a retry
      expect(mock.built).toHaveLength(1)

      await realtime.stop() // logout must cancel the pending retry
      mock.state.nextFailStarts = 0
      await vi.advanceTimersByTimeAsync(60_000)

      expect(mock.built).toHaveLength(1) // no further connection built
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not invoke hub methods when disconnected", async () => {
    // No start() — connection is null. joinTask must not throw and must not queue an invoke.
    await realtime.joinTask("task-1")
    expect(mock.built).toHaveLength(0)
  })
})
