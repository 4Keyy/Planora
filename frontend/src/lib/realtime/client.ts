import * as signalR from "@microsoft/signalr"
import { useAuthStore } from "@/store/auth"
import { getApiBaseUrl } from "@/lib/config"

/** A task-list / dashboard card changed for the current user. */
export interface TaskFeedChangedPayload {
  action: string
  taskId: string
  actorId: string
  timestamp: string
}

/** Something inside a task's branch room changed (comment, subtask, status, activity). */
export interface BranchChangedPayload {
  action: string
  taskId: string
  entityId: string
  actorId: string
  timestamp: string
}

/** Ephemeral "is typing" presence for a branch room. `name` is "Имя Фамилия". */
export interface TypingPayload {
  taskId: string
  userId: string
  name?: string
}

interface ServerEventMap {
  TaskFeedChanged: TaskFeedChangedPayload
  BranchChanged: BranchChangedPayload
  UserTyping: TypingPayload
  UserStoppedTyping: TypingPayload
}

type ServerEvent = keyof ServerEventMap
type Listener<E extends ServerEvent> = (payload: ServerEventMap[E]) => void

const SERVER_EVENTS: readonly ServerEvent[] = [
  "TaskFeedChanged",
  "BranchChanged",
  "UserTyping",
  "UserStoppedTyping",
]

/**
 * Single SignalR connection shared across the whole app. The hub multiplexes notifications, live
 * data-sync signals (TaskFeedChanged / BranchChanged), and branch typing presence over one socket,
 * so the client opens exactly one connection regardless of how many views subscribe.
 *
 * Branch-room membership is reference-counted: the modal and the standalone branch page can both be
 * "in" task X, and the room is only left when the last subscriber leaves. On reconnect every joined
 * room is re-entered, because SignalR group membership does not survive a transport drop.
 *
 * The connection authenticates with the in-memory access token via WebSockets + skipNegotiation,
 * which matches the gateway's GET-only ws route (the token rides as ?access_token=, the only way a
 * browser can authenticate a WebSocket).
 */
class RealtimeClient {
  private connection: signalR.HubConnection | null = null
  private startPromise: Promise<void> | null = null
  private wantConnected = false

  private readonly listeners = new Map<ServerEvent, Set<Listener<ServerEvent>>>()
  /** taskId → number of active subscribers (modal + page can overlap). */
  private readonly joinedTasks = new Map<string, number>()

  /** Open the connection (idempotent). Call once the user is authenticated. */
  async start(): Promise<void> {
    this.wantConnected = true

    // A connection already exists and is up or coming up (initial connect or an automatic
    // reconnect). Never build a second socket — accessTokenFactory re-reads the token on each
    // (re)connect, so a token refresh does not require tearing down a working connection.
    const state = this.connection?.state
    if (state === signalR.HubConnectionState.Connected) return
    if (
      state === signalR.HubConnectionState.Connecting ||
      state === signalR.HubConnectionState.Reconnecting
    ) {
      return this.startPromise ?? Promise.resolve()
    }
    if (this.startPromise) return this.startPromise

    const connection = this.build()
    this.connection = connection

    this.startPromise = connection
      .start()
      .then(() => {
        // A logout may have raced the handshake — honor the latest intent.
        if (!this.wantConnected) return connection.stop()
        return this.rejoinAll()
      })
      .catch((error) => {
        // Leave it to the caller's lifecycle effect to retry on the next auth tick.
        if (process.env.NODE_ENV !== "production") {
          console.warn("[realtime] connection failed to start:", error)
        }
      })
      .finally(() => {
        this.startPromise = null
      })

    return this.startPromise
  }

  /** Close the connection and forget joined rooms (called on logout). */
  async stop(): Promise<void> {
    this.wantConnected = false
    this.joinedTasks.clear()
    const connection = this.connection
    this.connection = null
    if (connection) {
      try {
        await connection.stop()
      } catch {
        /* already closing */
      }
    }
  }

  /** Subscribe to a server event. Returns an unsubscribe function. */
  on<E extends ServerEvent>(event: E, listener: Listener<E>): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener as Listener<ServerEvent>)
    return () => {
      set?.delete(listener as Listener<ServerEvent>)
    }
  }

  /** Join a task's branch room (reference-counted). Safe to call before the socket is up. */
  async joinTask(taskId: string): Promise<void> {
    const next = (this.joinedTasks.get(taskId) ?? 0) + 1
    this.joinedTasks.set(taskId, next)
    if (next === 1) await this.invokeJoin(taskId)
  }

  /** Leave a task's branch room (reference-counted; only leaves on the last subscriber). */
  async leaveTask(taskId: string): Promise<void> {
    const current = this.joinedTasks.get(taskId) ?? 0
    if (current <= 1) {
      this.joinedTasks.delete(taskId)
      await this.invoke("LeaveTask", taskId)
    } else {
      this.joinedTasks.set(taskId, current - 1)
    }
  }

  startTyping(taskId: string): Promise<void> {
    return this.invoke("StartTyping", taskId)
  }

  stopTyping(taskId: string): Promise<void> {
    return this.invoke("StopTyping", taskId)
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private build(): signalR.HubConnection {
    const url = `${getApiBaseUrl()}/realtime/hubs/notifications`

    const connection = new signalR.HubConnectionBuilder()
      .withUrl(url, {
        transport: signalR.HttpTransportType.WebSockets,
        skipNegotiation: true,
        accessTokenFactory: () => useAuthStore.getState().accessToken ?? "",
      })
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build()

    for (const event of SERVER_EVENTS) {
      connection.on(event, (payload: ServerEventMap[ServerEvent]) => this.emit(event, payload))
    }

    connection.onreconnected(() => {
      void this.rejoinAll()
    })

    return connection
  }

  private emit<E extends ServerEvent>(event: E, payload: ServerEventMap[E]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const listener of set) {
      try {
        ;(listener as Listener<E>)(payload)
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(`[realtime] listener for ${event} threw:`, error)
        }
      }
    }
  }

  private async rejoinAll(): Promise<void> {
    for (const taskId of this.joinedTasks.keys()) {
      await this.invokeJoin(taskId)
    }
  }

  private async invokeJoin(taskId: string): Promise<void> {
    await this.invoke("JoinTask", taskId)
  }

  private async invoke(method: string, ...args: unknown[]): Promise<void> {
    const connection = this.connection
    if (!connection || connection.state !== signalR.HubConnectionState.Connected) return
    try {
      await connection.invoke(method, ...args)
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[realtime] invoke ${method} failed:`, error)
      }
    }
  }
}

/** App-wide singleton. */
export const realtime = new RealtimeClient()
