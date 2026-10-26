import { beforeEach, describe, expect, it, vi } from "vitest"

// ── Fake @microsoft/signalr ──────────────────────────────────────────────────
// Shared mock state, hoisted so both the module factory and the tests can reach it.
const mock = vi.hoisted(() => {
  class FakeConnection {
    state = "Disconnected"
    handlers = new Map<string, (p: unknown) => void>()
    reconnected: (() => void) | null = null
    reconnecting: (() => void) | null = null
    closed: (() => void) | null = null
    invokes: Array<{ method: string; args: unknown[] }> = []
    /** When > 0, the next start() rejects (simulates a transient connect failure). */
    failNextStarts = 0
    on(event: string, cb: (p: unknown) => void) { this.handlers.set(event, cb) }
    onreconnected(cb: () => void) { this.reconnected = cb }
    onreconnecting(cb: () => void) { this.reconnecting = cb }
    onclose(cb: () => void) { this.closed = cb }
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
  // How many times the module was loaded, and whether the next load fails (a chunk that did not
  // arrive): the client loads it on the first connect only (FE-21).
  const loads = { count: 0, failNext: false }
  const signalRModule = () => {
    loads.count += 1
    if (loads.failNext) {
      loads.failNext = false
      throw new Error("Loading chunk failed")
    }
    return {
      HubConnectionBuilder: FakeBuilder,
      HubConnectionState: {
        Disconnected: "Disconnected",
        Connecting: "Connecting",
        Connected: "Connected",
        Reconnecting: "Reconnecting",
      },
      HttpTransportType: { WebSockets: 1 },
      LogLevel: { Warning: 3 },
    }
  }
  return { built, state, loads, signalRModule, FakeBuilder, FakeConnection }
})

vi.mock("@microsoft/signalr", () => mock.signalRModule())

/**
 * A fresh realtime module whose SignalR import has not happened yet. `vi.resetModules` keeps a
 * mocked module's factory result, so the mock is registered again to make the next import load it.
 */
async function freshClient() {
  vi.doMock("@microsoft/signalr", () => mock.signalRModule())
  vi.resetModules()
  mock.loads.count = 0
  mock.built.length = 0
  return import("@/lib/realtime/client")
}

import { realtime } from "@/lib/realtime/client"

// Every page renders the root layout and with it this module — the landing page and the sign-in
// screens too. The SignalR client is only fetched when a signed-in user connects (FE-21).
describe("loading the SignalR client", () => {
  it("is not loaded with the realtime module, only by the first connect", async () => {
    const fresh = await freshClient()
    expect(mock.loads.count).toBe(0)

    await fresh.realtime.start()
    expect(mock.loads.count).toBe(1)
    expect(mock.built).toHaveLength(1)
    expect(fresh.realtime.isConnected).toBe(true)

    await fresh.realtime.stop()
    await fresh.realtime.start()
    expect(mock.loads.count).toBe(1) // loaded once per page
    await fresh.realtime.stop()
  })

  it("retries a client that failed to load with the next connect attempt", async () => {
    vi.useFakeTimers()
    try {
      const fresh = await freshClient()
      mock.loads.failNext = true

      await fresh.realtime.start()
      expect(mock.built).toHaveLength(0)
      expect(fresh.realtime.isConnected).toBe(false)

      await vi.advanceTimersByTimeAsync(2_000) // the connect backoff's first step
      expect(mock.built).toHaveLength(1)
      expect(fresh.realtime.isConnected).toBe(true)
      await fresh.realtime.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it("builds nothing when the user signs out while the client is loading", async () => {
    const fresh = await freshClient()

    const starting = fresh.realtime.start()
    await fresh.realtime.stop()
    await starting

    expect(mock.built).toHaveLength(0)
  })
})

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

describe("realtime client resync", () => {
  beforeEach(async () => {
    await realtime.stop()
    mock.built.length = 0
    mock.state.nextFailStarts = 0
  })

  it("does not ask views to resync on the first connect of a session", async () => {
    const resync = vi.fn()
    const off = realtime.onResync(resync)
    await realtime.start()
    expect(resync).not.toHaveBeenCalled()
    off()
  })

  it("asks views to resync once the socket comes back from a drop", async () => {
    const resync = vi.fn()
    const off = realtime.onResync(resync)
    await realtime.start()

    const connection = mock.built[0]
    connection.reconnecting?.()
    connection.reconnected?.()
    await vi.waitFor(() => expect(resync).toHaveBeenCalledTimes(1))

    // Nothing was missed since: another reconnected callback alone asks for nothing.
    connection.reconnected?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(resync).toHaveBeenCalledTimes(1)
    off()
  })

  it("asks views to resync when a failed connect finally succeeds", async () => {
    vi.useFakeTimers()
    try {
      const resync = vi.fn()
      const off = realtime.onResync(resync)
      mock.state.nextFailStarts = 1
      await realtime.start()
      expect(resync).not.toHaveBeenCalled()

      mock.state.nextFailStarts = 0
      await vi.advanceTimersByTimeAsync(2_000)

      expect(mock.built[1].state).toBe("Connected")
      expect(resync).toHaveBeenCalledTimes(1)
      off()
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps reconnecting after the automatic reconnect gives up, then resyncs", async () => {
    vi.useFakeTimers()
    try {
      const resync = vi.fn()
      const off = realtime.onResync(resync)
      await realtime.start()
      const first = mock.built[0]

      // withAutomaticReconnect ran out of attempts: SignalR closes the connection for good.
      first.state = "Disconnected"
      first.closed?.()
      await vi.advanceTimersByTimeAsync(2_000)

      expect(mock.built).toHaveLength(2)
      expect(mock.built[1].state).toBe("Connected")
      expect(resync).toHaveBeenCalledTimes(1)
      off()
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not reconnect a connection closed by logout", async () => {
    vi.useFakeTimers()
    try {
      await realtime.start()
      const first = mock.built[0]
      await realtime.stop()
      first.closed?.()
      await vi.advanceTimersByTimeAsync(60_000)

      expect(mock.built).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
