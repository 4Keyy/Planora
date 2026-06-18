import {
  MessageCircle,
  Reply,
  ListPlus,
  CheckCheck,
  Zap,
  Check,
  ClipboardCheck,
  Users,
  Bell,
  type LucideIcon,
} from "lucide-react"

/**
 * Canonical notification type discriminators — mirror the backend's NotificationType. Sent on the
 * wire as strings, so the client maps each to an icon / tint / OS-notification policy and degrades
 * an unknown type to a generic bell.
 */
export const NOTIFICATION_TYPES = {
  CommentAdded: "comment.added",
  CommentReply: "comment.reply",
  SubtaskAdded: "subtask.added",
  SubtaskCompleted: "subtask.completed",
  TaskStarted: "task.started",
  TaskCompleted: "task.completed",
  TaskReview: "task.review",
  TaskParticipantsDone: "task.participants_done",
} as const

/**
 * The contextual "analogy" a notification carries — who/what it is really about.
 * Drives a small secondary glyph on the badge so a glance reads "this is about
 * people" / "this happened in the branch" / "someone is talking", not just a color:
 *   - "people" → a collaborator acted (started, completed, ready for review)
 *   - "branch" → the task's branch/subtasks changed (subtask added/done)
 *   - "chat"   → a message or reply in the branch thread
 */
export type NotificationMotif = "people" | "branch" | "chat"

/** Visual + behavioral config for one notification kind. */
export interface NotificationKind {
  icon: LucideIcon
  /** Accent color (hex) — used for the glyph, ring and count bubble. */
  tint: string
  /** Short human label for the bell row. */
  label: string
  /** Whether this kind raises a native OS notification (when the tab is backgrounded). */
  isSystem: boolean
  /** What the event is really about — people, the branch, or chat. Drives the motif glyph. */
  motif: NotificationMotif
  /** The "little people + checkmark" composite glyph (participants done). */
  composite?: "people-check"
}

const DEFAULT_KIND: NotificationKind = {
  icon: Bell,
  tint: "#6366f1",
  label: "Notification",
  isSystem: false,
  motif: "people",
}

const KINDS: Record<string, NotificationKind> = {
  [NOTIFICATION_TYPES.CommentAdded]: {
    icon: MessageCircle, tint: "#6366f1", label: "New message", isSystem: false, motif: "chat",
  },
  [NOTIFICATION_TYPES.CommentReply]: {
    icon: Reply, tint: "#8b5cf6", label: "Reply to you", isSystem: true, motif: "chat",
  },
  [NOTIFICATION_TYPES.SubtaskAdded]: {
    icon: ListPlus, tint: "#0ea5e9", label: "New subtask", isSystem: false, motif: "branch",
  },
  [NOTIFICATION_TYPES.SubtaskCompleted]: {
    icon: CheckCheck, tint: "#10b981", label: "Subtask done", isSystem: false, motif: "branch",
  },
  [NOTIFICATION_TYPES.TaskStarted]: {
    icon: Zap, tint: "#6366f1", label: "Picked up", isSystem: false, motif: "people",
  },
  [NOTIFICATION_TYPES.TaskCompleted]: {
    icon: Check, tint: "#059669", label: "Task done", isSystem: true, motif: "people",
  },
  [NOTIFICATION_TYPES.TaskReview]: {
    icon: ClipboardCheck, tint: "#f59e0b", label: "Ready for review", isSystem: true, motif: "people",
  },
  [NOTIFICATION_TYPES.TaskParticipantsDone]: {
    icon: Users, tint: "#14b8a6", label: "Everyone's done", isSystem: true, motif: "people", composite: "people-check",
  },
}

/** Resolve the visual/behavioral config for a notification type (generic bell for unknowns). */
export function getNotificationKind(type: string | null | undefined): NotificationKind {
  if (!type) return DEFAULT_KIND
  return KINDS[type] ?? DEFAULT_KIND
}

/** Whether a notification type should raise a native OS notification when the tab is backgrounded. */
export function isSystemNotification(type: string | null | undefined): boolean {
  return getNotificationKind(type).isSystem
}
