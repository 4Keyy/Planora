import { create } from "zustand"

/**
 * One kind of on-screen notice for everything the interface says in passing: a task saved,
 * a request that failed, a deletion that can still be taken back. They used to be two
 * unrelated things — tinted glass cards in the top-right corner for toasts, and a black bar
 * at the bottom for undo — that looked, moved and stacked nothing alike. Both are now items
 * of this store, drawn by the one `Toaster` (`components/ui/toast.tsx`).
 */
export type ToastType = "success" | "error" | "warning" | "info"

export interface ToastAction {
  label: string
  onClick: () => void
}

export type ToastItem = {
  id: string
  title: string
  description?: string
  type: ToastType
  /** One button beside the text — "Undo", "Retry", "View". Pressing it dismisses the notice. */
  action?: ToastAction
  /** How long it stays, in ms. Defaults by type; `Infinity` stays until dismissed. */
  duration?: number
  /** Draw the time left as a ring that drains — for a window the user can act within. */
  countdown?: boolean
  /** "undo" draws the undo glyph instead of the type's. */
  icon?: "undo"
  /** Runs when the notice leaves for any reason other than its action. */
  onDismiss?: () => void
  /** Told when the stack stops the clock (the pointer or focus is on it) and starts it again. */
  onPause?: () => void
  onResume?: () => void
}

/** A notice as the store keeps it: its clock, and how many times it has been said. */
export type ToastState = ToastItem & {
  /** How many identical notices this one stands for ("×3"). */
  count: number
  /** When its clock last (re)started, `performance.now()`. */
  startedAt: number
  /** Time it had left when its clock last stopped, or its whole duration before that. */
  remaining: number
  /** Its whole duration, from the last time its clock started over. */
  total: number
  /** New whenever its clock starts over — said again, or changed — so its ring restarts too. */
  revision: number
}

/**
 * How long each kind stays. Reading time, not urgency: an error usually carries a sentence
 * worth reading, a success is a glance. A description adds a beat.
 */
export const TOAST_DURATIONS: Record<ToastType, number> = {
  success: 4000,
  info: 5000,
  warning: 6000,
  error: 7000,
}
const DESCRIPTION_EXTRA_MS = 1500

/** More than this and the oldest leave early: a stack nobody can read helps nobody. */
export const TOAST_LIMIT = 5

type Store = {
  toasts: ToastState[]
  paused: boolean
  /** Shows a notice and returns its id. The same notice said again is counted, not stacked. */
  addToast: (toast: Omit<ToastItem, "id"> & { id?: string }) => string
  /** Changes a notice in place — "Saving…" becoming "Saved" — keeping its place in the stack. */
  updateToast: (id: string, patch: Partial<Omit<ToastItem, "id">>) => void
  removeToast: (id: string) => void
  /** Runs a notice's action and dismisses it. */
  actOn: (id: string) => void
  /** The stack is being read: every clock stops. */
  pause: () => void
  resume: () => void
  clear: () => void
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()
/** Every (re)start of a notice's clock gets a new revision, unique for the session. */
let clockEpoch = 0
const now = () => (typeof performance === "undefined" ? Date.now() : performance.now())

const generateId = (): string =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `toast-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`

const durationOf = (toast: Omit<ToastItem, "id">) =>
  toast.duration ?? TOAST_DURATIONS[toast.type] + (toast.description ? DESCRIPTION_EXTRA_MS : 0)

const sameNotice = (a: Pick<ToastItem, "type" | "title" | "description">, b: Pick<ToastItem, "type" | "title" | "description">) =>
  a.type === b.type && a.title === b.title && (a.description ?? "") === (b.description ?? "")

export const useToastStore = create<Store>((set, get) => {
  const stopClock = (id: string) => {
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
  }

  const startClock = (id: string, ms: number) => {
    stopClock(id)
    if (!Number.isFinite(ms)) return
    timers.set(id, setTimeout(() => expire(id), Math.max(0, ms)))
  }

  const drop = (id: string, reason: "dismiss" | "action") => {
    const toast = get().toasts.find((t) => t.id === id)
    stopClock(id)
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
    if (toast && reason === "dismiss") toast.onDismiss?.()
  }

  const expire = (id: string) => drop(id, "dismiss")

  return {
    toasts: [],
    paused: false,

    addToast: (input) => {
      const { toasts, paused } = get()
      const existing = input.id
        ? toasts.find((t) => t.id === input.id)
        : toasts.find((t) => !t.action && !input.action && sameNotice(t, input))
      const duration = durationOf(input)

      if (existing) {
        // Said again: the notice already on screen counts it and starts its clock over,
        // rather than a second copy appearing under the first.
        const repeated = !input.id
        set((state) => ({
          toasts: state.toasts.map((t) =>
            t.id === existing.id
              ? {
                  ...t,
                  ...input,
                  id: existing.id,
                  count: repeated ? t.count + 1 : t.count,
                  startedAt: now(),
                  remaining: duration,
                  total: duration,
                  revision: ++clockEpoch,
                }
              : t,
          ),
        }))
        if (!paused) startClock(existing.id, duration)
        return existing.id
      }

      const id = input.id ?? generateId()
      const toast: ToastState = { ...input, id, count: 1, startedAt: now(), remaining: duration, total: duration, revision: ++clockEpoch }
      const overflow = toasts.length + 1 - TOAST_LIMIT
      set((state) => ({ toasts: [...state.toasts, toast] }))
      if (!paused) startClock(id, duration)
      // The oldest make room, through the same exit as any other dismissal.
      for (const old of toasts.slice(0, Math.max(0, overflow))) drop(old.id, "dismiss")
      return id
    },

    updateToast: (id, patch) => {
      const toast = get().toasts.find((t) => t.id === id)
      if (!toast) return
      const restart = patch.duration !== undefined || patch.type !== undefined
      const duration = restart ? durationOf({ ...toast, ...patch }) : toast.remaining
      set((state) => ({
        toasts: state.toasts.map((t) =>
          t.id === id
            ? { ...t, ...patch, ...(restart ? { startedAt: now(), remaining: duration, total: duration, revision: ++clockEpoch } : {}) }
            : t,
        ),
      }))
      if (restart && !get().paused) startClock(id, duration)
    },

    removeToast: (id) => drop(id, "dismiss"),

    actOn: (id) => {
      const toast = get().toasts.find((t) => t.id === id)
      drop(id, "action")
      toast?.action?.onClick()
    },

    pause: () => {
      if (get().paused) return
      const at = now()
      for (const id of timers.keys()) stopClock(id)
      set((state) => ({
        paused: true,
        toasts: state.toasts.map((t) => ({ ...t, remaining: Math.max(0, t.remaining - (at - t.startedAt)) })),
      }))
      for (const toast of get().toasts) toast.onPause?.()
    },

    resume: () => {
      if (!get().paused) return
      const at = now()
      set((state) => ({ paused: false, toasts: state.toasts.map((t) => ({ ...t, startedAt: at })) }))
      for (const toast of get().toasts) {
        startClock(toast.id, toast.remaining)
        toast.onResume?.()
      }
    },

    clear: () => {
      for (const id of timers.keys()) stopClock(id)
      set({ toasts: [], paused: false })
    },
  }
})
