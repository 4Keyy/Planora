const EMPTY_GUID = "00000000-0000-0000-0000-000000000000"
const ICON_URL = "/favicon.svg"

function isSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window
}

/** Current OS-notification permission, or "unsupported" when the API is unavailable (SSR/old browser). */
export function notificationPermission(): NotificationPermission | "unsupported" {
  return isSupported() ? Notification.permission : "unsupported"
}

/**
 * Politely request OS-notification permission. Must be called from a user gesture (e.g. opening the
 * bell) so the browser actually shows the prompt. A no-op when unsupported or already decided.
 */
export async function ensurePermission(): Promise<NotificationPermission | "unsupported"> {
  if (!isSupported()) return "unsupported"
  if (Notification.permission !== "default") return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

export interface SystemNotificationInput {
  title: string
  body: string
  taskId?: string
  /** Coalescing tag — a newer notification for the same task replaces the previous one. */
  tag?: string
}

/**
 * Fire a native Windows/macOS notification from the Planora site — but ONLY when the tab is
 * backgrounded or unfocused (a focused user already sees the in-app toast), and only when permission
 * has been granted. Clicking it focuses the tab and opens the task's branch. Fully guarded so it is
 * a safe no-op under SSR, in an insecure context, or when the browser lacks the API.
 */
export function notifySystem(input: SystemNotificationInput): void {
  if (!isSupported() || Notification.permission !== "granted") return

  // Don't double-notify someone who is actively looking at the app.
  const focused =
    typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus()
  if (focused) return

  try {
    const notification = new Notification(input.title, {
      body: input.body,
      tag: input.tag ?? (input.taskId ? `planora-task-${input.taskId}` : "planora"),
      icon: ICON_URL,
      badge: ICON_URL,
    })
    notification.onclick = () => {
      try {
        window.focus()
      } catch {
        /* focus may be blocked — navigation below still works */
      }
      if (input.taskId && input.taskId !== EMPTY_GUID) {
        window.location.href = `/branch/${input.taskId}`
      }
      notification.close()
    }
  } catch {
    /* some browsers throw if a Notification is constructed outside a permitted context */
  }
}
